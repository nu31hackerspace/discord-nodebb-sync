'use strict';
const { normalizeThread, normalizeMention } = require('../normalize');

function discordJsMessageToApi(message) {
  return {
    id: String(message.id), timestamp: message.createdAt.toISOString(), edited_timestamp: message.editedAt ? message.editedAt.toISOString() : null,
    content: message.content || '',
    author: { id: String(message.author.id), username: message.author.username, global_name: message.author.globalName || null, avatar: message.author.avatar || null, bot: Boolean(message.author.bot) },
    member: message.member ? { nick: message.member.nickname || null, avatar: message.member.avatar || null } : null,
    message_reference: message.reference?.messageId ? { message_id: String(message.reference.messageId) } : null,
    mentions: [...message.mentions.users.values()].map(user => {
      const member = message.mentions.members?.get(user.id);
      return { id: String(user.id), username: user.username, global_name: user.globalName || null, avatar: user.avatar || null, bot: Boolean(user.bot), member: member ? { nick: member.nickname || null, avatar: member.avatar || null } : null };
    }),
    attachments: [...message.attachments.values()].map(attachment => ({ id: String(attachment.id), filename: attachment.name || `attachment-${attachment.id}`, url: attachment.url, content_type: attachment.contentType || null, size: attachment.size ?? null, width: attachment.width ?? null, height: attachment.height ?? null })),
  };
}
function threadToApi(thread) {
  return { id: String(thread.id), name: thread.name, parent_id: thread.parentId ? String(thread.parentId) : null, thread_metadata: { archived: Boolean(thread.archived), create_timestamp: thread.createdAt ? thread.createdAt.toISOString() : null, archive_timestamp: thread.archiveTimestamp ? new Date(thread.archiveTimestamp).toISOString() : null } };
}
function discordJsReactionActorToApi(user, member = null) {
  return {
    id: String(user.id),
    username: user.username,
    global_name: user.globalName || null,
    avatar: user.avatar || null,
    bot: Boolean(user.bot),
    member: member ? { nick: member.nickname || null, avatar: member.avatar || null } : null,
  };
}
function createDiscordEventHandler({ client, guildId, nodebb, importBots = false, log = console }) {
  async function messageCreate(message) {
    try {
      if (String(message.guildId || '') !== String(guildId) || !message.channel?.isThread?.()) return;
      const subscription = await nodebb.getSyncChannel(String(message.channel.parentId || ''));
      if (!subscription?.enabled || (subscription.guildId && String(subscription.guildId) !== String(guildId))) return;
      if (message.author?.id === client.user?.id || (!importBots && message.author?.bot)) return;
      const parent = message.channel.parent || await message.guild.channels.fetch(message.channel.parentId);
      if (!parent) throw new Error(`Cannot resolve parent channel ${message.channel.parentId}`);
      const payload = normalizeThread(guildId, { id: String(parent.id), name: parent.name, topic: parent.topic || '' }, threadToApi(message.channel), [discordJsMessageToApi(message)], { importBots });
      if (!payload.messages.length) return;
      const result = await nodebb.importThread(payload);
      log.log(`[gateway:${parent.name}] ${message.channel.name}: message ${message.id}, ${result.createdPosts || 0} new post(s), tid=${result.tid}`);
    } catch (error) { log.error(`Gateway message import failed: ${error.stack || error}`); }
  }
  async function reactionEvent(operation, reaction, user) {
    try {
      if (reaction.partial && reaction.fetch) await reaction.fetch();
      let message = reaction.message;
      if (message?.partial && message.fetch) message = await message.fetch();
      if (!message || String(message.guildId || '') !== String(guildId) || !message.channel?.isThread?.()) return;
      if (user?.id === client.user?.id || (!importBots && user?.bot)) return;
      const subscription = await nodebb.getSyncChannel(String(message.channel.parentId || ''));
      if (!subscription?.enabled || (subscription.guildId && String(subscription.guildId) !== String(guildId))) return;
      let member = null;
      try { member = await message.guild?.members?.fetch?.(user.id); } catch {}
      const actor = normalizeMention(guildId, discordJsReactionActorToApi(user, member));
      if (!actor) return;
      const payload = {
        discordMessageId: String(message.id),
        emoji: { id: reaction.emoji?.id ? String(reaction.emoji.id) : null, name: reaction.emoji?.name || '' },
        actor,
        timestamp: Date.now(),
      };
      const result = operation === 'remove' ? await nodebb.removeReaction(payload) : await nodebb.addReaction(payload);
      log.log(`[gateway:reaction] ${operation} ${payload.emoji.name} on ${message.id}: ${result.applied ? 'applied' : result.reason}`);
    } catch (error) { log.error(`Gateway reaction ${operation} failed: ${error.stack || error}`); }
  }
  const reactionAdd = (reaction, user) => reactionEvent('add', reaction, user);
  const reactionRemove = (reaction, user) => reactionEvent('remove', reaction, user);
  return { messageCreate, reactionAdd, reactionRemove };
}
module.exports = { discordJsMessageToApi, discordJsReactionActorToApi, threadToApi, createDiscordEventHandler };
