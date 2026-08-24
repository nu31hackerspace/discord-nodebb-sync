'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const { normalizeThread } = require('./normalize');

function discordJsMessageToApi(message) {
  return {
    id: String(message.id),
    timestamp: message.createdAt.toISOString(),
    edited_timestamp: message.editedAt ? message.editedAt.toISOString() : null,
    content: message.content || '',
    author: {
      id: String(message.author.id),
      username: message.author.username,
      global_name: message.author.globalName || null,
      avatar: message.author.avatar || null,
      bot: Boolean(message.author.bot),
    },
    member: message.member ? {
      nick: message.member.nickname || null,
      avatar: message.member.avatar || null,
    } : null,
    message_reference: message.reference?.messageId ? {
      message_id: String(message.reference.messageId),
    } : null,
    attachments: [...message.attachments.values()].map(attachment => ({
      id: String(attachment.id),
      filename: attachment.name || `attachment-${attachment.id}`,
      url: attachment.url,
      content_type: attachment.contentType || null,
      size: attachment.size ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    })),
  };
}

function threadToApi(thread) {
  return {
    id: String(thread.id),
    name: thread.name,
    parent_id: thread.parentId ? String(thread.parentId) : null,
    thread_metadata: {
      archived: Boolean(thread.archived),
      create_timestamp: thread.createdAt ? thread.createdAt.toISOString() : null,
      archive_timestamp: thread.archiveTimestamp ? new Date(thread.archiveTimestamp).toISOString() : null,
    },
  };
}

async function startGatewaySync({ token, guildId, channelIds, nodebb, importBots = false, log = console }) {
  const monitoredChannels = new Set(channelIds.map(String));
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', async () => {
    log.log(`Discord Gateway connected as ${client.user.tag}; watching ${monitoredChannels.size} forum channel(s)`);
    try { await nodebb.health(); } catch (error) { log.error(`NodeBB health check failed: ${error.message}`); }
  });

  client.on('messageCreate', async (message) => {
    try {
      if (String(message.guildId || '') !== String(guildId)) return;
      if (!message.channel?.isThread?.()) return;
      if (!monitoredChannels.has(String(message.channel.parentId || ''))) return;
      if (!importBots && message.author?.bot) return;

      const parent = message.channel.parent || await message.guild.channels.fetch(message.channel.parentId);
      if (!parent) throw new Error(`Cannot resolve parent channel ${message.channel.parentId}`);

      const payload = normalizeThread(
        guildId,
        { id: String(parent.id), name: parent.name },
        threadToApi(message.channel),
        [discordJsMessageToApi(message)],
        { importBots },
      );
      if (!payload.messages.length) return;

      const result = await nodebb.importThread(payload);
      log.log(`[gateway:${parent.name}] ${message.channel.name}: message ${message.id}, ${result.createdPosts || 0} new post(s), tid=${result.tid}`);
    } catch (error) {
      log.error(`Gateway message import failed: ${error.stack || error}`);
    }
  });

  client.on('error', error => log.error(`Discord Gateway error: ${error.stack || error}`));
  client.on('warn', warning => log.warn(`Discord Gateway warning: ${warning}`));

  await client.login(token);
  return client;
}

module.exports = { discordJsMessageToApi, threadToApi, startGatewaySync };
