'use strict';
const { createMappingRepository } = require('./mappings/repository');
const { createUserService } = require('./services/users');
const { createDiscordWorkerClient } = require('./clients/discord-worker');
const { createOutboundSyncService } = require('./services/outbound-sync');
const { createNodeBBToDiscordContent } = require('./content/nodebb-to-discord');

// Compatibility facade. New code should depend on outbound-sync + mapping repository directly.
function createReverseSync({ db, User, Posts = null, workerUrl, secret, log = console, mappings = null, workerClient = null }) {
  const repository = mappings || createMappingRepository({ db });
  const users = createUserService({ User, mappings: repository, assets: { importAvatar: async () => {} }, log });
  const client = workerClient || createDiscordWorkerClient({ workerUrl, secret });
  const content = createNodeBBToDiscordContent({ Posts, User, mappings: repository, log });
  const service = createOutboundSyncService({ mappings: repository, users, workerClient: client, content, log });
  return {
    ...service,
    channelForCid: repository.channelForCid,
    discordThreadIdForTid: repository.getDiscordThreadId,
    discordMessageIdForPid: repository.getDiscordMessageId,
  };
}
module.exports = { createReverseSync };
