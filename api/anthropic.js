const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body || '{}'));

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getApiKey(payload) {
  return process.env.ANTHROPIC_API_KEY || process.env.CMF_ANTHROPIC_API_KEY || payload.apiKey;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(res, 405, { error: { message: 'Method not allowed' } });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
    return;
  }

  const apiKey = getApiKey(payload || {});
  const prompt = payload && payload.prompt;
  if (!prompt) {
    sendJson(res, 400, { error: { message: 'Missing prompt' } });
    return;
  }

  if (!apiKey) {
    sendJson(res, 500, {
      error: {
        message: 'Anthropic API key is not configured. Add ANTHROPIC_API_KEY in Vercel Environment Variables, or save a key in the Admin Dashboard for local testing.'
      }
    });
    return;
  }

  const anthropicBody = {
    model: process.env.ANTHROPIC_MODEL || payload.model || DEFAULT_MODEL,
    max_tokens: Number(payload.max_tokens) || 8000,
    messages: [{ role: 'user', content: prompt }]
  };

  try {
    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    });

    const responseText = await anthropicRes.text();
    res.statusCode = anthropicRes.status;
    res.setHeader('Content-Type', anthropicRes.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(responseText);
  } catch (err) {
    sendJson(res, 502, { error: { message: 'Anthropic request failed: ' + err.message } });
  }
};
