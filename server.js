const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.resolve(__dirname);
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + err.message);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function proxyAnthropic(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (err) {
      console.error('Invalid JSON body:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      return;
    }

    const { prompt, model, max_tokens } = payload;
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CMF_ANTHROPIC_API_KEY || payload.apiKey;
    if (!apiKey || !prompt) {
      console.error('Missing Anthropic API key or prompt in proxy payload');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Missing Anthropic API key or prompt' } }));
      return;
    }

    const anthropicBody = JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || model || DEFAULT_MODEL,
      max_tokens: max_tokens || 8000,
      messages: [{ role: 'user', content: prompt }]
    });

    const anthropicReq = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(anthropicBody),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      },
      anthRes => {
        let responseData = '';
        anthRes.on('data', chunk => {
          responseData += chunk;
        });
        anthRes.on('end', () => {
          const headers = {
            'Content-Type': 'application/json'
          };
          res.writeHead(anthRes.statusCode || 200, headers);
          res.end(responseData);
        });
      }
    );

    anthropicReq.on('error', err => {
      console.error('Anthropic proxy request failed:', err);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Anthropic proxy request failed: ' + err.message } }));
    });

    anthropicReq.write(anthropicBody);
    anthropicReq.end();
  });
}

const server = http.createServer((req, res) => {
  let pathname = req.url.split('?')[0];
  
  if (req.method === 'POST' && (pathname === '/anthropic' || pathname === '/api/anthropic')) {
    proxyAnthropic(req, res);
    return;
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname);
  if (filePath.endsWith(path.sep)) {
    filePath = path.join(filePath, 'index.html');
  }

  try {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Use this server to load the app from http://localhost:8000 instead of file://.');
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
