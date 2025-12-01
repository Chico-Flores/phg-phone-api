const { MongoClient } = require('mongodb');

// MongoDB connection string - will be set as environment variable in Vercel
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Allow both GET and POST
  let phone;
  
  if (req.method === 'GET') {
    phone = req.query.phone;
  } else if (req.method === 'POST') {
    phone = req.body.phone;
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  try {
    // Clean the phone number
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Connect to MongoDB
    const client = await connectToDatabase();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Look up the phone number
    const result = await collection.findOne({ _id: cleanPhone });

    if (result) {
      return res.status(200).json({
        found: true,
        phone: cleanPhone,
        phoneFormatted: `(${cleanPhone.slice(0,3)}) ${cleanPhone.slice(3,6)}-${cleanPhone.slice(6)}`,
        persons: result.persons,
        updatedAt: result.updatedAt
      });
    } else {
      return res.status(200).json({
        found: false,
        phone: cleanPhone,
        persons: []
      });
    }

  } catch (error) {
    console.error('Lookup error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      message: error.message 
    });
  }
};
