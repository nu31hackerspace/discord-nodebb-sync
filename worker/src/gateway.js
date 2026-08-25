'use strict';

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { normalizeThread } = require('./normalize');
const { importChannel } = require('./runner');

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
    member: message.member ? { nick: message.member.nickname || null, avatar: message.member.avatar || null } : null,
    message_reference: message.reference?.messageId ? { message_id: String(message.reference.messageId) } : null,
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

function forumSyncCommand() {
  return {
    name: 'forum-sync',
    description: 'Synchronize a Discord forum channel with NodeBB',
    options: [
      {
        type: 7,
        name: 'channel',
        description: 'Discord forum channel to synchronize',
        required: true,
        channel_types: [ChannelType.GuildForum],
      },
      {
        type: 3,
        name: 'category',
        description: 'Existing NodeBB category; omit to create one automatically',
        required: false,
        autocomplete: true,
      },
    ],
  };
}

async function registerForumSyncCommand(guild) {
  const commands = await guild.commands.fetch();
  const existing = commands.find(command => command.name === 'forum-sync');
  if (existing) return existing.edit(forumSyncCommand());
  return guild.commands.create(forumSyncCommand());
}

async function startGatewaySync({ token, guildId, channelIds = [], nodebb, discordApi = null, importBots = false, log = console }) {
  const monitoredChannels = new Set(channelIds.map(String));
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.once('ready', async () => {
    try {
      await nodebb.health();
      const subscriptions = await nodebb.listSyncChannels();
      for (const sub of subscriptions) {
        if (!sub.guildId || String(sub.guildId) === String(guildId)) monitoredChannels.add(String(sub.discordChannelId));
      }
      const guild = await client.guilds.fetch(guildId);
      await registerForumSyncCommand(guild);
      log.log(`Discord Gateway connected as ${client.user.tag}; watching ${monitoredChannels.size} forum channel(s)`);
    } catch (error) {
      log.error(`Discord sync initialization failed: ${error.stack || error}`);
    }
  });

  client.on('interactionCreate', async interaction => {
    try {
      if (String(interaction.guildId || '') !== String(guildId)) return;

      if (interaction.isAutocomplete() && interaction.commandName === 'forum-sync' && interaction.options.getFocused(true).name === 'category') {
        const focused = String(interaction.options.getFocused() || '').trim().toLocaleLowerCase();
        const categories = await nodebb.listCategories();
        const choices = categories
          .filter(category => !focused || category.name.toLocaleLowerCase().includes(focused) || String(category.cid).includes(focused))
          .slice(0, 25)
          .map(category => ({ name: `${category.name} (cid:${category.cid})`.slice(0, 100), value: String(category.cid) }));
        await interaction.respond(choices);
        return;
      }

      if (!interaction.isChatInputCommand() || interaction.commandName !== 'forum-sync') return;
      const channel = interaction.options.getChannel('channel', true);
      if (channel.type !== ChannelType.GuildForum) {
        await interaction.reply({ content: 'The selected channel must be a Discord forum channel.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const categoryValue = interaction.options.getString('category');
      const configured = await nodebb.configureChannel({
        discordGuildId: String(guildId),
        discordChannelId: String(channel.id),
        channelName: channel.name,
        ...(categoryValue ? { cid: Number(categoryValue) } : {}),
      });
      monitoredChannels.add(String(channel.id));

      if (!discordApi) throw new Error('Discord REST API client is not configured for historical import');
      const summary = await importChannel({ discord: discordApi, nodebb, guildId, channelId: channel.id, importBots, log });
      await interaction.editReply(`Synchronization enabled for #${channel.name}. NodeBB cid=${configured.cid}. Imported ${summary.threads} topic(s), ${summary.messages} message(s).`);
    } catch (error) {
      log.error(`Discord interaction failed: ${error.stack || error}`);
      const message = `Synchronization failed: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
      else if (interaction.isRepliable?.()) await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  });

  client.on('messageCreate', async message => {
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
  client.monitoredChannels = monitoredChannels;
  return client;
}

module.exports = { discordJsMessageToApi, threadToApi, forumSyncCommand, registerForumSyncCommand, startGatewaySync };
