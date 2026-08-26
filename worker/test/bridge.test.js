'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTopic, createReply, splitContent } = require('../src/bridge');

test('bridge creates a Discord forum thread from a NodeBB topic', async () => {
  const sent = [];
  const thread = {
    id: 'thread1',
    async fetchStarterMessage() { return { id: 'starter1' }; },
    async send(message) { sent.push(message); return { id: `extra${sent.length}` }; },
  };
  let options;
  const forum = { threads: { async create(input) { options = input; return thread; } } };
  const client = { channels: { async fetch(id) { assert.equal(id, 'channel1'); return forum; } } };
  const result = await createTopic(client, {
    discordChannelId: 'channel1', title: 'NodeBB topic', content: 'Hello', author: { displayName: 'Alice' }, tid: 1,
  });
  assert.equal(options.name, 'NodeBB topic');
  assert.equal(options.message.content, '**Alice**\nHello');
  assert.deepEqual(result, { discordThreadId: 'thread1', discordMessageId: 'starter1', discordMessageIds: ['starter1'] });
});

test('bridge sends a NodeBB reply as a Discord reply', async () => {
  let options;
  const thread = { async send(input) { options = input; return { id: 'message2' }; } };
  const client = { channels: { async fetch(id) { assert.equal(id, 'thread1'); return thread; } } };
  const result = await createReply(client, {
    discordThreadId: 'thread1', discordReplyToMessageId: 'message1', content: 'Hi', author: { displayName: 'Bob' },
  });
  assert.equal(options.content, '**Bob**\nHi');
  assert.deepEqual(options.reply, { messageReference: 'message1', failIfNotExists: false });
  assert.deepEqual(result, { discordMessageId: 'message2', discordMessageIds: ['message2'] });
});

test('bridge splits messages longer than the Discord 2000 character limit', () => {
  const chunks = splitContent({ displayName: 'Alice' }, 'x'.repeat(3000));
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every(chunk => chunk.length <= 2000));
});
