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

  async function discordIdForUsername(username) {
    if (!username || !User?.getUidByUsername) return null;
    const uid = Number(await User.getUidByUsername(username));
    if (!uid) return null;

    if (mappings?.getDiscordUserId) {
      const mapped = await mappings.getDiscordUserId(uid);
      if (mapped) return String(mapped);
    }

    if (User.getUserField) {
      const discordId = await User.getUserField(uid, 'discordId');
      if (discordId) return String(discordId);
    }
    return null;
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
        resolved.set(key, await discordIdForUsername(username));
      }
    }

    return source.replace(regex, (full, prefix, username) => {
      const discordId = resolved.get(String(username).toLowerCase());
      return discordId ? `${prefix}<@${discordId}>` : full;
    });
  }

  async function preparePost(pid, fallback = '') {
    const raw = await getRawPostContent(pid, fallback);
    return convertMentions(raw);
  }

  return { getRawPostContent, convertMentions, preparePost };
}

module.exports = { createNodeBBToDiscordContent };
