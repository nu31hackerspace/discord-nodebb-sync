'use strict';

const http = require('node:http');

function splitContent(author, content) {
  const prefix = author?.displayName ? `**${author.displayName}:** ` : '';
  const text = `${prefix}${content || '\u200b'}`;
  if (text.length <= 2000) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length) {
    chunks.push(remaining.slice(0, 2000));
    remaining = remaining.slice(2000);
  }
  return chunks;
}

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

async function createTopic(client, payload) {
  const forum = await client.channels.fetch(String(payload.discordChannelId));
  if (!forum?.threads?.create) throw new Error(`Discord channel ${payload.discordChannelId} is not a forum channel`);
  const chunks = splitContent(payload.author, payload.content);
  const thread = await forum.threads.create({
    name: String(payload.title || `Topic ${payload.tid}`).slice(0, 100),
    message: { content: chunks[0] || '\u200b' },
  });
  const starter = await thread.fetchStarterMessage();
  for (const chunk of chunks.slice(1)) await thread.send({ content: chunk });
  return { discordThreadId: String(thread.id), discordMessageId: String(starter.id) };
}

async function createReply(client, payload) {
  const thread = await client.channels.fetch(String(payload.discordThreadId));
  if (!thread?.send) throw new Error(`Discord thread ${payload.discordThreadId} is not available`);
  const chunks = splitContent(payload.author, payload.content);
  const first = await thread.send({
    content: chunks[0] || '\u200b',
    ...(payload.discordReplyToMessageId ? { reply: { messageReference: String(payload.discordReplyToMessageId), failIfNotExists: false } } : {}),
  });
  for (const chunk of chunks.slice(1)) await thread.send({ content: chunk });
  return { discordMessageId: String(first.id) };
}

function startBridgeServer({ client, secret, port = 8787, host = '0.0.0.0', log = console }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
      if (String(req.headers['x-discord-sync-secret'] || '') !== String(secret || '')) return json(res, 401, { error: 'unauthorized' });
      const body = await readJson(req);
      if (req.url === '/v1/nodebb/topic') return json(res, 200, await createTopic(client, body));
      if (req.url === '/v1/nodebb/reply') return json(res, 200, await createReply(client, body));
      return json(res, 404, { error: 'not found' });
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

module.exports = { splitContent, createTopic, createReply, startBridgeServer };
