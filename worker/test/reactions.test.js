'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReactionService } = require('../../lib/services/reactions');
const { normalizeMessage } = require('../src/normalize');

function serviceHarness({ active = true } = {}) {
  const calls = [];
  const mappings = { async getMessagePid(id) { return id === 'm1' ? 42 : null; } };
  const users = { async ensure(actor) { calls.push(['ensure', actor.discordUserId]); return { uid: 7, username: actor.username }; } };
  const socketPlugins = active ? {
    reactions: {
      async addPostReaction(socket, data) { calls.push(['add', socket.uid, data.pid, data.reaction]); },
      async removePostReaction(socket, data) { calls.push(['remove', socket.uid, data.pid, data.reaction]); },
    },
  } : {};
  const table = {
    thumbsup: { character: '👍' },
    heart: { character: '❤️' },
  };
  const nodebbRequire = id => {
    if (id === './src/socket.io/plugins') return socketPlugins;
    if (id === 'nodebb-plugin-emoji/build/emoji/table.json') return table;
    throw new Error(`unexpected require ${id}`);
  };
  return { reactions: createReactionService({ nodebbRequire, mappings, users, log: { warn() {} } }), calls };
}

test('native Discord reaction is mapped to NodeBB emoji name and user', async () => {
  const h = serviceHarness();
  const result = await h.reactions.applyDiscordEvent({
    operation: 'add', discordMessageId: 'm1', emoji: { id: null, name: '👍' },
    actor: { discordUserId: 'u1', username: 'alice', displayName: 'Alice' },
  });
  assert.equal(result.applied, true);
  assert.deepEqual(h.calls, [['ensure', 'u1'], ['add', 7, 42, 'thumbsup']]);
});

test('custom and unsupported Discord emoji are ignored', async () => {
  const h = serviceHarness();
  assert.equal((await h.reactions.applyDiscordEvent({ operation: 'add', discordMessageId: 'm1', emoji: { id: '123', name: 'party' }, actor: { discordUserId: 'u1' } })).reason, 'custom-emoji');
  assert.equal((await h.reactions.applyDiscordEvent({ operation: 'add', discordMessageId: 'm1', emoji: { id: null, name: '🫥' }, actor: { discordUserId: 'u1' } })).reason, 'unsupported-emoji');
  assert.deepEqual(h.calls, [['ensure', 'u1'], ['ensure', 'u1']]);
});

test('reaction sync is a no-op when NodeBB reactions plugin is inactive', async () => {
  const h = serviceHarness({ active: false });
  const result = await h.reactions.applyDiscordEvent({ operation: 'add', discordMessageId: 'm1', emoji: { id: null, name: '👍' }, actor: { discordUserId: 'u1' } });
  assert.deepEqual(result, { applied: false, reason: 'reactions-plugin-unavailable', uid: 7 });
  assert.deepEqual(h.calls, [['ensure', 'u1']]);
});

test('historical reactions are normalized with reacting Discord users', () => {
  const message = normalizeMessage('g1', {
    id: 'm1', timestamp: '2026-01-01T00:00:00Z', content: 'hello',
    author: { id: 'author', username: 'author' }, member: {}, attachments: [], mentions: [],
    _discordSyncReactions: [{
      emoji: { id: null, name: '👍' },
      users: [{ id: 'u1', username: 'alice', global_name: 'Alice', avatar: null, member: { nick: 'Alice Guild', avatar: null } }],
    }],
  });
  assert.deepEqual(message.reactions, [{
    emoji: { id: null, name: '👍' },
    users: [{ discordUserId: 'u1', username: 'alice', displayName: 'Alice Guild', avatarUrl: null, bot: false }],
  }]);
});
