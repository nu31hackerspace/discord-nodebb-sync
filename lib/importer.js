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
    category: cid => `discord-sync:category:${cid}`,
    subscription: id => `discord-sync:subscription:${id}`,
    subscriptions: 'discord-sync:subscriptions',
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

  async function categoryExists(cid) {
    const categories = await Categories.getCategories([Number(cid)]);
    return categories[0] || null;
  }

  async function createCategory(discordChannelId, channelName) {
    const category = await Categories.create({
      name: channelName || `Discord ${discordChannelId}`,
      description: `Synchronized with Discord channel ${discordChannelId}`,
    });
    return Number(category.cid);
  }

  async function saveChannelMapping(discordChannelId, channelName, cid) {
    const reverseChannelId = await db.getObjectField(key.category(cid), 'discordChannelId');
    if (reverseChannelId && String(reverseChannelId) !== String(discordChannelId)) {
      throw new Error(`NodeBB category ${cid} is already mapped to Discord channel ${reverseChannelId}`);
    }

    const oldCid = await mappedInt(key.channel(discordChannelId), 'cid');
    if (oldCid && oldCid !== Number(cid)) {
      const oldReverse = await db.getObjectField(key.category(oldCid), 'discordChannelId');
      if (String(oldReverse || '') === String(discordChannelId)) {
        await db.deleteObjectField(key.category(oldCid), 'discordChannelId');
      }
    }

    const now = Date.now();
    await db.setObject(key.channel(discordChannelId), { cid: Number(cid), name: channelName || '', updatedAt: now });
    await db.setObject(key.category(cid), { discordChannelId: String(discordChannelId), updatedAt: now });
  }

  async function ensureCategory(payload) {
    let cid = await mappedInt(key.channel(payload.discordChannelId), 'cid');
    if (cid) {
      const category = await categoryExists(cid);
      if (category) return cid;
      cid = null;
    }
    cid = await createCategory(payload.discordChannelId, payload.channelName);
    await saveChannelMapping(payload.discordChannelId, payload.channelName, cid);
    return cid;
  }

  async function configureChannel({ discordGuildId, discordChannelId, channelName, cid = null }) {
    if (!discordChannelId) throw new Error('discordChannelId is required');

    let resolvedCid = cid === null || cid === undefined || cid === '' ? null : Number(cid);
    if (resolvedCid !== null && (!Number.isInteger(resolvedCid) || resolvedCid <= 0)) throw new Error('invalid NodeBB category id');

    let resolvedCategory = null;
    if (resolvedCid !== null) {
      resolvedCategory = await categoryExists(resolvedCid);
      if (!resolvedCategory) throw new Error(`NodeBB category ${resolvedCid} does not exist`);
    } else {
      const existingCid = await mappedInt(key.channel(discordChannelId), 'cid');
      if (existingCid) resolvedCategory = await categoryExists(existingCid);
      if (resolvedCategory) resolvedCid = existingCid;
      else {
        resolvedCid = await createCategory(discordChannelId, channelName);
        resolvedCategory = await categoryExists(resolvedCid);
      }
    }

    await saveChannelMapping(discordChannelId, channelName, resolvedCid);
    const now = Date.now();
    await db.setObject(key.subscription(discordChannelId), {
      enabled: 1,
      guildId: String(discordGuildId || ''),
      channelName: channelName || '',
      cid: resolvedCid,
      updatedAt: now,
    });
    await db.sortedSetAdd(key.subscriptions, now, String(discordChannelId));

    return {
      discordChannelId: String(discordChannelId),
      cid: resolvedCid,
      categoryName: resolvedCategory?.name || channelName || `Category ${resolvedCid}`,
      enabled: true,
    };
  }

  async function getSyncChannel(discordChannelId) {
    if (!discordChannelId) return null;
    const enabled = await db.getObjectField(key.subscription(discordChannelId), 'enabled');
    const cid = await mappedInt(key.subscription(discordChannelId), 'cid');
    const guildId = await db.getObjectField(key.subscription(discordChannelId), 'guildId');
    const channelName = await db.getObjectField(key.subscription(discordChannelId), 'channelName');
    if (enabled === null && cid === null && guildId === null && channelName === null) return null;
    return {
      discordChannelId: String(discordChannelId),
      guildId: String(guildId || ''),
      channelName: channelName || '',
      cid,
      enabled: Boolean(Number(enabled)),
    };
  }

  async function listSyncChannels() {
    const ids = await db.getSortedSetRange(key.subscriptions, 0, -1);
    const rows = [];
    for (const id of ids) {
      const enabled = await db.getObjectField(key.subscription(id), 'enabled');
      if (!Number(enabled)) continue;
      const cid = await mappedInt(key.subscription(id), 'cid');
      const guildId = await db.getObjectField(key.subscription(id), 'guildId');
      const channelName = await db.getObjectField(key.subscription(id), 'channelName');
      rows.push({ discordChannelId: String(id), guildId: String(guildId || ''), channelName: channelName || '', cid });
    }
    return rows;
  }

  async function listCategories() {
    const categories = await Categories.getAllCategories();
    return categories
      .filter(Boolean)
      .map(category => ({ cid: Number(category.cid), name: category.name || `Category ${category.cid}` }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
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

  return { importThread, ensureUser, ensureCategory, configureChannel, getSyncChannel, listSyncChannels, listCategories, key };
}
module.exports = { createImporter, safeUsername };
