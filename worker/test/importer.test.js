'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createImporter } = require('../../lib/importer');

function harness() {
  const objects = new Map(); let nextUid = 10, nextCid = 20, nextTid = 30, nextPid = 40;
  const sortedSets = new Map();
  const db = {
    async getObjectField(k, f) { return objects.get(k)?.[f] ?? null; },
    async setObject(k, v) { objects.set(k, { ...(objects.get(k) || {}), ...v }); },
    async deleteObjectField(k, f) {
      const value = { ...(objects.get(k) || {}) };
      delete value[f];
      objects.set(k, value);
    },
    async sortedSetAdd(k, score, value) {
      const set = sortedSets.get(k) || new Map();
      set.set(String(value), Number(score));
      sortedSets.set(k, set);
    },
    async getSortedSetRange(k) {
      return [...(sortedSets.get(k) || new Map()).entries()].sort((a, b) => a[1] - b[1]).map(([value]) => value);
    },
  };
  const users = []; const posts = []; const categories = [];
  const User = { async create(d) { const uid = nextUid++; users.push({ uid, ...d }); return uid; } };
  const Categories = {
    async create(d) { const c = { cid: nextCid++, ...d }; categories.push(c); return c; },
    async getCategories(cids) { return cids.map(cid => categories.find(c => Number(c.cid) === Number(cid)) || null); },
    async getAllCategories() { return [...categories]; },
  };
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
  const { safeUsername } = require('../../lib/importer');
  assert.equal(safeUsername('Alice 🚀', '77'), 'Alice');
  assert.equal(safeUsername('🚀', '77'), 'discord-77');
});


test('configureChannel creates a NodeBB category even when there are no Discord messages', async () => {
  const h = harness();
  const result = await h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'empty', channelName: 'Empty forum' });
  assert.equal(h.categories.length, 1);
  assert.equal(h.categories[0].name, 'Empty forum');
  assert.equal(result.cid, h.categories[0].cid);
  assert.equal(result.categoryName, 'Empty forum');
  const channels = await h.importer.listSyncChannels();
  assert.deepEqual(channels, [{ discordChannelId: 'empty', guildId: 'g1', channelName: 'Empty forum', cid: result.cid }]);
});

test('configureChannel can bind a Discord channel to an existing NodeBB category', async () => {
  const h = harness();
  const existing = await h.importer.ensureCategory({ discordChannelId: 'seed', channelName: 'Existing' });
  // Remove the seed mapping so the category is available for an explicit binding in this isolated test.
  h.objects.delete(`discord-sync:category:${existing}`);
  const result = await h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'c2', channelName: 'Discord name', cid: existing });
  assert.equal(result.cid, existing);
  assert.equal(result.categoryName, 'Existing');
  assert.equal(h.categories.length, 1);
  assert.equal(h.objects.get('discord-sync:channel:c2').cid, existing);
});

test('configureChannel rejects a category already mapped to another Discord channel', async () => {
  const h = harness();
  const first = await h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'c1', channelName: 'One' });
  await assert.rejects(
    () => h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'c2', channelName: 'Two', cid: first.cid }),
    /already mapped/,
  );
});

test('listCategories returns NodeBB category ids and names', async () => {
  const h = harness();
  await h.importer.ensureCategory({ discordChannelId: 'a', channelName: 'Zulu' });
  await h.importer.ensureCategory({ discordChannelId: 'b', channelName: 'Alpha' });
  assert.deepEqual(await h.importer.listCategories(), [
    { cid: 21, name: 'Alpha' },
    { cid: 20, name: 'Zulu' },
  ]);
});

test('getSyncChannel returns persistent subscription state for a configured channel', async () => {
  const h = harness();
  const configured = await h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'c1', channelName: 'Projects' });
  assert.deepEqual(await h.importer.getSyncChannel('c1'), {
    discordChannelId: 'c1',
    guildId: 'g1',
    channelName: 'Projects',
    cid: configured.cid,
    enabled: true,
  });
});

test('getSyncChannel returns null for an unknown channel and reflects disabled state', async () => {
  const h = harness();
  assert.equal(await h.importer.getSyncChannel('missing'), null);
  await h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'c1', channelName: 'Projects' });
  h.objects.set('discord-sync:subscription:c1', { ...h.objects.get('discord-sync:subscription:c1'), enabled: 0 });
  assert.equal((await h.importer.getSyncChannel('c1')).enabled, false);
});
