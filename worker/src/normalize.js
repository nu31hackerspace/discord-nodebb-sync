'use strict';

function avatarUrlForUser(guildId, user = {}, member = {}) {
  if (member.avatar) return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=256`;
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  return null;
}
function avatarUrl(guildId, message) {
  return avatarUrlForUser(guildId, message.author || {}, message.member || {});
}
function displayNameForUser(user = {}, member = {}) {
  return member.nick || user.global_name || user.username || `discord-${user.id || 'unknown'}`;
}
function displayName(message) {
  return displayNameForUser(message.author || {}, message.member || {});
}
function normalizeMention(guildId, mention) {
  const user = mention?.user || mention || {};
  const member = mention?.member || {};
  if (!user.id) return null;
  return {
    discordUserId: String(user.id),
    username: user.username || `discord-${user.id}`,
    displayName: displayNameForUser(user, member),
    avatarUrl: avatarUrlForUser(guildId, user, member),
    bot: Boolean(user.bot),
  };
}
function normalizeMessage(guildId, msg) {
  return {
    discordMessageId: String(msg.id),
    timestamp: Date.parse(msg.timestamp || new Date().toISOString()),
    editedTimestamp: msg.edited_timestamp ? Date.parse(msg.edited_timestamp) : null,
    content: msg.content || '',
    replyToDiscordMessageId: msg.message_reference?.message_id ? String(msg.message_reference.message_id) : null,
    author: {
      discordUserId: String(msg.author.id),
      username: msg.author.username || `discord-${msg.author.id}`,
      displayName: displayName(msg),
      avatarUrl: avatarUrl(guildId, msg),
      bot: Boolean(msg.author.bot),
    },
    mentions: (msg.mentions || []).map(mention => normalizeMention(guildId, mention)).filter(Boolean),
    attachments: (msg.attachments || []).map(a => ({
      id: String(a.id), name: a.filename || `attachment-${a.id}`, url: a.url,
      contentType: a.content_type || null, size: a.size || null,
      width: a.width || null, height: a.height || null,
    })),
  };
}
function normalizeThread(guildId, channel, thread, messages, { importBots = false } = {}) {
  const normalized = messages.map(m => normalizeMessage(guildId, m)).filter(m => importBots || !m.author.bot);
  return {
    discordGuildId: String(guildId),
    discordChannelId: String(channel.id),
    channelName: channel.name || `discord-${channel.id}`,
    channelDescription: channel.topic || '',
    discordThreadId: String(thread.id),
    title: thread.name || `Discord thread ${thread.id}`,
    createdTimestamp: Date.parse(thread.thread_metadata?.create_timestamp || normalized[0]?.timestamp || new Date().toISOString()),
    archived: Boolean(thread.thread_metadata?.archived),
    messages: normalized,
  };
}
module.exports = { avatarUrlForUser, avatarUrl, displayNameForUser, displayName, normalizeMention, normalizeMessage, normalizeThread };
