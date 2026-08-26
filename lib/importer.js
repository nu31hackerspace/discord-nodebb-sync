'use strict';
const { createMappingRepository } = require('./mappings/repository');
const { createUserService } = require('./services/users');
const { createCategoryService } = require('./services/categories');
const { createDiscordContentRenderer } = require('./content/discord-to-nodebb');
const { createImportService } = require('./services/import');

function createImporter({ db, User, Topics, Categories, assets, discordOAuth = null, reactions = null, log = console, mappings = null }) {
  const repository = mappings || createMappingRepository({ db });
  const users = createUserService({ User, mappings: repository, assets, discordOAuth, log });
  const categories = createCategoryService({ Categories, mappings: repository });
  const content = createDiscordContentRenderer({ users, assets });
  const importer = createImportService({ Topics, mappings: repository, users, categories, content, reactions });

  async function resetChannel(discordChannelId) {
    if (!discordChannelId) throw new Error('discordChannelId is required');
    const channelId = String(discordChannelId);
    const cid = await repository.getChannelCid(channelId) || (await repository.getSubscription(channelId))?.cid || null;
    if (cid) await categories.purge(cid);
    const removed = await repository.removeChannelMappings(channelId, cid);
    return {
      discordChannelId: channelId,
      cid: cid || null,
      deletedCategory: Boolean(cid),
      deletedThreads: removed.threadIds.length,
      deletedMessages: removed.messageIds.length,
    };
  }

  return {
    importThread: importer.importThread,
    ensureUser: users.ensure,
    ensureCategory: categories.ensure,
    configureChannel: categories.configure,
    getSyncChannel: repository.getSubscription,
    listSyncChannels: repository.listEnabledSubscriptions,
    listCategories: categories.list,
    resetChannel,
    key: repository.key,
    mappings: repository,
  };
}
module.exports = { createImporter };
