#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { config } = require('./config');
const { DiscordApi } = require('./discord');
const { NodeBBClient } = require('./nodebb');
const { importChannel } = require('./runner');

async function runOnce(cfg) {
  if (!cfg.discordToken || !cfg.guildId || !cfg.channelIds.length || !cfg.secret) throw new Error('Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CHANNEL_IDS and DISCORD_SYNC_SECRET');
  const discord = new DiscordApi(cfg.discordToken); const nodebb = new NodeBBClient(cfg.nodebbUrl, cfg.secret);
  await nodebb.health();
  for (const channelId of cfg.channelIds) await importChannel({ discord, nodebb, guildId: cfg.guildId, channelId, importBots: cfg.importBots });
}
function applyArgs(cfg, args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--channel' && args[i + 1]) cfg.channelIds = args[++i].split(',').map(x => x.trim()).filter(Boolean);
    else if (args[i] === '--guild' && args[i + 1]) cfg.guildId = args[++i];
  }
  return cfg;
}

async function main() {
  const cmd = process.argv[2] || 'import'; const cfg = applyArgs(config(), process.argv.slice(3));
  if (cmd === 'fixture') {
    const file = process.argv[3]; if (!file) throw new Error('Usage: node src/cli.js fixture <payload.json>');
    const nodebb = new NodeBBClient(cfg.nodebbUrl, cfg.secret); console.log(await nodebb.importThread(JSON.parse(fs.readFileSync(file, 'utf8')))); return;
  }
  if (cmd === 'import') return runOnce(cfg);
  if (cmd === 'sync') {
    for (;;) { try { await runOnce(cfg); } catch (e) { console.error(e.stack || e); } await new Promise(r => setTimeout(r, cfg.syncIntervalSeconds * 1000)); }
  }
  throw new Error(`Unknown command: ${cmd}`);
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
