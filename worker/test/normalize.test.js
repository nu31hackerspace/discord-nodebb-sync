'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { displayName, normalizeMessage } = require('../src/normalize');

test('display name prefers guild nickname, then global name', () => {
  assert.equal(displayName({ member: { nick: 'Guild Nick' }, author: { global_name: 'Global', username: 'login' } }), 'Guild Nick');
  assert.equal(displayName({ member: {}, author: { global_name: 'Global', username: 'login' } }), 'Global');
});

test('normalizes attachments and reply reference', () => {
  const m = normalizeMessage('1', { id: '9', timestamp: '2025-01-01T00:00:00Z', content: 'hi', author: { id: '2', username: 'u' }, member: {}, message_reference: { message_id: '8' }, attachments: [{ id: '7', filename: 'x.png', url: 'https://x', content_type: 'image/png', size: 3 }] });
  assert.equal(m.replyToDiscordMessageId, '8'); assert.equal(m.attachments[0].name, 'x.png'); assert.equal(m.timestamp, 1735689600000); assert.equal(m.author.username, 'u');
});

test('normalizes mentioned Discord users with guild display name and avatar', () => {
  const m = normalizeMessage('guild1', {
    id: '10', timestamp: '2025-01-01T00:00:00Z', content: '<@2>',
    author: { id: '1', username: 'alice' }, member: {},
    mentions: [{ id: '2', username: 'bob', global_name: 'Bob Global', avatar: 'user-avatar', member: { nick: 'Bob Guild', avatar: 'guild-avatar' } }],
    attachments: [],
  });
  assert.deepEqual(m.mentions, [{
    discordUserId: '2', username: 'bob', displayName: 'Bob Guild',
    avatarUrl: 'https://cdn.discordapp.com/guilds/guild1/users/2/avatars/guild-avatar.png?size=256', bot: false,
  }]);
});
