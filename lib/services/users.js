'use strict';

function createUserService({ User, mappings, assets, discordOAuth = null, log = console }) {
  async function getIdentity(uid, fallbackName = '', discordUserId = '') {
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

  async function ensure(author) {
    const desiredUsername = author.username || `discord-${author.discordUserId}`;
    let uid = (await mappings.getUser(author.discordUserId))?.uid || null;
    if (!uid && discordOAuth?.getUid) uid = await discordOAuth.getUid(author.discordUserId);
    if (uid) {
      if (User.updateProfile && author.displayName) {
        const current = User.getUserFields ? await User.getUserFields(uid, ['username', 'fullname']) : null;
        if (current?.username !== desiredUsername || current?.fullname !== author.displayName) {
          try {
            await User.updateProfile(uid, { uid, username: desiredUsername, fullname: author.displayName });
          } catch (error) {
            log.warn?.(`user profile sync failed for ${author.discordUserId}: ${error.message}`);
          }
        }
      }
      if (discordOAuth?.linkUser) await discordOAuth.linkUser(author.discordUserId, uid);
      const identity = await getIdentity(uid, desiredUsername, author.discordUserId);
      await mappings.linkUser(author.discordUserId, { ...identity, displayName: author.displayName || '', avatarUrl: author.avatarUrl || '' });
      return identity;
    }

    uid = await User.create({ username: desiredUsername, fullname: author.displayName || desiredUsername, timestamp: Date.now() }, { emailVerification: 'skip' });
    if (User.setSetting) await User.setSetting(uid, 'showfullname', 1);
    if (discordOAuth?.linkUser) await discordOAuth.linkUser(author.discordUserId, uid);
    const identity = await getIdentity(uid, desiredUsername, author.discordUserId);
    await mappings.linkUser(author.discordUserId, { ...identity, displayName: author.displayName || '', avatarUrl: author.avatarUrl || '' });
    if (author.avatarUrl) {
      try { await assets.importAvatar(uid, author.avatarUrl); }
      catch (error) { log.warn?.(`avatar import failed for ${author.discordUserId}: ${error.message}`); }
    }
    return identity;
  }

  async function authorForUid(uid) {
    const user = await User.getUserFields(Number(uid), ['username', 'fullname']);
    return { uid: Number(uid), username: user?.username || `user-${uid}`, displayName: user?.fullname || user?.username || `user-${uid}` };
  }

  return { ensure, getIdentity, authorForUid };
}

module.exports = { createUserService };
