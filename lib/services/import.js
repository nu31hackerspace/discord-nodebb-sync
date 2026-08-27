'use strict';

function createImportService({ Topics, mappings, users, categories, content, reactions = null }) {
  async function importThread(payload) {
    if (!payload?.discordThreadId || !payload?.discordChannelId || !Array.isArray(payload.messages)) throw new Error('invalid payload');
    const cid = await categories.ensure(payload);
    let tid = await mappings.getThreadTid(payload.discordThreadId);
    let createdPosts = 0;
    const sorted = [...payload.messages].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    for (const message of sorted) {
      const existingPid = await mappings.getMessagePid(message.discordMessageId);
      if (existingPid) {
        if (reactions) await reactions.applyMessageReactions(existingPid, message.reactions || []);
        continue;
      }
      const identity = await users.ensure(message.author);
      const rendered = await content.render(identity.uid, message);
      if (!tid) {
        const result = await Topics.post({ uid: identity.uid, cid, title: payload.title || 'Discord topic', content: rendered, timestamp: message.timestamp, fromQueue: true, _discordSync: true });
        tid = Number(result.topicData.tid);
        const pid = Number(result.postData.pid);
        await mappings.linkThread({ discordThreadId: payload.discordThreadId, tid, cid, discordChannelId: payload.discordChannelId });
        await mappings.linkMessage({ discordMessageId: message.discordMessageId, discordThreadId: payload.discordThreadId, pid, tid, uid: identity.uid, timestamp: message.timestamp });
        if (reactions) await reactions.applyMessageReactions(pid, message.reactions || []);
      } else {
        const toPid = message.replyToDiscordMessageId ? await mappings.getMessagePid(message.replyToDiscordMessageId) : null;
        const post = await Topics.reply({ uid: identity.uid, tid, content: rendered, timestamp: message.timestamp, fromQueue: true, _discordSync: true, ...(toPid ? { toPid } : {}) });
        const pid = Number(post.pid);
        await mappings.linkMessage({ discordMessageId: message.discordMessageId, discordThreadId: payload.discordThreadId, pid, tid, uid: identity.uid, timestamp: message.timestamp });
        if (reactions) await reactions.applyMessageReactions(pid, message.reactions || []);
      }
      createdPosts += 1;
    }
    return { tid, cid, createdPosts, totalMessages: sorted.length };
  }
  return { importThread };
}
module.exports = { createImportService };
