/**
 * Production server for the Contra Admin UI.
 *
 * Serves the Vite build from ./dist AND proxies /contra-read and /contra-write
 * to the actual Contra RPC nodes. This avoids CORS issues entirely because the
 * browser only ever talks to this origin.
 *
 * Environment variables:
 *   CONTRA_READ_URL  - Contra read RPC endpoint  (default: https://read.onlyoncontra.xyz)
 *   CONTRA_WRITE_URL - Contra write RPC endpoint  (default: https://write.onlyoncontra.xyz)
 *   PORT             - Port to listen on          (default: 3000)
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '3000', 10);
const CONTRA_READ_URL = process.env.CONTRA_READ_URL || 'https://read-node-production.up.railway.app';
const CONTRA_WRITE_URL = process.env.CONTRA_WRITE_URL || 'https://write-node-production.up.railway.app';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

/** Forward a request body to an upstream URL and pipe the response back. */
async function proxy(req, res, targetBase) {
  const body = await collectBody(req);

  try {
    const upstream = await fetch(targetBase, {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
    });

    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': '*',
    });

    const data = Buffer.from(await upstream.arrayBuffer());
    res.end(data);
  } catch (err) {
    console.error(`[proxy] ${targetBase} error:`, err.message);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_error', message: err.message }));
  }
}

function collectBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** Serve a static file from dist/, falling back to index.html for SPA routing. */
async function serveStatic(req, res) {
  let filePath = join(DIST, req.url === '/' ? 'index.html' : req.url);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // File doesn't exist — SPA fallback
    filePath = join(DIST, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';

  // CORS preflight for proxy paths
  if (req.method === 'OPTIONS' && (url.startsWith('/contra-read') || url.startsWith('/contra-write'))) {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, solana-client',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  if (url.startsWith('/contra-read')) {
    return proxy(req, res, CONTRA_READ_URL);
  }

  if (url.startsWith('/contra-write')) {
    return proxy(req, res, CONTRA_WRITE_URL);
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Admin UI server listening on :${PORT}`);
  console.log(`  Contra Read  -> ${CONTRA_READ_URL}`);
  console.log(`  Contra Write -> ${CONTRA_WRITE_URL}`);
});
