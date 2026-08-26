'use strict';

function createImportService({ Topics, mappings, users, categories, content }) {
  async function importThread(payload) {
    if (!payload?.discordThreadId || !payload?.discordChannelId || !Array.isArray(payload.messages)) throw new Error('invalid payload');
    const cid = await categories.ensure(payload);
    let tid = await mappings.getThreadTid(payload.discordThreadId);
    let createdPosts = 0;
    const sorted = [...payload.messages].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    for (const message of sorted) {
      if (await mappings.getMessagePid(message.discordMessageId)) continue;
      const identity = await users.ensure(message.author, message.timestamp);
      const rendered = await content.render(identity.uid, message);
      if (!tid) {
        const result = await Topics.post({ uid: identity.uid, cid, title: payload.title || 'Discord topic', content: rendered, timestamp: message.timestamp, fromQueue: true, _discordSync: true });
        tid = Number(result.topicData.tid);
        const pid = Number(result.postData.pid);
        await mappings.linkThread({ discordThreadId: payload.discordThreadId, tid, cid, discordChannelId: payload.discordChannelId });
        await mappings.linkMessage({ discordMessageId: message.discordMessageId, discordThreadId: payload.discordThreadId, pid, tid, uid: identity.uid, timestamp: message.timestamp });
      } else {
        const toPid = message.replyToDiscordMessageId ? await mappings.getMessagePid(message.replyToDiscordMessageId) : null;
        const post = await Topics.reply({ uid: identity.uid, tid, content: rendered, timestamp: message.timestamp, fromQueue: true, _discordSync: true, ...(toPid ? { toPid } : {}) });
        await mappings.linkMessage({ discordMessageId: message.discordMessageId, discordThreadId: payload.discordThreadId, pid: Number(post.pid), tid, uid: identity.uid, timestamp: message.timestamp });
      }
      createdPosts += 1;
    }
    return { tid, cid, createdPosts, totalMessages: sorted.length };
  }
  return { importThread };
}
module.exports = { createImportService };
