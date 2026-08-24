'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createImporter } = require('../nodebb-plugin-discord-sync/lib/importer');

function harness() {
  const objects = new Map(); let nextUid = 10, nextCid = 20, nextTid = 30, nextPid = 40;
  const db = {
    async getObjectField(k, f) { return objects.get(k)?.[f] ?? null; },
    async setObject(k, v) { objects.set(k, { ...(objects.get(k) || {}), ...v }); },
  };
  const users = []; const posts = []; const categories = [];
  const User = { async create(d) { const uid = nextUid++; users.push({ uid, ...d }); return uid; } };
  const Categories = { async create(d) { const c = { cid: nextCid++, ...d }; categories.push(c); return c; } };
  const Topics = {
    async post(d) { const tid = nextTid++; const postData = { pid: nextPid++, tid, uid: d.uid, content: d.content, timestamp: d.timestamp }; posts.push({ kind: 'topic', title: d.title, ...postData }); return { topicData: { tid }, postData }; },
    async reply(d) { const p = { pid: nextPid++, tid: d.tid, uid: d.uid, content: d.content, timestamp: d.timestamp, toPid: d.toPid || null }; posts.push({ kind: 'reply', ...p }); return p; },
  };
  const assets = { async importPostAttachments() { return []; }, async importAvatar() {} };
  return { importer: createImporter({ db, User, Topics, Categories, assets }), objects, users, posts, categories };
}
const payload = {
  discordChannelId: 'c1', channelName: 'Projects', discordThreadId: 't1', title: 'Build thing', messages: [
    { discordMessageId: 'm1', timestamp: 1000, content: 'one', replyToDiscordMessageId: null, author: { discordUserId: 'u1', displayName: 'Alice', avatarUrl: null }, attachments: [] },
    { discordMessageId: 'm2', timestamp: 2000, content: 'two', replyToDiscordMessageId: 'm1', author: { discordUserId: 'u2', displayName: 'Bob', avatarUrl: null }, attachments: [] },
  ],
};

test('imports users/category/topic/reply and preserves timestamps/reply mapping', async () => {
  const h = harness(); const r = await h.importer.importThread(payload);
  assert.equal(r.createdPosts, 2); assert.equal(h.users.length, 2); assert.equal(h.categories.length, 1); assert.equal(h.posts[0].timestamp, 1000); assert.equal(h.posts[1].timestamp, 2000); assert.equal(h.posts[1].toPid, h.posts[0].pid);
});

test('second import is idempotent', async () => {
  const h = harness(); await h.importer.importThread(payload); const r2 = await h.importer.importThread(payload);
  assert.equal(r2.createdPosts, 0); assert.equal(h.users.length, 2); assert.equal(h.posts.length, 2); assert.equal(h.categories.length, 1);
});

test('sanitizes unsupported username characters while keeping import possible', async () => {
  const { safeUsername } = require('../nodebb-plugin-discord-sync/lib/importer');
  assert.equal(safeUsername('Alice 🚀', '77'), 'Alice');
  assert.equal(safeUsername('🚀', '77'), 'discord-77');
});
