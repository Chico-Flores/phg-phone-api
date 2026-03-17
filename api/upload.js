const { MongoClient } = require('mongodb');

// MongoDB connection string - set as environment variable in Vercel
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'phoneLookups';
const COLLECTION_NAME = 'phones';

// Simple password protection - set in Vercel environment variables
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'phg2024';

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
    let errors = 0;
    const failedRecords = [];
    const now = new Date().toISOString();

    // ── Step 1: Clean and validate all records, group by phone ──
    // Map: cleanPhone → array of person objects
    const phoneMap = new Map();

    for (const record of phoneRecords) {
      try {
        const { phone, person } = record;

        if (!phone || phone.length < 10) {
          errors++;
          failedRecords.push({ ...record, error: 'Invalid phone number (too short)' });
          continue;
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        if (cleanPhone.length !== 10) {
          errors++;
          failedRecords.push({ ...record, error: 'Invalid phone number (not 10 digits after cleaning)' });
          continue;
        }

        if (!phoneMap.has(cleanPhone)) {
          phoneMap.set(cleanPhone, []);
        }
        phoneMap.get(cleanPhone).push(person);
      } catch (err) {
        errors++;
        failedRecords.push({ ...record, error: err.message });
      }
    }

    // ── Step 2: Fetch all existing docs in one query ──
    const phoneNumbers = Array.from(phoneMap.keys());
    const existingDocs = await collection
      .find({ _id: { $in: phoneNumbers } })
      .project({ _id: 1, persons: 1 })
      .toArray();

    // Build a lookup map: phone → existing persons array
    const existingMap = new Map();
    for (const doc of existingDocs) {
      existingMap.set(doc._id, doc.persons || []);
    }

    // ── Step 3: Build bulkWrite operations ──
    const operations = [];

    for (const [cleanPhone, newPersons] of phoneMap) {
      const existingPersons = existingMap.get(cleanPhone);

      if (!existingPersons) {
        // Phone doesn't exist — insert new document
        // Deduplicate persons within this batch by name+type
        const uniquePersons = [];
        const seen = new Set();
        for (const p of newPersons) {
          const key = (p.name || '') + '|' + (p.type || '');
          if (!seen.has(key)) {
            seen.add(key);
            uniquePersons.push(p);
          }
        }

        operations.push({
          insertOne: {
            document: {
              _id: cleanPhone,
              phone: cleanPhone,
              persons: uniquePersons,
              createdAt: now,
              updatedAt: now
            }
          }
        });
        inserted++;
      } else {
        // Phone exists — figure out which persons to add/update
        const personsToAdd = [];
        let personsUpdated = false;

        for (const newPerson of newPersons) {
          // Check if this person (by name+type) already exists
          const existingIdx = existingPersons.findIndex(
            p => p.name === newPerson.name && p.type === newPerson.type
          );

          if (existingIdx === -1) {
            // Person doesn't exist for this phone — add them
            // But deduplicate within the batch itself
            const alreadyAdding = personsToAdd.some(
              p => p.name === newPerson.name && p.type === newPerson.type
            );
            if (!alreadyAdding) {
              personsToAdd.push(newPerson);
            }
          } else {
            // Person exists — update their info in place
            existingPersons[existingIdx] = newPerson;
            personsUpdated = true;
          }
        }

        // Build the update operation
        const updateOps = { $set: { updatedAt: now } };

        if (personsUpdated) {
          // Overwrite the full persons array with updated entries + new additions
          updateOps.$set.persons = [...existingPersons, ...personsToAdd];
        } else if (personsToAdd.length > 0) {
          // Just push new persons (more efficient than replacing the whole array)
          updateOps.$push = { persons: { $each: personsToAdd } };
        }

        // Only add an operation if something actually changed
        if (personsUpdated || personsToAdd.length > 0) {
          operations.push({
            updateOne: {
              filter: { _id: cleanPhone },
              update: updateOps
            }
          });
          updated++;
        }
      }
    }

    // ── Step 4: Execute bulkWrite in one shot ──
    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: false });
    }

    // Get total count
    const totalCount = await collection.countDocuments();

    return res.status(200).json({
      success: true,
      statistics: {
        processed: phoneRecords.length,
        inserted,
        updated,
        errors,
        totalInDatabase: totalCount
      },
      failedRecords: failedRecords.length > 0 ? failedRecords : undefined
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      message: error.message 
    });
  }
};
