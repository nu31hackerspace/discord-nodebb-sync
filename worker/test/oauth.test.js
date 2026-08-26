'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordOAuth, STRATEGY_KEY, STRATEGY_SET } = require('../../lib/oauth');

function harness(env = {}) {
  const objects = new Map();
  const sortedSets = new Map();
  const users = new Map([[7, { uid: 7 }]]);
  const db = {
    async getObjectField(key, field) { return objects.get(key)?.[field] ?? null; },
    async setObjectField(key, field, value) { objects.set(key, { ...(objects.get(key) || {}), [field]: value }); },
    async setObject(key, value) { objects.set(key, { ...value }); },
    async sortedSetAdd(key, score, value) { const set = sortedSets.get(key) || new Map(); set.set(String(value), Number(score)); sortedSets.set(key, set); },
    async scan({ match }) { const prefix = match.endsWith('*') ? match.slice(0, -1) : match; return [...objects.keys()].filter(key => key.startsWith(prefix)); },
  };
  const User = { async setUserField(uid, field, value) { users.set(Number(uid), { ...(users.get(Number(uid)) || {}), [field]: value }); } };
  const nconf = { get(key) { return key === 'url' ? 'https://forum.example.org/' : null; } };
  return { oauth: createDiscordOAuth({ db, User, nconf, env, log: { info() {}, warn() {}, error() {} } }), objects, sortedSets, users };
}

test('configures an enabled Discord OAuth strategy from environment', async () => {
  const h = harness({ DISCORD_OAUTH_CLIENT_ID: 'client-id', DISCORD_OAUTH_CLIENT_SECRET: 'client-secret' });
  const result = await h.oauth.configureStrategy();
  assert.equal(result.configured, true);
  assert.equal(result.callbackUrl, 'https://forum.example.org/auth/discord/callback');
  const strategy = h.objects.get(STRATEGY_KEY);
  assert.equal(strategy.enabled, true);
  assert.equal(strategy.id, 'client-id');
  assert.equal(strategy.secret, 'client-secret');
  assert.equal(strategy.userRoute, 'https://forum.example.org/api/discord-sync/v1/oauth/userinfo');
  assert.equal(strategy.scope, 'identify email');
  assert.ok(h.sortedSets.get(STRATEGY_SET).has('discord'));
});

test('links Discord OAuth identity to an existing NodeBB uid', async () => {
  const h = harness();
  await h.oauth.linkUser('123', 7);
  assert.equal(await h.oauth.getUid('123'), 7);
  assert.equal(h.users.get(7).discordId, '123');
});

test('userinfo proxy normalizes Discord profile fields for oauth2-multiple', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://discord.com/api/v10/users/@me');
    assert.equal(options.headers.authorization, 'Bearer token');
    return {
      ok: true,
      async json() { return { id: '123', username: 'smalltells', global_name: 'Vova', email: 'vova@example.org', verified: true }; },
    };
  };
  const h = harness();
  h.oauth = createDiscordOAuth({
    db: { async getObjectField() {}, async setObjectField() {}, async setObject() {}, async sortedSetAdd() {} },
    User: {}, nconf: { get: () => 'https://forum.example.org' }, env: {}, fetchImpl, log: { info() {}, warn() {}, error() {} },
  });
  let status = 200; let body;
  const req = { headers: { authorization: 'Bearer token' } };
  const res = { status(code) { status = code; return this; }, json(value) { body = value; return value; } };
  await h.oauth.proxyUserInfo(req, res);
  assert.equal(status, 200);
  assert.deepEqual(body, {
    id: '123',
    preferred_username: 'smalltells',
    name: 'Vova',
    email: 'vova@example.org',
    email_verified: true,
  });
});


test('backfills OAuth links for users imported before OAuth support existed', async () => {
  const h = harness();
  h.objects.set('discord-sync:user:555', { uid: 7 });
  const result = await h.oauth.backfillImportedUsers();
  assert.equal(result.linked, 1);
  assert.equal(await h.oauth.getUid('555'), 7);
  assert.equal(h.users.get(7).discordId, '555');
});
