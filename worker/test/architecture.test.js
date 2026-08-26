'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPostChunks } = require('../src/outbound/render-post');
const { createNodeBBEventHandler } = require('../src/outbound/nodebb-events');
const { createMappingRepository } = require('../../lib/mappings/repository');

test('shared NodeBB post renderer produces the author header used by outbound events', async () => {
  assert.deepEqual(renderPostChunks({ displayName: 'Vova' }, 'hello'), ['**Vova:** hello']);
  const calls = [];
  const thread = { id: 't1', async fetchStarterMessage() { return { id: 'm1' }; }, async send(input) { calls.push(input); return { id: `m${calls.length + 1}` }; } };
  const client = { channels: { async fetch() { return { threads: { async create(input) { calls.push(input.message); return thread; } } }; } } };
  const handler = createNodeBBEventHandler({ client });
  await handler.handle({ type: 'topic.created', discordChannelId: 'c1', tid: 1, title: 'Topic', author: { displayName: 'Vova' }, content: 'hello' });
  assert.equal(calls[0].content, '**Vova:** hello');
});

test('mapping repository stores all Discord chunks for one NodeBB pid', async () => {
  const objects = new Map();
  const sorted = new Map();
  const db = {
    async getObjectField(k, f) { return objects.get(k)?.[f] ?? null; },
    async setObject(k, v) { objects.set(k, { ...(objects.get(k) || {}), ...v }); },
    async sortedSetAdd(k, score, value) { const s = sorted.get(k) || []; s.push(String(value)); sorted.set(k, s); },
    async getSortedSetRange(k) { return sorted.get(k) || []; },
  };
  const mappings = createMappingRepository({ db });
  await mappings.linkMessage({ discordMessageIds: ['m1', 'm2', 'm3'], discordThreadId: 't1', pid: 42, tid: 7, uid: 3 });
  assert.deepEqual(await mappings.getDiscordMessageIds(42), ['m1', 'm2', 'm3']);
  assert.equal(await mappings.getDiscordMessageId(42), 'm1');
  assert.equal(await mappings.getMessagePid('m3'), 42);
});
