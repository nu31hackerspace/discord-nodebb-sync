'use strict';
const fs = require('node:fs');
const path = require('node:path');

function loadEnv(file = '.env') {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function config() {
  loadEnv();
  return {
    discordToken: process.env.DISCORD_BOT_TOKEN || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    channelIds: (process.env.DISCORD_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    nodebbUrl: (process.env.NODEBB_URL || 'http://127.0.0.1:4567').replace(/\/$/, ''),
    secret: process.env.DISCORD_SYNC_SECRET || '',
    importBots: /^(1|true|yes)$/i.test(process.env.IMPORT_BOTS || 'false'),
  };
}
module.exports = { loadEnv, config };
