'use strict';
const { createMappingRepository } = require('./mappings/repository');
const { createUserService } = require('./services/users');
const { createDiscordWorkerClient } = require('./clients/discord-worker');
const { createOutboundSyncService } = require('./services/outbound-sync');

// Compatibility facade. New code should depend on outbound-sync + mapping repository directly.
function createReverseSync({ db, User, workerUrl, secret, log = console, mappings = null, workerClient = null }) {
  const repository = mappings || createMappingRepository({ db });
  const users = createUserService({ User, mappings: repository, assets: { importAvatar: async () => {} }, log });
  const client = workerClient || createDiscordWorkerClient({ workerUrl, secret });
  const service = createOutboundSyncService({ mappings: repository, users, workerClient: client, log });
  return {
    ...service,
    channelForCid: repository.channelForCid,
    discordThreadIdForTid: repository.getDiscordThreadId,
    discordMessageIdForPid: repository.getDiscordMessageId,
  };
}
module.exports = { createReverseSync };
