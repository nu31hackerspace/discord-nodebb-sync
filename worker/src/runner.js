'use strict';
const { normalizeThread } = require('./normalize');

async function listThreads(discord, guildId, channelId) {
  const [active, archived] = await Promise.all([discord.activeThreads(guildId, channelId), discord.archivedThreads(channelId)]);
  const byId = new Map();
  for (const t of [...active, ...archived]) byId.set(String(t.id), t);
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
async function importChannel({ discord, nodebb, guildId, channelId, importBots = false, log = console }) {
  const channel = await discord.channel(channelId);
  const threads = await listThreads(discord, guildId, channelId);
  const summary = { channelId: String(channelId), threads: 0, messages: 0 };
  for (const thread of threads) {
    const messages = await discord.messages(thread.id);
    const payload = normalizeThread(guildId, channel, thread, messages, { importBots });
    if (!payload.messages.length) continue;
    const result = await nodebb.importThread(payload);
    summary.threads += 1; summary.messages += payload.messages.length;
    log.log(`[${channel.name}] ${thread.name}: ${result.createdPosts || 0} new posts, tid=${result.tid}`);
  }
  return summary;
}
module.exports = { listThreads, importChannel };
