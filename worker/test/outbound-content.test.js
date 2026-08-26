'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNodeBBToDiscordContent } = require('../../lib/content/nodebb-to-discord');
const { createReverseSync } = require('../../lib/reverse');

function mappingHarness() {
  const objects = new Map([
    ['discord-sync:category:20', { discordChannelId: 'c1' }],
    ['discord-sync:subscription:c1', { enabled: 1, guildId: 'g1', cid: 20 }],
    ['discord-sync:nodebb-user:7', { discordUserId: '334835038093029' }],
  ]);
  const db = {
    async getObjectField(k, f) { return objects.get(k)?.[f] ?? null; },
    async setObject(k, v) { objects.set(k, { ...(objects.get(k) || {}), ...v }); },
    async sortedSetAdd() {},
  };
  return { objects, db };
}

test('NodeBB outbound content uses raw stored post content instead of rendered hook HTML', async () => {
  const h = mappingHarness();
  const User = {
    async getUserFields(uid) { return { username: uid === 7 ? 'hackerspacer' : 'admin', fullname: uid === 7 ? 'Hackerspacer' : 'Admin' }; },
    async getUidByUsername(username) { return username === 'hackerspacer' ? 7 : 0; },
    async getUserField() { return null; },
  };
  const Posts = {
    async getPostFields(pid) {
      assert.equal(pid, 40);
      return { sourceContent: '@hackerspacer\nwassup man!', content: '<p>rendered html</p>' };
    },
  };
  let body;
  const workerClient = {
    async sendEvent(event) {
      body = event;
      return { discordThreadId: 'dt1', discordMessageIds: ['dm1'] };
    },
  };
  const reverse = createReverseSync({ db: h.db, User, Posts, mappings: null, workerClient });
  await reverse.topicCreated({
    topic: { cid: 20, tid: 30, title: 'Hello' },
    post: { pid: 40, tid: 30, uid: 10, content: '<p><a href="/user/hackerspacer">@hackerspacer</a><br />wassup man!</p>' },
    data: {},
  });
  assert.equal(body.content, '<@334835038093029>\nwassup man!');
  assert.equal(body.content.includes('<p'), false);
});

test('NodeBB mentions use Discord mentions when mapped and styled username fallback when unmapped', async () => {
  const h = mappingHarness();
  const User = {
    async getUidByUsername(username) {
      if (username === 'hackerspacer') return 7;
      if (username === 'localuser') return 8;
      if (username === 'local_user') return 9;
      return 0;
    },
    async getUserField(uid, field) {
      if (field === 'discordId' && uid === 7) return '334835038093029';
      return null;
    },
  };
  const content = createNodeBBToDiscordContent({ Posts: null, User, mappings: { async getDiscordUserId(uid) { return uid === 7 ? '334835038093029' : null; } } });
  assert.equal(
    await content.convertMentions('hi @hackerspacer and @localuser and @local_user and @everyone'),
    'hi <@334835038093029> and ***localuser*** and ***local\\_user*** and @everyone',
  );
});
