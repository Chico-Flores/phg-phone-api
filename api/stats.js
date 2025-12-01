const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'phoneLookups';
const COLLECTION_NAME = 'phones';

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
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await connectToDatabase();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Get total phone count
    const totalPhones = await collection.countDocuments();

    // Get count of phones with multiple persons
    const multiPersonPhones = await collection.countDocuments({
      "persons.1": { $exists: true }
    });

    // Get count by person type
    const pipeline = [
      { $unwind: "$persons" },
      { $group: { _id: "$persons.type", count: { $sum: 1 } } }
    ];
    const typeCounts = await collection.aggregate(pipeline).toArray();

    // Get most recent update
    const mostRecent = await collection.findOne(
      {},
      { sort: { updatedAt: -1 }, projection: { updatedAt: 1 } }
    );

    return res.status(200).json({
      success: true,
      statistics: {
        totalPhones,
        multiPersonPhones,
        typeCounts: typeCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        lastUpdated: mostRecent?.updatedAt || null
      }
    });

  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      message: error.message 
    });
  }
};
