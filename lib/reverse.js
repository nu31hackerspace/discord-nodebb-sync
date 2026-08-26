'use strict';

function createReverseSync({ db, User, workerUrl = process.env.DISCORD_WORKER_URL || '', secret = process.env.DISCORD_SYNC_SECRET || '', log = console }) {
  const baseUrl = String(workerUrl || '').replace(/\/$/, '');

  async function mappedField(key, field) {
    const value = await db.getObjectField(key, field);
    return value === null || value === undefined || value === '' ? null : value;
  }

  async function findByNumericField(pattern, field, expected) {
    const keys = await db.scan({ match: pattern });
    for (const key of keys) {
      const value = await mappedField(key, field);
      if (value !== null && Number(value) === Number(expected)) return key;
    }
    return null;
  }

  async function channelForCid(cid) {
    const discordChannelId = await mappedField(`discord-sync:category:${cid}`, 'discordChannelId');
    if (!discordChannelId) return null;
    const enabled = await mappedField(`discord-sync:subscription:${discordChannelId}`, 'enabled');
    if (!Number(enabled)) return null;
    const guildId = await mappedField(`discord-sync:subscription:${discordChannelId}`, 'guildId');
    return { discordChannelId: String(discordChannelId), guildId: String(guildId || '') };
  }

  async function discordThreadIdForTid(tid) {
    let discordThreadId = await mappedField(`discord-sync:nodebb-thread:${tid}`, 'discordThreadId');
    if (discordThreadId) return String(discordThreadId);
    const key = await findByNumericField('discord-sync:thread:*', 'tid', tid);
    if (!key) return null;
    discordThreadId = key.slice('discord-sync:thread:'.length);
    await db.setObject(`discord-sync:nodebb-thread:${tid}`, { discordThreadId, updatedAt: Date.now() });
    return discordThreadId;
  }

  async function discordMessageIdForPid(pid) {
    if (!pid) return null;
    let discordMessageId = await mappedField(`discord-sync:nodebb-message:${pid}`, 'discordMessageId');
    if (discordMessageId) return String(discordMessageId);
    const key = await findByNumericField('discord-sync:message:*', 'pid', pid);
    if (!key) return null;
    discordMessageId = key.slice('discord-sync:message:'.length);
    await db.setObject(`discord-sync:nodebb-message:${pid}`, { discordMessageId, updatedAt: Date.now() });
    return discordMessageId;
  }

  async function authorForUid(uid) {
    const user = await User.getUserFields(Number(uid), ['username', 'fullname']);
    return {
      uid: Number(uid),
      username: user?.username || `user-${uid}`,
      displayName: user?.fullname || user?.username || `user-${uid}`,
    };
  }

  async function callWorker(path, body) {
    if (!baseUrl) throw new Error('DISCORD_WORKER_URL is not configured');
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-discord-sync-secret': secret,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Discord worker ${response.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }

  async function saveReverseMappings({ tid, pid, cid, discordChannelId, discordThreadId, discordMessageId, uid }) {
    const now = Date.now();
    if (discordThreadId) {
      await db.setObject(`discord-sync:thread:${discordThreadId}`, {
        tid: Number(tid), cid: Number(cid), discordChannelId: String(discordChannelId), updatedAt: now,
      });
      await db.setObject(`discord-sync:nodebb-thread:${tid}`, { discordThreadId: String(discordThreadId), updatedAt: now });
    }
    if (discordMessageId) {
      await db.setObject(`discord-sync:message:${discordMessageId}`, {
        pid: Number(pid), tid: Number(tid), uid: Number(uid), timestamp: now, updatedAt: now,
      });
      await db.setObject(`discord-sync:nodebb-message:${pid}`, { discordMessageId: String(discordMessageId), updatedAt: now });
    }
  }

  async function topicCreated({ topic, post, data }) {
    if (data?._discordSync) return;
    const cid = Number(topic?.cid ?? data?.cid);
    const tid = Number(topic?.tid ?? post?.tid);
    const pid = Number(post?.pid);
    if (!cid || !tid || !pid) return;
    const channel = await channelForCid(cid);
    if (!channel) return;
    const existingThreadId = await discordThreadIdForTid(tid);
    if (existingThreadId) return;
    const author = await authorForUid(post.uid);
    const result = await callWorker('/v1/nodebb/topic', {
      ...channel,
      cid, tid, pid,
      title: topic?.title || data?.title || `Topic ${tid}`,
      content: post?.content || data?.content || '',
      author,
    });
    await saveReverseMappings({ tid, pid, cid, uid: post.uid, discordChannelId: channel.discordChannelId, ...result });
  }

  async function replyCreated({ post, data }) {
    if (data?._discordSync) return;
    const cid = Number(post?.cid ?? data?.cid ?? post?.topic?.cid);
    const tid = Number(post?.tid ?? data?.tid);
    const pid = Number(post?.pid);
    if (!cid || !tid || !pid) return;
    const channel = await channelForCid(cid);
    if (!channel) return;
    const discordThreadId = await discordThreadIdForTid(tid);
    if (!discordThreadId) {
      log.warn?.(`[discord-sync] NodeBB reply pid=${pid} belongs to tid=${tid}, but no Discord thread mapping exists`);
      return;
    }
    const author = await authorForUid(post.uid);
    const toPid = post?.toPid || data?.toPid || null;
    const discordReplyToMessageId = await discordMessageIdForPid(toPid);
    const result = await callWorker('/v1/nodebb/reply', {
      ...channel,
      cid, tid, pid,
      discordThreadId,
      discordReplyToMessageId,
      content: post?.content || data?.content || '',
      author,
    });
    await saveReverseMappings({ tid, pid, cid, uid: post.uid, discordChannelId: channel.discordChannelId, discordThreadId, ...result });
  }

  async function safe(fn, payload) {
    try { await fn(payload); }
    catch (error) { log.error?.(`[discord-sync] NodeBB → Discord sync failed: ${error.stack || error}`); }
  }

  return {
    topicCreated: payload => safe(topicCreated, payload),
    replyCreated: payload => safe(replyCreated, payload),
    channelForCid,
    discordThreadIdForTid,
    discordMessageIdForPid,
  };
}

module.exports = { createReverseSync };
