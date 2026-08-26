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
    async scan({ match }) {
      const prefix = match.endsWith('*') ? match.slice(0, -1) : match;
      return [...objects.keys()].filter(k => k.startsWith(prefix));
    },
    async deleteAll(keys) { for (const k of keys) objects.delete(k); },
    async sortedSetRemove(k, value) { sortedSets.get(k)?.delete(String(value)); },
  };
  const users = []; const posts = []; const categories = [];
  const User = {
    async create(d) { const uid = nextUid++; users.push({ uid, userslug: String(d.username).toLowerCase().replace(/[^a-z0-9_-]+/g, '-'), ...d }); return uid; },
    async getUserFields(uid, fields) {
      const user = users.find(u => u.uid === Number(uid)) || {};
      return Object.fromEntries(fields.map(field => [field, user[field] ?? '']));
    },
    async updateProfile(_callerUid, data) {
      const user = users.find(u => u.uid === Number(data.uid));
      if (!user) throw new Error('user not found');
      if (data.username !== undefined) {
        user.username = data.username;
        user.userslug = String(data.username).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      }
      if (data.fullname !== undefined) user.fullname = data.fullname;
      return user;
    },
  };
  const Categories = {
    async create(d) { const cid = nextCid++; const c = { cid, handle: String(d.name || `category-${cid}`).toLowerCase().replace(/\s+/g, '-'), ...d }; categories.push(c); return c; },
    async getCategories(cids) { return cids.map(cid => categories.find(c => Number(c.cid) === Number(cid)) || null); },
    async getAllCategories() { return [...categories]; },
    async getCategoryField(cid, field) { return categories.find(c => Number(c.cid) === Number(cid))?.[field] ?? null; },
    async generateHandle(handle) {
      let candidate = handle; let suffix = 2;
      while (categories.some(c => c.handle === candidate)) candidate = `${handle}-${suffix++}`;
      return candidate;
    },
    async update(modified) {
      for (const [cid, fields] of Object.entries(modified)) {
        const category = categories.find(c => Number(c.cid) === Number(cid));
        if (category) Object.assign(category, fields);
      }
    },
    async purge(cid) {
      const index = categories.findIndex(c => Number(c.cid) === Number(cid));
      if (index !== -1) categories.splice(index, 1);
    },
  };
  const Topics = {
    async post(d) { const tid = nextTid++; const postData = { pid: nextPid++, tid, uid: d.uid, content: d.content, timestamp: d.timestamp }; posts.push({ kind: 'topic', title: d.title, ...postData }); return { topicData: { tid }, postData }; },
    async reply(d) { const p = { pid: nextPid++, tid: d.tid, uid: d.uid, content: d.content, timestamp: d.timestamp, toPid: d.toPid || null }; posts.push({ kind: 'reply', ...p }); return p; },
  };
  const assets = { async importPostAttachments() { return []; }, async importAvatar() {} };
  return { importer: createImporter({ db, User, Topics, Categories, assets }), objects, users, posts, categories };
}
const payload = {
  discordChannelId: 'c1', channelName: 'Projects', channelDescription: 'Project discussions', discordThreadId: 't1', title: 'Build thing', messages: [
    { discordMessageId: 'm1', timestamp: 1000, content: 'one', replyToDiscordMessageId: null, author: { discordUserId: 'u1', username: 'alice_login', displayName: 'Alice', avatarUrl: null }, attachments: [] },
    { discordMessageId: 'm2', timestamp: 2000, content: 'two', replyToDiscordMessageId: 'm1', author: { discordUserId: 'u2', username: 'bob_login', displayName: 'Bob', avatarUrl: null }, attachments: [] },
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

test('category description comes from Discord channel topic and handle is transliterated', async () => {
  const h = harness();
  const result = await h.importer.configureChannel({
    discordGuildId: 'g1',
    discordChannelId: 'ua',
    channelName: 'Проєкти Київ',
    channelDescription: 'Опис каналу',
  });
  const category = h.categories.find(c => c.cid === result.cid);
  assert.equal(category.description, 'Опис каналу');
  assert.equal(category.handle, 'proyekty-kyyiv');
});

test('category handles transliterate Cyrillic names', () => {
  const { categoryHandle } = require('../../lib/names');
  assert.equal(categoryHandle('Вова Тест'), 'vova-test');
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


test('resetChannel purges one category and its thread/message mappings but keeps users', async () => {
  const h = harness();
  const configured = await h.importer.configureChannel({ discordGuildId: 'g1', discordChannelId: 'c1', channelName: 'Projects' });
  await h.importer.importThread(payload);
  assert.equal(h.categories.length, 1);
  assert.ok(h.objects.get('discord-sync:user:u1'));
  assert.ok(h.objects.get('discord-sync:thread:t1'));
  assert.ok(h.objects.get('discord-sync:message:m1'));

  const result = await h.importer.resetChannel('c1');
  assert.equal(result.cid, configured.cid);
  assert.equal(result.deletedThreads, 1);
  assert.equal(result.deletedMessages, 2);
  assert.equal(h.categories.length, 0);
  assert.equal(h.objects.has('discord-sync:channel:c1'), false);
  assert.equal(h.objects.has('discord-sync:subscription:c1'), false);
  assert.equal(h.objects.has(`discord-sync:category:${configured.cid}`), false);
  assert.equal(h.objects.has('discord-sync:thread:t1'), false);
  assert.equal(h.objects.has('discord-sync:message:m1'), false);
  assert.equal(h.objects.has('discord-sync:message:m2'), false);
  assert.ok(h.objects.get('discord-sync:user:u1'));
  assert.ok(h.objects.get('discord-sync:user:u2'));
});

test('Discord user mention creates the mentioned NodeBB user and reuses it when they later post', async () => {
  const h = harness();
  const mentionPayload = {
    discordChannelId: 'c1', channelName: 'Projects', channelDescription: 'Project discussions', discordThreadId: 'mentions-thread', title: 'Mentions', messages: [
      {
        discordMessageId: 'mention-m1', timestamp: 1000, content: 'hey <@222>', replyToDiscordMessageId: null,
        author: { discordUserId: '111', username: 'alice_login', displayName: 'Alice', avatarUrl: null },
        mentions: [{ discordUserId: '222', username: 'smalltells', displayName: 'Bob Smith', avatarUrl: 'https://example.test/bob.png' }], attachments: [],
      },
      {
        discordMessageId: 'mention-m2', timestamp: 2000, content: 'hello', replyToDiscordMessageId: null,
        author: { discordUserId: '222', username: 'smalltells', displayName: 'Bob Smith', avatarUrl: 'https://example.test/bob.png' },
        mentions: [], attachments: [],
      },
    ],
  };

  const result = await h.importer.importThread(mentionPayload);
  assert.equal(result.createdPosts, 2);
  assert.equal(h.users.length, 2);
  assert.equal(h.posts[0].content, 'hey @smalltells');
  assert.equal(h.users.find(user => user.fullname === 'Bob Smith').username, 'smalltells');
  assert.equal(h.posts[1].uid, h.users.find(user => user.fullname === 'Bob Smith').uid);
  assert.equal(h.objects.get('discord-sync:user:222').uid, h.posts[1].uid);
});


test('existing Discord mapping is reused and profile is synchronized from Discord username and display name', async () => {
  const h = harness();
  await h.importer.ensureUser({ discordUserId: '222', username: 'old-wrong-name', displayName: 'Old Display', avatarUrl: null }, 1000);
  const originalUid = h.objects.get('discord-sync:user:222').uid;

  const identity = await h.importer.ensureUser({ discordUserId: '222', username: 'smalltells', displayName: 'Vova', avatarUrl: null }, 2000);

  assert.equal(identity.uid, originalUid);
  assert.equal(h.users.length, 1);
  assert.equal(h.users[0].username, 'smalltells');
  assert.equal(h.users[0].fullname, 'Vova');
  assert.equal(h.objects.get('discord-sync:user:222').displayName, 'Vova');
});
