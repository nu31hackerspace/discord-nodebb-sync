'use strict';

const { categoryHandle } = require('./names');

function createImporter({ db, User, Topics, Categories, assets, discordOAuth = null, log = console }) {
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

  async function getUserIdentity(uid, fallbackName = '', discordUserId = '') {
    let username = '';
    let userslug = '';
    if (User.getUserFields) {
      const data = await User.getUserFields(uid, ['username', 'userslug']);
      username = data?.username || '';
      userslug = data?.userslug || '';
    } else if (User.getUserField) {
      username = await User.getUserField(uid, 'username') || '';
      userslug = await User.getUserField(uid, 'userslug') || '';
    }
    username = username || fallbackName || `discord-${discordUserId}`;
    userslug = userslug || username.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
    return { uid: Number(uid), username, userslug: userslug || `discord-${discordUserId}` };
  }

  async function ensureUser(author, timestamp) {
    const desiredUsername = author.username || `discord-${author.discordUserId}`;
    let uid = await mappedInt(key.user(author.discordUserId), 'uid');
    if (!uid && discordOAuth?.getUid) uid = await discordOAuth.getUid(author.discordUserId);
    if (uid) {
      if (User.updateProfile && author.displayName) {
        const current = User.getUserFields ? await User.getUserFields(uid, ['username', 'fullname']) : null;
        const needsUsername = current?.username !== desiredUsername;
        const needsFullname = author.displayName && current?.fullname !== author.displayName;
        if (needsUsername || needsFullname) {
          try {
            await User.updateProfile(uid, {
              uid,
              username: desiredUsername,
              ...(author.displayName ? { fullname: author.displayName } : {}),
            });
          } catch (e) {
            log.warn?.(`user profile sync failed for ${author.discordUserId}: ${e.message}`);
          }
        }
      }
      if (discordOAuth?.linkUser) await discordOAuth.linkUser(author.discordUserId, uid);
      const identity = await getUserIdentity(uid, desiredUsername, author.discordUserId);
      await db.setObject(key.user(author.discordUserId), {
        uid,
        username: identity.username,
        userslug: identity.userslug,
        displayName: author.displayName || '',
        avatarUrl: author.avatarUrl || '',
        updatedAt: Date.now(),
      });
      return identity;
    }
    uid = await User.create({ username: desiredUsername, fullname: author.displayName || desiredUsername, timestamp: timestamp || Date.now() }, { emailVerification: 'skip' });
    if (User.setSetting) await User.setSetting(uid, 'showfullname', 1);
    if (discordOAuth?.linkUser) await discordOAuth.linkUser(author.discordUserId, uid);
    const identity = await getUserIdentity(uid, desiredUsername, author.discordUserId);
    await db.setObject(key.user(author.discordUserId), {
      uid,
      username: identity.username,
      userslug: identity.userslug,
      displayName: author.displayName || '',
      avatarUrl: author.avatarUrl || '',
      updatedAt: Date.now(),
    });
    if (author.avatarUrl) {
      try { await assets.importAvatar(uid, author.avatarUrl); } catch (e) { log.warn?.(`avatar import failed for ${author.discordUserId}: ${e.message}`); }
    }
    return identity;
  }

  async function categoryExists(cid) {
    const categories = await Categories.getCategories([Number(cid)]);
    return categories[0] || null;
  }

  async function syncCategoryMetadata(cid, channelName, channelDescription) {
    const update = {};
    if (channelDescription !== undefined) update.description = channelDescription || '';
    if (channelName) {
      const desiredHandle = categoryHandle(channelName, cid);
      if (desiredHandle) {
        const existing = await Categories.getCategoryField?.(Number(cid), 'handle');
        if (existing !== desiredHandle) {
          update.handle = Categories.generateHandle ? await Categories.generateHandle(desiredHandle) : desiredHandle;
        }
      }
    }
    if (Object.keys(update).length && Categories.update) {
      await Categories.update({ [Number(cid)]: update });
    }
  }

  async function createCategory(discordChannelId, channelName, channelDescription) {
    const category = await Categories.create({
      name: channelName || `Discord ${discordChannelId}`,
      description: channelDescription || '',
    });
    const cid = Number(category.cid);
    await syncCategoryMetadata(cid, channelName, channelDescription);
    return cid;
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
      if (category) {
        await syncCategoryMetadata(cid, payload.channelName, payload.channelDescription);
        return cid;
      }
      cid = null;
    }
    cid = await createCategory(payload.discordChannelId, payload.channelName, payload.channelDescription);
    await saveChannelMapping(payload.discordChannelId, payload.channelName, cid);
    return cid;
  }

  async function configureChannel({ discordGuildId, discordChannelId, channelName, channelDescription = '', cid = null }) {
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
        resolvedCid = await createCategory(discordChannelId, channelName, channelDescription);
        resolvedCategory = await categoryExists(resolvedCid);
      }
    }

    await syncCategoryMetadata(resolvedCid, channelName, channelDescription);
    resolvedCategory = await categoryExists(resolvedCid);

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

  async function resetChannel(discordChannelId) {
    if (!discordChannelId) throw new Error('discordChannelId is required');
    const channelId = String(discordChannelId);
    const cid = await mappedInt(key.channel(channelId), 'cid') || await mappedInt(key.subscription(channelId), 'cid');

    const threadKeys = await db.scan({ match: 'discord-sync:thread:*' });
    const matchedThreads = [];
    const tids = new Set();
    for (const threadKey of threadKeys) {
      const mappedChannelId = await db.getObjectField(threadKey, 'discordChannelId');
      const mappedCid = await mappedInt(threadKey, 'cid');
      if (String(mappedChannelId || '') === channelId || (cid && mappedCid === cid)) {
        matchedThreads.push(threadKey);
        const tid = await mappedInt(threadKey, 'tid');
        if (tid) tids.add(tid);
      }
    }

    const messageKeys = await db.scan({ match: 'discord-sync:message:*' });
    const matchedMessages = [];
    for (const messageKey of messageKeys) {
      const tid = await mappedInt(messageKey, 'tid');
      if (tid && tids.has(tid)) matchedMessages.push(messageKey);
    }

    if (cid) {
      const category = await categoryExists(cid);
      if (category) await Categories.purge(cid, 1);
    }

    const keysToDelete = [
      ...matchedMessages,
      ...matchedThreads,
      key.channel(channelId),
      key.subscription(channelId),
      ...(cid ? [key.category(cid)] : []),
    ];
    await db.deleteAll(keysToDelete);
    await db.sortedSetRemove(key.subscriptions, channelId);

    return {
      discordChannelId: channelId,
      cid: cid || null,
      deletedCategory: Boolean(cid),
      deletedThreads: matchedThreads.length,
      deletedMessages: matchedMessages.length,
    };
  }

  async function renderContent(uid, message) {
    let content = message.content || '';
    const mentions = new Map();
    for (const author of message.mentions || []) {
      if (!author?.discordUserId) continue;
      const identity = await ensureUser(author, message.timestamp);
      mentions.set(String(author.discordUserId), identity);
    }
    content = content.replace(/<@!?(\d+)>/g, (match, discordUserId) => {
      const identity = mentions.get(String(discordUserId));
      return identity ? `@${identity.username}` : match;
    });
    const blocks = await assets.importPostAttachments(uid, message.attachments || []);
    return [content, ...blocks].filter(Boolean).join('\n\n') || '\u200b';
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
      const authorIdentity = await ensureUser(message.author, message.timestamp);
      const uid = authorIdentity.uid;
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

  return { importThread, ensureUser, ensureCategory, configureChannel, getSyncChannel, listSyncChannels, listCategories, resetChannel, key };
}
module.exports = { createImporter };
