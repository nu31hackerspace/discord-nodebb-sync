'use strict';
const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { importChannel } = require('../runner');

function commandDefinition() {
  return {
    name: 'forum-sync',
    description: 'Synchronize a Discord forum channel with NodeBB',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { type: 7, name: 'channel', description: 'Discord forum channel to synchronize', required: true, channel_types: [ChannelType.GuildForum] },
      { type: 3, name: 'category', description: 'Existing NodeBB category; omit to create one automatically', required: false, autocomplete: true },
    ],
  };
}
async function register(guild) {
  const commands = await guild.commands.fetch();
  const existing = commands.find(command => command.name === 'forum-sync');
  return existing ? existing.edit(commandDefinition()) : guild.commands.create(commandDefinition());
}
function createForumSyncCommandHandler({ guildId, nodebb, discordApi, importBots = false, log = console }) {
  async function handle(interaction) {
    if (String(interaction.guildId || '') !== String(guildId)) return false;
    if (interaction.isAutocomplete() && interaction.commandName === 'forum-sync' && interaction.options.getFocused(true).name === 'category') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) { await interaction.respond([]); return true; }
      const focused = String(interaction.options.getFocused() || '').trim().toLocaleLowerCase();
      const categories = await nodebb.listCategories();
      await interaction.respond(categories
        .filter(category => !focused || category.name.toLocaleLowerCase().includes(focused) || String(category.cid).includes(focused))
        .slice(0, 25)
        .map(category => ({ name: `${category.name} (cid:${category.cid})`.slice(0, 100), value: String(category.cid) })));
      return true;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'forum-sync') return false;
    try {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'This command is available only to server administrators.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const channel = interaction.options.getChannel('channel', true);
      if (channel.type !== ChannelType.GuildForum) {
        await interaction.reply({ content: 'The selected channel must be a Discord forum channel.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.reply({ content: 'Syncing…', flags: MessageFlags.Ephemeral });
      const categoryValue = interaction.options.getString('category');
      const configured = await nodebb.configureChannel({
        discordGuildId: String(guildId), discordChannelId: String(channel.id), channelName: channel.name, channelDescription: channel.topic || '',
        ...(categoryValue ? { cid: Number(categoryValue) } : {}),
      });
      if (!discordApi) throw new Error('Discord REST API client is not configured for historical import');
      const summary = await importChannel({ discord: discordApi, nodebb, guildId, channelId: channel.id, importBots, log });
      await interaction.editReply(`Ready. #${channel.name} → ${configured.categoryName}\nImported ${summary.threads} topic(s), ${summary.messages} message(s).`);
      return true;
    } catch (error) {
      log.error(`Discord interaction failed: ${error.stack || error}`);
      const message = `Synchronization failed: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
      else if (interaction.isRepliable?.()) await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
  }
  return { handle };
}
module.exports = { commandDefinition, register, createForumSyncCommandHandler };
