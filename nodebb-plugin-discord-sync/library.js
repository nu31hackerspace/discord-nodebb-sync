'use strict';
const { createAuth } = require('./lib/auth');
const { createAssets } = require('./lib/assets');
const { createImporter } = require('./lib/importer');

const plugin = {};
plugin.init = async function ({ router }) {
  const express = require.main.require('express');
  const db = require.main.require('./src/database');
  const User = require.main.require('./src/user');
  const Topics = require.main.require('./src/topics');
  const Categories = require.main.require('./src/categories');
  const uploadsController = require.main.require('./src/controllers/uploads');
  const assets = createAssets({ uploadsController, User });
  const importer = createImporter({ db, User, Topics, Categories, assets });
  const auth = createAuth();
  const json = express.json({ limit: '25mb' });
  router.get('/api/discord-sync/v1/health', auth, (req, res) => res.json({ ok: true, plugin: 'nodebb-plugin-discord-sync', version: '0.1.0' }));
  router.post('/api/discord-sync/v1/thread', auth, json, async (req, res) => {
    try { res.json(await importer.importThread(req.body)); }
    catch (e) { console.error('[discord-sync]', e); res.status(500).json({ error: e.message }); }
  });
};
module.exports = plugin;
