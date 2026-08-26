#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { config } = require('./config');
const { DiscordApi } = require('./discord');
const { NodeBBClient } = require('./nodebb');
const { importChannel } = require('./runner');
const { startGatewaySync } = require('./gateway');
const { waitForNodeBB } = require('./startup');

function validateConfig(cfg) {
  if (!cfg.discordToken || !cfg.guildId || !cfg.secret) {
    throw new Error('Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID and DISCORD_SYNC_SECRET');
  }
}

function validateImportConfig(cfg) {
  validateConfig(cfg);
  if (!cfg.channelIds.length) throw new Error('Pass at least one Discord forum channel with --channel');
}

async function runImport(cfg) {
  validateImportConfig(cfg);
  const discord = new DiscordApi(cfg.discordToken);
  const nodebb = new NodeBBClient(cfg.nodebbUrl, cfg.secret);
  await waitForNodeBB(nodebb);
  for (const channelId of cfg.channelIds) {
    await importChannel({ discord, nodebb, guildId: cfg.guildId, channelId, importBots: cfg.importBots });
  }
}

async function runGateway(cfg) {
  validateConfig(cfg);
  const nodebb = new NodeBBClient(cfg.nodebbUrl, cfg.secret);
  await waitForNodeBB(nodebb);
  const discord = new DiscordApi(cfg.discordToken);
  const client = await startGatewaySync({
    token: cfg.discordToken,
    guildId: cfg.guildId,
    nodebb,
    discordApi: discord,
    importBots: cfg.importBots,
  });

  const shutdown = async (signal) => {
    console.log(`${signal}: closing Discord Gateway connection`);
    client.destroy();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

function applyArgs(cfg, args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--channel' && args[i + 1]) cfg.channelIds = args[++i].split(',').map(x => x.trim()).filter(Boolean);
    else if (args[i] === '--guild' && args[i + 1]) cfg.guildId = args[++i];
  }
  return cfg;
}

async function main() {
  const cmd = process.argv[2] || 'import';
  const cfg = applyArgs(config(), process.argv.slice(3));
  if (cmd === 'fixture') {
    const file = process.argv[3];
    if (!file) throw new Error('Usage: node src/cli.js fixture <payload.json>');
    const nodebb = new NodeBBClient(cfg.nodebbUrl, cfg.secret);
    console.log(await nodebb.importThread(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return;
  }
  if (cmd === 'reset') {
    if (cfg.channelIds.length !== 1) throw new Error('Usage: node src/cli.js reset --channel <discord-channel-id>');
    if (!cfg.secret) throw new Error('Set DISCORD_SYNC_SECRET');
    const nodebb = new NodeBBClient(cfg.nodebbUrl, cfg.secret);
    await waitForNodeBB(nodebb);
    const result = await nodebb.resetChannel(cfg.channelIds[0]);
    console.log(`Reset complete: channel=${result.discordChannelId}, category=${result.cid ?? 'none'}, threads=${result.deletedThreads}, messages=${result.deletedMessages}`);
    return;
  }
  if (cmd === 'import') return runImport(cfg);
  if (cmd === 'sync') return runGateway(cfg);
  throw new Error(`Unknown command: ${cmd}`);
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
