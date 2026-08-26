'use strict';

function createMappingRepository({ db }) {
  const key = {
    user: id => `discord-sync:user:${id}`,
    nodebbUser: uid => `discord-sync:nodebb-user:${uid}`,
    channel: id => `discord-sync:channel:${id}`,
    category: cid => `discord-sync:category:${cid}`,
    subscription: id => `discord-sync:subscription:${id}`,
    subscriptions: 'discord-sync:subscriptions',
    thread: id => `discord-sync:thread:${id}`,
    message: id => `discord-sync:message:${id}`,
    nodebbThread: tid => `discord-sync:nodebb-thread:${tid}`,
    nodebbMessage: pid => `discord-sync:nodebb-message:${pid}`,
    channelThreads: id => `discord-sync:channel-threads:${id}`,
    threadMessages: id => `discord-sync:thread-messages:${id}`,
  };

  async function field(k, name) {
    const value = await db.getObjectField(k, name);
    return value === null || value === undefined || value === '' ? null : value;
  }
  async function int(k, name) {
    const value = await field(k, name);
    return value === null ? null : Number(value);
  }
  async function sorted(k) {
    return db.getSortedSetRange ? db.getSortedSetRange(k, 0, -1) : [];
  }
  function parseIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed.map(String) : [String(value)];
    } catch { return [String(value)]; }
  }

  async function getUser(discordUserId) {
    const uid = await int(key.user(discordUserId), 'uid');
    if (!uid) return null;
    return { uid, username: await field(key.user(discordUserId), 'username'), userslug: await field(key.user(discordUserId), 'userslug') };
  }
  async function getDiscordUserId(uid) {
    const value = await field(key.nodebbUser(uid), 'discordUserId');
    return value === null ? null : String(value);
  }
  async function linkUser(discordUserId, data) {
    const now = Date.now();
    const uid = Number(data.uid);
    await db.setObject(key.user(discordUserId), { ...data, uid, updatedAt: now });
    await db.setObject(key.nodebbUser(uid), { discordUserId: String(discordUserId), updatedAt: now });
  }

  async function getChannelCid(discordChannelId) { return int(key.channel(discordChannelId), 'cid'); }
  async function getCategoryChannelId(cid) { const value = await field(key.category(cid), 'discordChannelId'); return value === null ? null : String(value); }
  async function linkChannel(discordChannelId, cid, channelName = '') {
    const reverseChannelId = await getCategoryChannelId(cid);
    if (reverseChannelId && reverseChannelId !== String(discordChannelId)) {
      throw new Error(`NodeBB category ${cid} is already mapped to Discord channel ${reverseChannelId}`);
    }
    const oldCid = await getChannelCid(discordChannelId);
    if (oldCid && oldCid !== Number(cid)) {
      const oldReverse = await getCategoryChannelId(oldCid);
      if (oldReverse === String(discordChannelId) && db.deleteObjectField) await db.deleteObjectField(key.category(oldCid), 'discordChannelId');
    }
    const now = Date.now();
    await db.setObject(key.channel(discordChannelId), { cid: Number(cid), name: channelName || '', updatedAt: now });
    await db.setObject(key.category(cid), { discordChannelId: String(discordChannelId), updatedAt: now });
  }

  async function saveSubscription({ discordGuildId, discordChannelId, channelName, cid, enabled = true }) {
    const now = Date.now();
    await db.setObject(key.subscription(discordChannelId), {
      enabled: enabled ? 1 : 0,
      guildId: String(discordGuildId || ''),
      channelName: channelName || '',
      cid: Number(cid),
      updatedAt: now,
    });
    await db.sortedSetAdd(key.subscriptions, now, String(discordChannelId));
  }
  async function getSubscription(discordChannelId) {
    if (!discordChannelId) return null;
    const enabled = await field(key.subscription(discordChannelId), 'enabled');
    const cid = await int(key.subscription(discordChannelId), 'cid');
    const guildId = await field(key.subscription(discordChannelId), 'guildId');
    const channelName = await field(key.subscription(discordChannelId), 'channelName');
    if (enabled === null && cid === null && guildId === null && channelName === null) return null;
    return { discordChannelId: String(discordChannelId), guildId: String(guildId || ''), channelName: channelName || '', cid, enabled: Boolean(Number(enabled)) };
  }
  async function listEnabledSubscriptions() {
    const rows = [];
    for (const id of await sorted(key.subscriptions)) {
      const row = await getSubscription(id);
      if (row?.enabled) rows.push({ discordChannelId: row.discordChannelId, guildId: row.guildId, channelName: row.channelName, cid: row.cid });
    }
    return rows;
  }

  async function getThreadTid(discordThreadId) { return int(key.thread(discordThreadId), 'tid'); }
  async function getDiscordThreadId(tid) {
    const value = await field(key.nodebbThread(tid), 'discordThreadId');
    return value === null ? null : String(value);
  }
  async function linkThread({ discordThreadId, tid, cid, discordChannelId }) {
    const now = Date.now();
    await db.setObject(key.thread(discordThreadId), { tid: Number(tid), cid: Number(cid), discordChannelId: String(discordChannelId), updatedAt: now });
    await db.setObject(key.nodebbThread(tid), { discordThreadId: String(discordThreadId), updatedAt: now });
    if (db.sortedSetAdd) await db.sortedSetAdd(key.channelThreads(discordChannelId), now, String(discordThreadId));
  }

  async function getMessagePid(discordMessageId) { return int(key.message(discordMessageId), 'pid'); }
  async function getDiscordMessageIds(pid) {
    if (!pid) return [];
    const multi = await field(key.nodebbMessage(pid), 'discordMessageIds');
    if (multi) return parseIds(multi);
    const single = await field(key.nodebbMessage(pid), 'discordMessageId');
    return single ? [String(single)] : [];
  }
  async function getDiscordMessageId(pid) { return (await getDiscordMessageIds(pid))[0] || null; }
  async function linkMessage({ discordMessageId, discordMessageIds, pid, tid, uid, timestamp, discordThreadId = null }) {
    const ids = [...new Set((discordMessageIds || (discordMessageId ? [discordMessageId] : [])).map(String))];
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) {
      await db.setObject(key.message(id), { pid: Number(pid), tid: Number(tid), uid: Number(uid), timestamp: timestamp || now, updatedAt: now });
      if (discordThreadId && db.sortedSetAdd) await db.sortedSetAdd(key.threadMessages(discordThreadId), now, id);
    }
    await db.setObject(key.nodebbMessage(pid), {
      discordMessageId: ids[0],
      discordMessageIds: JSON.stringify(ids),
      updatedAt: now,
    });
  }

  async function channelForCid(cid) {
    const discordChannelId = await getCategoryChannelId(cid);
    if (!discordChannelId) return null;
    const subscription = await getSubscription(discordChannelId);
    if (!subscription?.enabled) return null;
    return { discordChannelId, guildId: subscription.guildId };
  }

  async function collectChannelMappings(discordChannelId, cid = null) {
    let threadIds = await sorted(key.channelThreads(discordChannelId));
    // Compatibility for mappings created before indexes were introduced. This scan is only
    // used by destructive reset, never by normal event lookup.
    if (!threadIds.length && db.scan) {
      const threadKeys = await db.scan({ match: 'discord-sync:thread:*' });
      for (const threadKey of threadKeys) {
        const mappedChannelId = await field(threadKey, 'discordChannelId');
        const mappedCid = await int(threadKey, 'cid');
        if (String(mappedChannelId || '') === String(discordChannelId) || (cid && mappedCid === Number(cid))) {
          threadIds.push(threadKey.slice('discord-sync:thread:'.length));
        }
      }
    }
    threadIds = [...new Set(threadIds.map(String))];
    const tids = new Set();
    const messageIds = [];
    const pids = new Set();
    for (const threadId of threadIds) {
      const tid = await getThreadTid(threadId);
      if (tid) tids.add(tid);
      let ids = await sorted(key.threadMessages(threadId));
      if (!ids.length && db.scan && tid) {
        const messageKeys = await db.scan({ match: 'discord-sync:message:*' });
        for (const messageKey of messageKeys) {
          if (await int(messageKey, 'tid') === tid) ids.push(messageKey.slice('discord-sync:message:'.length));
        }
      }
      for (const id of ids) {
        messageIds.push(String(id));
        const pid = await getMessagePid(id);
        if (pid) pids.add(pid);
      }
    }
    return { threadIds, tids: [...tids], messageIds: [...new Set(messageIds)], pids: [...pids] };
  }

  async function removeChannelMappings(discordChannelId, cid = null) {
    const collected = await collectChannelMappings(discordChannelId, cid);
    const keysToDelete = [
      ...collected.messageIds.map(key.message),
      ...collected.threadIds.map(key.thread),
      ...collected.tids.map(key.nodebbThread),
      ...collected.pids.map(key.nodebbMessage),
      ...collected.threadIds.map(key.threadMessages),
      key.channelThreads(discordChannelId),
      key.channel(discordChannelId),
      key.subscription(discordChannelId),
      ...(cid ? [key.category(cid)] : []),
    ];
    if (db.deleteAll) await db.deleteAll(keysToDelete);
    if (db.sortedSetRemove) await db.sortedSetRemove(key.subscriptions, String(discordChannelId));
    return collected;
  }

  return {
    key, field, int,
    getUser, getDiscordUserId, linkUser,
    getChannelCid, getCategoryChannelId, linkChannel,
    saveSubscription, getSubscription, listEnabledSubscriptions,
    getThreadTid, getDiscordThreadId, linkThread,
    getMessagePid, getDiscordMessageId, getDiscordMessageIds, linkMessage,
    channelForCid, collectChannelMappings, removeChannelMappings,
  };
}

module.exports = { createMappingRepository };
