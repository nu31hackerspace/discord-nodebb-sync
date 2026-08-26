'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReverseSync } = require('../../lib/reverse');

function harness() {
  const objects = new Map();
  const db = {
    async getObjectField(k, f) { return objects.get(k)?.[f] ?? null; },
    async setObject(k, v) { objects.set(k, { ...(objects.get(k) || {}), ...v }); },
    async scan({ match }) { const prefix = match.slice(0, -1); return [...objects.keys()].filter(k => k.startsWith(prefix)); },
  };
  const User = {
    async getUserFields(uid) { return { username: `user${uid}`, fullname: `User ${uid}` }; },
  };
  objects.set('discord-sync:category:20', { discordChannelId: 'c1' });
  objects.set('discord-sync:subscription:c1', { enabled: 1, guildId: 'g1', cid: 20 });
  return { objects, db, User };
}

test('NodeBB topic is sent to worker and reverse mappings are saved', async () => {
  const h = harness();
  const oldFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body), headers: options.headers };
    return { ok: true, status: 200, async text() { return JSON.stringify({ discordThreadId: 'dt1', discordMessageId: 'dm1' }); } };
  };
  try {
    const reverse = createReverseSync({ db: h.db, User: h.User, workerUrl: 'http://worker:8787', secret: 's' });
    await reverse.topicCreated({ topic: { cid: 20, tid: 30, title: 'Hello' }, post: { pid: 40, tid: 30, uid: 10, content: 'Body' }, data: {} });
    assert.equal(request.url, 'http://worker:8787/v1/nodebb/topic');
    assert.equal(request.body.discordChannelId, 'c1');
    assert.equal(request.body.author.displayName, 'User 10');
    assert.equal(h.objects.get('discord-sync:thread:dt1').tid, 30);
    assert.equal(h.objects.get('discord-sync:message:dm1').pid, 40);
    assert.equal(h.objects.get('discord-sync:nodebb-thread:30').discordThreadId, 'dt1');
    assert.equal(h.objects.get('discord-sync:nodebb-message:40').discordMessageId, 'dm1');
  } finally { global.fetch = oldFetch; }
});

test('NodeBB reply reuses thread mapping and preserves reply target', async () => {
  const h = harness();
  h.objects.set('discord-sync:thread:dt1', { tid: 30, cid: 20, discordChannelId: 'c1' });
  h.objects.set('discord-sync:message:dm0', { pid: 39, tid: 30, uid: 9 });
  const oldFetch = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 200, async text() { return JSON.stringify({ discordMessageId: 'dm2' }); } };
  };
  try {
    const reverse = createReverseSync({ db: h.db, User: h.User, workerUrl: 'http://worker:8787', secret: 's' });
    await reverse.replyCreated({ post: { pid: 41, tid: 30, cid: 20, uid: 10, content: 'Reply', toPid: 39 }, data: {} });
    assert.equal(body.discordThreadId, 'dt1');
    assert.equal(body.discordReplyToMessageId, 'dm0');
    assert.equal(h.objects.get('discord-sync:message:dm2').pid, 41);
  } finally { global.fetch = oldFetch; }
});

test('Discord-originated NodeBB posts are not sent back to Discord', async () => {
  const h = harness();
  const oldFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not call'); };
  try {
    const reverse = createReverseSync({ db: h.db, User: h.User, workerUrl: 'http://worker:8787', secret: 's' });
    await reverse.topicCreated({ topic: { cid: 20, tid: 30 }, post: { pid: 40, uid: 10 }, data: { _discordSync: true } });
    await reverse.replyCreated({ post: { pid: 41, tid: 30, cid: 20, uid: 10 }, data: { _discordSync: true } });
    assert.equal(called, false);
  } finally { global.fetch = oldFetch; }
});
