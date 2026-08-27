'use strict';

function createReactionService({ nodebbRequire, mappings, users, log = console }) {
  let unicodeToName = null;

  function canonicalUnicode(value) {
    return String(value || '').normalize('NFC').replace(/\uFE0F/g, '');
  }

  function socketApi() {
    try {
      return nodebbRequire('./src/socket.io/plugins')?.reactions || null;
    } catch {
      return null;
    }
  }

  function emojiName(character) {
    if (!character) return null;
    if (!unicodeToName) {
      unicodeToName = new Map();
      try {
        const table = nodebbRequire('nodebb-plugin-emoji/build/emoji/table.json');
        for (const [name, emoji] of Object.entries(table || {})) {
          const character = canonicalUnicode(emoji?.character);
          if (character && !unicodeToName.has(character)) unicodeToName.set(character, name);
        }
      } catch (error) {
        log.warn?.(`[discord-sync] emoji table unavailable; reactions will be ignored: ${error.message}`);
      }
    }
    return unicodeToName.get(canonicalUnicode(character)) || null;
  }

  function resolveEmoji(emoji = {}) {
    // Discord custom emoji have an id. We only synchronize native Unicode emoji
    // that are present in NodeBB's active nodebb-plugin-emoji table.
    if (emoji.id) return null;
    return emojiName(emoji.name || emoji.character || '');
  }

  async function apply({ operation = 'add', pid, emoji, actor, timestamp = Date.now() }) {
    if (!actor?.discordUserId) return { applied: false, reason: 'missing-user' };
    // Seeing a Discord user in a reaction is enough to establish identity, even if
    // the concrete emoji cannot be represented in NodeBB or reactions are disabled.
    const identity = await users.ensure(actor);

    const api = socketApi();
    const method = operation === 'remove' ? api?.removePostReaction : api?.addPostReaction;
    if (typeof method !== 'function') return { applied: false, reason: 'reactions-plugin-unavailable', uid: identity.uid };

    const reaction = resolveEmoji(emoji);
    if (!reaction) return { applied: false, reason: emoji?.id ? 'custom-emoji' : 'unsupported-emoji', uid: identity.uid };
    try {
      await method({ uid: identity.uid }, { pid: Number(pid), reaction });
      return { applied: true, reaction, uid: identity.uid };
    } catch (error) {
      // Reaction sync is deliberately best-effort. Limits/settings in the reactions
      // plugin must not make the surrounding Discord import fail.
      log.warn?.(`[discord-sync] reaction ${operation} skipped for pid=${pid}: ${error.message}`);
      return { applied: false, reason: 'reactions-plugin-rejected', error: error.message };
    }
  }

  async function applyMessageReactions(pid, reactions = []) {
    const summary = { applied: 0, skipped: 0 };
    for (const item of reactions || []) {
      for (const actor of item.users || []) {
        const result = await apply({ operation: 'add', pid, emoji: item.emoji, actor, timestamp: item.timestamp || Date.now() });
        if (result.applied) summary.applied += 1;
        else summary.skipped += 1;
      }
    }
    return summary;
  }

  async function applyDiscordEvent({ operation, discordMessageId, emoji, actor, timestamp }) {
    const pid = await mappings.getMessagePid(discordMessageId);
    if (!pid) return { applied: false, reason: 'message-not-mapped' };
    return apply({ operation, pid, emoji, actor, timestamp });
  }

  return { resolveEmoji, apply, applyMessageReactions, applyDiscordEvent };
}

module.exports = { createReactionService };
