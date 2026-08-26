'use strict';

async function createTopic(client, payload, chunks) {
  const forum = await client.channels.fetch(String(payload.discordChannelId));
  if (!forum?.threads?.create) throw new Error(`Discord channel ${payload.discordChannelId} is not a forum channel`);
  const thread = await forum.threads.create({
    name: String(payload.title || `Topic ${payload.tid}`).slice(0, 100),
    message: { content: chunks[0] || '\u200b' },
  });
  const starter = await thread.fetchStarterMessage();
  const messageIds = [String(starter.id)];
  for (const chunk of chunks.slice(1)) {
    const sent = await thread.send({ content: chunk });
    messageIds.push(String(sent.id));
  }
  return { discordThreadId: String(thread.id), discordMessageId: messageIds[0], discordMessageIds: messageIds };
}

async function createReply(client, payload, chunks) {
  const thread = await client.channels.fetch(String(payload.discordThreadId));
  if (!thread?.send) throw new Error(`Discord thread ${payload.discordThreadId} is not available`);
  const first = await thread.send({
    content: chunks[0] || '\u200b',
    ...(payload.discordReplyToMessageId ? { reply: { messageReference: String(payload.discordReplyToMessageId), failIfNotExists: false } } : {}),
  });
  const messageIds = [String(first.id)];
  for (const chunk of chunks.slice(1)) {
    const sent = await thread.send({ content: chunk });
    messageIds.push(String(sent.id));
  }
  return { discordMessageId: messageIds[0], discordMessageIds: messageIds };
}

module.exports = { createTopic, createReply };
