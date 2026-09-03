module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PHG-Extension-Key');
    return res.status(200).end();
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-PHG-Extension-Key');

  // Check for SIMPLICITY_API_TOKEN
  const simplicityToken = process.env.SIMPLICITY_API_TOKEN;
  if (!simplicityToken) {
    return res.status(500).json({ 
      ok: false,
      error: 'SIMPLICITY_API_TOKEN not configured' 
    });
  }

  // Optional extension gate key check
  const extensionGateKey = process.env.EXTENSION_GATE_KEY;
  if (extensionGateKey) {
    const providedKey = req.headers['x-phg-extension-key'];
    if (providedKey !== extensionGateKey) {
      return res.status(401).json({ 
        ok: false,
        error: 'Invalid or missing extension key' 
      });
    }
  }

  // Get file number from query param or body
  let fileNumber;
  if (req.method === 'GET') {
    fileNumber = req.query.fileNumber;
  } else if (req.method === 'POST') {
    fileNumber = req.body?.fileNumber;
  } else {
    return res.status(405).json({ 
      ok: false,
      error: 'Method not allowed' 
    });
  }

  if (!fileNumber) {
    return res.status(400).json({ 
      ok: false,
      error: 'File number required' 
    });
  }

  try {
    // Call Simplicity API
    const simplicityResponse = await fetch('https://app.simplicitycollect.com/API/debtors/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ApiToken: simplicityToken,
        DebtorCustomFields: [
          {
            FieldName: 'File Number',
            FieldValue: fileNumber
          }
        ]
      })
    });

    if (!simplicityResponse.ok) {
      return res.status(simplicityResponse.status).json({ 
        ok: false,
        error: `Simplicity API error: ${simplicityResponse.status}` 
      });
    }

    const data = await simplicityResponse.json();

    // Check if we got results
    if (!data || !Array.isArray(data.Debtors) || data.Debtors.length === 0) {
      return res.status(200).json({ 
        ok: false,
        error: 'No debtor found for this file number' 
      });
    }

    const debtor = data.Debtors[0];
    const internalId = debtor.InternalId;

    if (!internalId) {
      return res.status(200).json({ 
        ok: false,
        error: 'No InternalId found for debtor' 
      });
    }

    // Build debtor name if available
    let debtorName = null;
    if (debtor.first_name || debtor.last_name) {
      debtorName = [debtor.first_name, debtor.last_name].filter(Boolean).join(' ');
    }

    // Return success response
    return res.status(200).json({
      ok: true,
      internalId: internalId,
      accountUrl: `https://app.simplicitycollect.com/MasterView.aspx?case_id=${internalId}`,
      ...(debtorName && { debtorName })
    });

  } catch (error) {
    console.error('File search error:', error);
    return res.status(500).json({ 
      ok: false,
      error: 'Server error',
      message: error.message 
    });
  }
};
