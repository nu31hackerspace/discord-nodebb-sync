'use strict';

function discordMessageOptions(content, extra = {}) {
  return {
    content: content || '\u200b',
    // Only user mentions produced by the NodeBB→Discord resolver may ping.
    // Do not allow @everyone/@here or role mentions to leak through raw post text.
    allowedMentions: { parse: ['users'], repliedUser: false },
    ...extra,
  };
}

module.exports = { discordMessageOptions };
