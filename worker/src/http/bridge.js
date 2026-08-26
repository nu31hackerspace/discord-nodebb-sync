'use strict';
const http = require('node:http');

async function readJson(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.length });
  res.end(payload);
}

function startBridgeServer({ handler, secret, port = 8787, host = '0.0.0.0', log = console }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      if (String(req.headers['x-discord-sync-secret'] || '') !== String(secret || '')) return json(res, 401, { error: 'unauthorized' });
      const body = await readJson(req);
      let event = body;
      // Backward-compatible aliases for older NodeBB plugin builds.
      if (req.url === '/v1/nodebb/topic') event = { ...body, type: 'topic.created' };
      else if (req.url === '/v1/nodebb/reply') event = { ...body, type: 'post.created' };
      else if (req.url !== '/v1/nodebb/event') return json(res, 404, { error: 'not found' });
      return json(res, 200, await handler.handle(event));
    } catch (error) {
      log.error?.(`NodeBB → Discord bridge failed: ${error.stack || error}`);
      return json(res, 500, { error: error.message || String(error) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), host, () => {
      server.removeListener('error', reject);
      log.log?.(`NodeBB → Discord bridge listening on ${host}:${port}`);
      resolve(server);
    });
  });
}
module.exports = { readJson, startBridgeServer };
