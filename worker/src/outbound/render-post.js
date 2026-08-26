'use strict';

function renderPost(author, content) {
  const prefix = author?.displayName ? `**${author.displayName}:** ` : '';
  return `${prefix}${content || '\u200b'}`;
}

function splitDiscordMessage(text, limit = 2000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }
  return chunks;
}

function renderPostChunks(author, content) {
  return splitDiscordMessage(renderPost(author, content));
}

module.exports = { renderPost, splitDiscordMessage, renderPostChunks };
