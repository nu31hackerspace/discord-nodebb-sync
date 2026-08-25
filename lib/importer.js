'use strict';

function safeUsername(name, discordId) {
  const allowed = /^['" \-+.*[\]0-9\u00BF-\u1FFF\u2C00-\uD7FF\w]+$/;
  const cleaned = Array.from(String(name || '')).filter(ch => allowed.test(ch)).join('').trim();
  return cleaned || `discord-${discordId}`;
}

function createImporter({ db, User, Topics, Categories, assets, log = console }) {
  const key = {
    user: id => `discord-sync:user:${id}`,
    channel: id => `discord-sync:channel:${id}`,
    thread: id => `discord-sync:thread:${id}`,
    message: id => `discord-sync:message:${id}`,
  };
  async function mappedInt(k, field) {
    const v = await db.getObjectField(k, field);
    return v === null || v === undefined || v === '' ? null : Number(v);
  }
  async function ensureUser(author, timestamp) {
    let uid = await mappedInt(key.user(author.discordUserId), 'uid');
    if (uid) return uid;
    const username = safeUsername(author.displayName, author.discordUserId);
    uid = await User.create({ username, fullname: author.displayName, timestamp: timestamp || Date.now() }, { emailVerification: 'skip' });
    if (User.setSetting) await User.setSetting(uid, 'showfullname', 1);
    await db.setObject(key.user(author.discordUserId), { uid, displayName: author.displayName, avatarUrl: author.avatarUrl || '', updatedAt: Date.now() });
    if (author.avatarUrl) {
      try { await assets.importAvatar(uid, author.avatarUrl); } catch (e) { log.warn?.(`avatar import failed for ${author.discordUserId}: ${e.message}`); }
    }
    return uid;
  }
  async function ensureCategory(payload) {
    let cid = await mappedInt(key.channel(payload.discordChannelId), 'cid');
    if (cid) return cid;
    const category = await Categories.create({ name: payload.channelName || `Discord ${payload.discordChannelId}`, description: `Imported from Discord channel ${payload.discordChannelId}` });
    cid = Number(category.cid);
    await db.setObject(key.channel(payload.discordChannelId), { cid, name: payload.channelName || '', updatedAt: Date.now() });
    return cid;
  }
  async function renderContent(uid, message) {
    const blocks = await assets.importPostAttachments(uid, message.attachments || []);
    return [message.content || '', ...blocks].filter(Boolean).join('\n\n') || '\u200b';
  }
  async function importThread(payload) {
    if (!payload?.discordThreadId || !payload?.discordChannelId || !Array.isArray(payload.messages)) throw new Error('invalid payload');
    const cid = await ensureCategory(payload);
    let tid = await mappedInt(key.thread(payload.discordThreadId), 'tid');
    let createdPosts = 0;
    const sorted = [...payload.messages].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    for (const message of sorted) {
      const existingPid = await mappedInt(key.message(message.discordMessageId), 'pid');
      if (existingPid) continue;
      const uid = await ensureUser(message.author, message.timestamp);
      const content = await renderContent(uid, message);
      if (!tid) {
        const result = await Topics.post({ uid, cid, title: payload.title || 'Discord topic', content, timestamp: message.timestamp, fromQueue: true });
        tid = Number(result.topicData.tid);
        const pid = Number(result.postData.pid);
        await db.setObject(key.thread(payload.discordThreadId), { tid, cid, discordChannelId: payload.discordChannelId, updatedAt: Date.now() });
        await db.setObject(key.message(message.discordMessageId), { pid, tid, uid, timestamp: message.timestamp, updatedAt: Date.now() });
        createdPosts++;
      } else {
        const toPid = message.replyToDiscordMessageId ? await mappedInt(key.message(message.replyToDiscordMessageId), 'pid') : null;
        const post = await Topics.reply({ uid, tid, content, timestamp: message.timestamp, fromQueue: true, ...(toPid ? { toPid } : {}) });
        await db.setObject(key.message(message.discordMessageId), { pid: Number(post.pid), tid, uid, timestamp: message.timestamp, updatedAt: Date.now() });
        createdPosts++;
      }
    }
    return { tid, cid, createdPosts, totalMessages: sorted.length };
  }
  return { importThread, ensureUser, ensureCategory, key };
}
module.exports = { createImporter, safeUsername };
