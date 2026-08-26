'use strict';

function createNodeBBToDiscordContent({ Posts, User, mappings, log = console }) {
  async function getRawPostContent(pid, fallback = '') {
    if (!pid || !Posts?.getPostFields) return String(fallback || '');
    try {
      const post = await Posts.getPostFields(Number(pid), ['sourceContent', 'content']);
      return String(post?.sourceContent || post?.content || fallback || '');
    } catch (error) {
      log.warn?.(`[discord-sync] Failed to load raw content for pid=${pid}: ${error.message}`);
      return String(fallback || '');
    }
  }

  async function resolveMentionTarget(username) {
    if (!username || !User?.getUidByUsername) return null;
    const uid = Number(await User.getUidByUsername(username));
    if (!uid) return null;

    if (mappings?.getDiscordUserId) {
      const mapped = await mappings.getDiscordUserId(uid);
      if (mapped) return { uid, discordUserId: String(mapped) };
    }

    if (User.getUserField) {
      const discordId = await User.getUserField(uid, 'discordId');
      if (discordId) return { uid, discordUserId: String(discordId) };
    }
    return { uid, discordUserId: null };
  }

  function escapeDiscordMarkdown(value) {
    return String(value || '').replace(/([\\*_~`])/g, '\\$1');
  }

  function fallbackMention(username) {
    return `***${escapeDiscordMarkdown(username)}***`;
  }

  async function convertMentions(content) {
    const source = String(content || '');
    // Imported Discord usernames use Discord's constrained username alphabet,
    // so only those unambiguous NodeBB mentions are translated back.
    const regex = /(^|[^\w@])@([a-z0-9._]{2,32})(?=$|[^a-z0-9._])/gi;
    const matches = [...source.matchAll(regex)];
    if (!matches.length) return source;

    const resolved = new Map();
    for (const match of matches) {
      const username = match[2];
      const key = username.toLowerCase();
      if (!resolved.has(key)) {
        resolved.set(key, await resolveMentionTarget(username));
      }
    }

    return source.replace(regex, (full, prefix, username) => {
      const target = resolved.get(String(username).toLowerCase());
      if (!target) return full;
      return target.discordUserId
        ? `${prefix}<@${target.discordUserId}>`
        : `${prefix}${fallbackMention(username)}`;
    });
  }

  async function preparePost(pid, fallback = '') {
    const raw = await getRawPostContent(pid, fallback);
    return convertMentions(raw);
  }

  return { getRawPostContent, convertMentions, preparePost, fallbackMention };
}

module.exports = { createNodeBBToDiscordContent };
