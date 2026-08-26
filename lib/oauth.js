'use strict';

const STRATEGY_NAME = 'discord';
const OAUTH_UID_INDEX = `${STRATEGY_NAME}Id:uid`;
const STRATEGY_SET = 'oauth2-multiple:strategies';
const STRATEGY_KEY = `oauth2-multiple:strategies:${STRATEGY_NAME}`;

function normalizedBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function createDiscordOAuth({ db, User, nconf, env = process.env, fetchImpl = global.fetch, log = console }) {
  async function getUid(discordUserId) {
    if (!discordUserId) return null;
    const value = await db.getObjectField(OAUTH_UID_INDEX, String(discordUserId));
    return value === null || value === undefined || value === '' ? null : Number(value);
  }

  async function linkUser(discordUserId, uid) {
    if (!discordUserId || !uid) return;
    const discordId = String(discordUserId);
    const numericUid = Number(uid);
    const existing = await getUid(discordId);
    if (existing && existing !== numericUid) {
      throw new Error(`Discord OAuth identity ${discordId} is already linked to NodeBB uid ${existing}`);
    }
    await db.setObjectField(OAUTH_UID_INDEX, discordId, numericUid);
    if (User?.setUserField) {
      await User.setUserField(numericUid, `${STRATEGY_NAME}Id`, discordId);
    }
  }

  async function backfillImportedUsers() {
    if (!db.scan) return { linked: 0 };
    const keys = await db.scan({ match: 'discord-sync:user:*' });
    let linked = 0;
    for (const mappingKey of keys) {
      const discordUserId = String(mappingKey).slice('discord-sync:user:'.length);
      const uid = await db.getObjectField(mappingKey, 'uid');
      if (!discordUserId || !uid) continue;
      await linkUser(discordUserId, Number(uid));
      linked += 1;
    }
    if (linked) log.info?.(`[discord-sync] Linked ${linked} imported Discord user(s) to OAuth`);
    return { linked };
  }

  async function configureStrategy() {
    const clientId = String(env.DISCORD_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = String(env.DISCORD_OAUTH_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      log.warn?.('[discord-sync] Discord OAuth is not configured; set DISCORD_OAUTH_CLIENT_ID and DISCORD_OAUTH_CLIENT_SECRET');
      return { configured: false };
    }

    const baseUrl = normalizedBaseUrl(nconf?.get?.('url'));
    if (!baseUrl) throw new Error('NodeBB public URL is not configured');

    const strategy = {
      enabled: true,
      authUrl: 'https://discord.com/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      id: clientId,
      secret: clientSecret,
      userRoute: `${baseUrl}/api/discord-sync/v1/oauth/userinfo`,
      scope: 'identify email',
      loginLabel: 'Log in with Discord',
      registerLabel: 'Register with Discord',
      faIcon: 'fa-brands fa-discord',
      forceUsernameViaEmail: 0,
      usernameViaEmail: 0,
      trustEmailVerified: 1,
      syncFullname: 0,
      syncPicture: 0,
      idKey: '',
    };

    await Promise.all([
      db.sortedSetAdd(STRATEGY_SET, Date.now(), STRATEGY_NAME),
      db.setObject(STRATEGY_KEY, strategy),
    ]);
    log.info?.(`[discord-sync] Configured OAuth2 strategy "${STRATEGY_NAME}" (${baseUrl}/auth/${STRATEGY_NAME}/callback)`);
    return { configured: true, callbackUrl: `${baseUrl}/auth/${STRATEGY_NAME}/callback` };
  }

  async function proxyUserInfo(req, res) {
    const authorization = String(req.headers?.authorization || '');
    if (!/^Bearer\s+\S+/i.test(authorization)) {
      return res.status(401).json({ error: 'missing bearer token' });
    }

    let response;
    try {
      response = await fetchImpl('https://discord.com/api/v10/users/@me', {
        headers: { authorization },
      });
    } catch (error) {
      log.error?.(`[discord-sync] Discord OAuth userinfo request failed: ${error.message}`);
      return res.status(502).json({ error: 'discord userinfo unavailable' });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn?.(`[discord-sync] Discord OAuth userinfo returned ${response.status}: ${body.slice(0, 300)}`);
      return res.status(response.status).json({ error: 'discord userinfo rejected' });
    }

    const user = await response.json();
    return res.json({
      id: String(user.id),
      preferred_username: user.username,
      name: user.global_name || user.username,
      email: user.email || null,
      email_verified: Boolean(user.verified),
    });
  }

  return { getUid, linkUser, backfillImportedUsers, configureStrategy, proxyUserInfo };
}

module.exports = {
  STRATEGY_NAME,
  OAUTH_UID_INDEX,
  STRATEGY_SET,
  STRATEGY_KEY,
  createDiscordOAuth,
};
