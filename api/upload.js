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
    // phone -> persons we tried to add, used by the duplicate-key retry below
    const pendingByPhone = new Map();

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

        // Upsert rather than insert. Uploads run several batches in parallel,
        // so another request can create this same phone between our read in
        // Step 2 and this write. A bare insertOne loses that race with
        // "E11000 duplicate key error ... index: _id_", which aborts the whole
        // response even though the rest of the batch was written.
        operations.push({
          updateOne: {
            filter: { _id: cleanPhone },
            update: {
              $setOnInsert: { phone: cleanPhone, createdAt: now },
              $set: { updatedAt: now },
              $push: { persons: { $each: uniquePersons } }
            },
            upsert: true
          }
        });
        pendingByPhone.set(cleanPhone, uniquePersons);
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
    // With ordered:false the driver still applies every operation it can, but
    // it throws if ANY of them failed. Treat that as a partial success: keep
    // the writes that landed, retry the ones that lost an upsert race, and
    // only report what genuinely could not be written.
    if (operations.length > 0) {
      try {
        await collection.bulkWrite(operations, { ordered: false });
      } catch (bulkError) {
        const writeErrors = bulkError.writeErrors || bulkError.result?.writeErrors || [];
        if (!writeErrors.length) throw bulkError;

        const stillFailed = [];

        for (const writeError of writeErrors) {
          const failedOp = operations[writeError.index ?? writeError.err?.index];
          const failedPhone = failedOp?.updateOne?.filter?._id;

          // 11000 means another request created this phone first. The document
          // exists now, so the same change applies cleanly as a plain update.
          if (writeError.code === 11000 && failedPhone) {
            try {
              await collection.updateOne(
                { _id: failedPhone },
                {
                  $set: { updatedAt: now },
                  $push: { persons: { $each: pendingByPhone.get(failedPhone) || [] } }
                }
              );
              continue;
            } catch (retryError) {
              writeError.retryMessage = retryError.message;
            }
          }
          stillFailed.push({ phone: failedPhone, writeError });
        }

        for (const failure of stillFailed) {
          const persons = pendingByPhone.get(failure.phone) || [];
          inserted = Math.max(0, inserted - 1);
          for (const person of persons) {
            errors++;
            failedRecords.push({
              phone: failure.phone,
              person,
              error: failure.writeError.retryMessage || failure.writeError.errmsg || 'Write failed'
            });
          }
        }
      }
    }

    // estimatedDocumentCount() reads collection metadata; countDocuments()
    // scans, which is several seconds on a collection this size and was being
    // paid on every batch of every upload.
    const totalCount = await collection.estimatedDocumentCount();

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
