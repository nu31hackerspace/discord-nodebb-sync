'use strict';
const { createAuth } = require('./lib/auth');
const { createAssets } = require('./lib/assets');
const { createImporter } = require('./lib/importer');
const { createDiscordOAuth } = require('./lib/oauth');
const { createMappingRepository } = require('./lib/mappings/repository');
const { createUserService } = require('./lib/services/users');
const { createDiscordWorkerClient } = require('./lib/clients/discord-worker');
const { createOutboundSyncService } = require('./lib/services/outbound-sync');
const { createNodeBBToDiscordContent } = require('./lib/content/nodebb-to-discord');

const plugin = {};
let outboundSync = null;
plugin.init = async function ({ router }) {
  const db = require.main.require('./src/database');
  const User = require.main.require('./src/user');
  const Topics = require.main.require('./src/topics');
  const Posts = require.main.require('./src/posts');
  const Categories = require.main.require('./src/categories');
  const uploadsController = require.main.require('./src/controllers/uploads');
  const File = require.main.require('./src/file');
  const Plugins = require.main.require('./src/plugins');
  const nconf = require.main.require('nconf');

  const mappings = createMappingRepository({ db });
  const assets = createAssets({ uploadsController, User, File, Plugins });
  const discordOAuth = createDiscordOAuth({ db, User, nconf });
  const importer = createImporter({ db, User, Topics, Categories, assets, discordOAuth, mappings });
  const users = createUserService({ User, mappings, assets, discordOAuth });
  const workerClient = createDiscordWorkerClient({});
  const outboundContent = createNodeBBToDiscordContent({ Posts, User, mappings });
  outboundSync = createOutboundSyncService({ mappings, users, workerClient, content: outboundContent });
  const auth = createAuth();

  router.get('/api/discord-sync/v1/oauth/userinfo', (req, res) => discordOAuth.proxyUserInfo(req, res));
  await discordOAuth.backfillImportedUsers();
  await discordOAuth.configureStrategy();

  router.get('/api/discord-sync/v1/health', auth, (req, res) => res.json({ ok: true, plugin: 'nodebb-plugin-discord-sync', version: '0.1.0' }));
  router.get('/api/discord-sync/v1/categories', auth, async (req, res) => {
    try { res.json({ categories: await importer.listCategories() }); }
    catch (e) { console.error('[discord-sync]', e); res.status(500).json({ error: e.message }); }
  });
  router.get('/api/discord-sync/v1/channels', auth, async (req, res) => {
    try { res.json({ channels: await importer.listSyncChannels() }); }
    catch (e) { console.error('[discord-sync]', e); res.status(500).json({ error: e.message }); }
  });
  router.get('/api/discord-sync/v1/channel/:discordChannelId', auth, async (req, res) => {
    try {
      const channel = await importer.getSyncChannel(req.params.discordChannelId);
      if (!channel) return res.status(404).json({ error: 'channel subscription not found' });
      res.json(channel);
    } catch (e) { console.error('[discord-sync]', e); res.status(500).json({ error: e.message }); }
  });
  router.delete('/api/discord-sync/v1/channel/:discordChannelId', auth, async (req, res) => {
    try { res.json(await importer.resetChannel(req.params.discordChannelId)); }
    catch (e) { console.error('[discord-sync]', e); res.status(500).json({ error: e.message }); }
  });
  router.post('/api/discord-sync/v1/channel', auth, async (req, res) => {
    try { res.json(await importer.configureChannel(req.body)); }
    catch (e) { console.error('[discord-sync]', e); res.status(400).json({ error: e.message }); }
  });
  router.post('/api/discord-sync/v1/thread', auth, async (req, res) => {
    try { res.json(await importer.importThread(req.body)); }
    catch (e) { console.error('[discord-sync]', e); res.status(500).json({ error: e.message }); }
  });
};

plugin.onTopicPost = async payload => outboundSync?.topicCreated(payload);
plugin.onTopicReply = async payload => outboundSync?.replyCreated(payload);

plugin.onOAuthLogin = async function ({ name, user, profile }) {
  if (name !== 'discord' || !user?.uid || !profile?.email || !profile?.email_verified) return;
  const User = require.main.require('./src/user');
  const uid = Number(user.uid);
  const currentEmail = await User.getUserField(uid, 'email');
  if (currentEmail && String(currentEmail).toLowerCase() !== String(profile.email).toLowerCase()) return;
  if (!currentEmail) {
    const available = await User.email.available(profile.email);
    if (!available) return;
    await User.setUserField(uid, 'email', profile.email);
  }
  const confirmed = Number(await User.getUserField(uid, 'email:confirmed'));
  if (!confirmed) await User.email.confirmByUid(uid);
};
module.exports = plugin;
