import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNormalizedResult, getHistory, getLocations } from './providers/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const port = process.env.PORT || 3000;

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function contentType(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/html; charset=utf-8';
}

async function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDir, `.${target}`);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'forbidden' });

  try {
    await stat(filePath);
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'public, max-age=60'
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/results') {
    const payload = await getNormalizedResult({
      scopeRaw: url.searchParams.get('scope') || 'brasil',
      provider: url.searchParams.get('provider') || 'auto'
    });
    return json(res, 200, payload);
  }

  if (url.pathname === '/api/history') {
    const points = await getHistory({
      scopeRaw: url.searchParams.get('scope') || 'brasil',
      provider: url.searchParams.get('provider') || 'auto',
      window: url.searchParams.get('window') || '1h'
    });
    return json(res, 200, {
      points,
      gapPolicy: 'missing-as-null'
    });
  }

  if (url.pathname === '/api/locations') {
    const locations = await getLocations();
    return json(res, 200, locations);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  return serveStatic(req, res, url.pathname);
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`voto-aberto-2026 listening on ${port}`);
  });
}

export default server;
