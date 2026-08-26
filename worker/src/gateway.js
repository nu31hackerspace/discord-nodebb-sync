'use strict';
const { Client, GatewayIntentBits } = require('discord.js');
const { commandDefinition, register, createForumSyncCommandHandler } = require('./commands/forum-sync');
const { discordJsMessageToApi, threadToApi, createDiscordEventHandler } = require('./inbound/discord-events');

async function startGatewaySync({ token, guildId, nodebb, discordApi = null, importBots = false, log = console }) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  const commands = createForumSyncCommandHandler({ guildId, nodebb, discordApi, importBots, log });
  const inbound = createDiscordEventHandler({ client, guildId, nodebb, importBots, log });
  client.once('ready', async () => {
    try {
      await nodebb.health();
      const guild = await client.guilds.fetch(guildId);
      await register(guild);
      log.log(`Discord Gateway connected as ${client.user.tag}; synchronization state is resolved from NodeBB per event`);
    } catch (error) { log.error(`Discord sync initialization failed: ${error.stack || error}`); }
  });
  client.on('interactionCreate', interaction => commands.handle(interaction).catch(error => log.error(`Discord interaction failed: ${error.stack || error}`)));
  client.on('messageCreate', inbound.messageCreate);
  client.on('error', error => log.error(`Discord Gateway error: ${error.stack || error}`));
  client.on('warn', warning => log.warn(`Discord Gateway warning: ${warning}`));
  await client.login(token);
  return client;
}

module.exports = {
  discordJsMessageToApi,
  threadToApi,
  forumSyncCommand: commandDefinition,
  registerForumSyncCommand: register,
  startGatewaySync,
};
