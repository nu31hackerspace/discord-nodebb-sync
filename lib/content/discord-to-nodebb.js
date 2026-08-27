'use strict';

function createDiscordContentRenderer({ users, assets }) {
  async function render(uid, message) {
    let content = message.content || '';
    const mentions = new Map();
    for (const author of message.mentions || []) {
      if (!author?.discordUserId) continue;
      const identity = await users.ensure(author);
      mentions.set(String(author.discordUserId), identity);
    }
    content = content.replace(/<@!?(\d+)>/g, (match, discordUserId) => {
      const identity = mentions.get(String(discordUserId));
      return identity ? `@${identity.username}` : match;
    });
    const blocks = await assets.importPostAttachments(uid, message.attachments || []);
    return [content, ...blocks].filter(Boolean).join('\n\n') || '\u200b';
  }
  return { render };
}
module.exports = { createDiscordContentRenderer };
