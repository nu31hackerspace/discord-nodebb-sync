'use strict';
const { createAuth } = require('./lib/auth');
const { createAssets } = require('./lib/assets');
const { createImporter } = require('./lib/importer');

const plugin = {};
plugin.init = async function ({ router }) {
  const db = require.main.require('./src/database');
  const User = require.main.require('./src/user');
  const Topics = require.main.require('./src/topics');
  const Categories = require.main.require('./src/categories');
  const uploadsController = require.main.require('./src/controllers/uploads');
  const assets = createAssets({ uploadsController, User });
  const importer = createImporter({ db, User, Topics, Categories, assets });
  const auth = createAuth();

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
module.exports = plugin;
