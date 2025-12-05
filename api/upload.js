const { MongoClient } = require('mongodb');

// MongoDB connection string - will be set as environment variable in Vercel
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'phoneLookups';
const COLLECTION_NAME = 'phones';

// Simple password protection - set in Vercel environment variables
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'phg2024';

// Priority types that take precedence over POSS POE
const HIGH_PRIORITY_TYPES = ['DEBTOR', 'RELATIVE'];

// Check if a phone document has any high-priority person types
function hasHigherPriorityType(existingDoc) {
  if (!existingDoc || !existingDoc.persons) return false;
  return existingDoc.persons.some(p => HIGH_PRIORITY_TYPES.includes(p.type));
}

let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) {
    return cachedClient;
  }
  
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password, phoneRecords } = req.body;

    // Validate password
    if (password !== UPLOAD_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Validate data
    if (!phoneRecords || !Array.isArray(phoneRecords) || phoneRecords.length === 0) {
      return res.status(400).json({ error: 'No phone records provided' });
    }

    // Connect to MongoDB
    const client = await connectToDatabase();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Statistics
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process each phone record
    for (const record of phoneRecords) {
      try {
        const { phone, person } = record;
        
        if (!phone || phone.length < 10) {
          errors++;
          continue;
        }

        // Clean the phone number (last 10 digits only)
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        
        if (cleanPhone.length !== 10) {
          errors++;
          continue;
        }

        // Check if phone already exists
        const existingDoc = await collection.findOne({ _id: cleanPhone });

        // Priority check: Skip POSS POE if phone already has DEBTOR or RELATIVE
        if (person.type === 'POSS POE' && hasHigherPriorityType(existingDoc)) {
          skipped++;
          continue;
        }

        if (existingDoc) {
          // Check if this person already exists for this phone
          const personExists = existingDoc.persons.some(
            p => p.name === person.name && p.type === person.type
          );

          if (!personExists) {
            // Add new person to existing phone
            await collection.updateOne(
              { _id: cleanPhone },
              { 
                $push: { persons: person },
                $set: { updatedAt: new Date().toISOString() }
              }
            );
            updated++;
          } else {
            // Person already exists, update their info
            await collection.updateOne(
              { _id: cleanPhone, "persons.name": person.name, "persons.type": person.type },
              { 
                $set: { 
                  "persons.$": person,
                  updatedAt: new Date().toISOString()
                }
              }
            );
            updated++;
          }
        } else {
          // Insert new phone record
          await collection.insertOne({
            _id: cleanPhone,
            phone: cleanPhone,
            persons: [person],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          inserted++;
        }
      } catch (err) {
        console.error('Error processing record:', err);
        errors++;
      }
    }

    // Get total count
    const totalCount = await collection.countDocuments();

    return res.status(200).json({
      success: true,
      statistics: {
        processed: phoneRecords.length,
        inserted,
        updated,
        skipped,
        errors,
        totalInDatabase: totalCount
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      message: error.message 
    });
  }
};
