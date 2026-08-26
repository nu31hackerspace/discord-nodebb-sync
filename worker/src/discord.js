'use strict';

class DiscordApi {
  constructor(token) { this.token = token; this.base = 'https://discord.com/api/v10'; }
  async request(path) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(this.base + path, { headers: { Authorization: `Bot ${this.token}`, 'User-Agent': 'DiscordNodeBBSync/0.1' } });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        await new Promise(r => setTimeout(r, Math.ceil((body.retry_after || 1) * 1000)));
        continue;
      }
      if (!res.ok) throw new Error(`Discord ${res.status} ${path}: ${await res.text()}`);
      return res.json();
    }
    throw new Error(`Discord rate-limit retry budget exhausted: ${path}`);
  }
  channel(id) { return this.request(`/channels/${id}`); }
  member(guildId, userId) { return this.request(`/guilds/${guildId}/members/${userId}`); }
  async activeThreads(guildId, parentId) {
    const data = await this.request(`/guilds/${guildId}/threads/active`);
    return (data.threads || []).filter(t => String(t.parent_id) === String(parentId));
  }
  async archivedThreads(channelId) {
    const out = [];
    let before = null;
    for (;;) {
      const q = new URLSearchParams({ limit: '100' });
      if (before) q.set('before', before);
      const data = await this.request(`/channels/${channelId}/threads/archived/public?${q}`);
      out.push(...(data.threads || []));
      if (!data.has_more || !data.threads?.length) break;
      const last = data.threads[data.threads.length - 1];
      before = last.thread_metadata?.archive_timestamp;
      if (!before) break;
    }
    return out;
  }
  async reactionUsers(channelId, messageId, emoji) {
    const rawEmoji = emoji?.id ? `${emoji.name || ''}:${emoji.id}` : (emoji?.name || '');
    const encoded = encodeURIComponent(rawEmoji);
    const out = [];
    let after = null;
    for (;;) {
      const q = new URLSearchParams({ limit: '100' });
      if (after) q.set('after', after);
      const page = await this.request(`/channels/${channelId}/messages/${messageId}/reactions/${encoded}?${q}`);
      if (!page.length) break;
      out.push(...page);
      after = page[page.length - 1].id;
      if (page.length < 100) break;
    }
    return out;
  }
  async hydrateMessageReactions(guildId, channelId, messages) {
    const memberCache = new Map();
    for (const message of messages) {
      const hydrated = [];
      for (const reaction of message.reactions || []) {
        const rawUsers = await this.reactionUsers(channelId, message.id, reaction.emoji);
        const users = [];
        for (const user of rawUsers) {
          let member = memberCache.get(String(user.id));
          if (member === undefined) {
            member = await this.member(guildId, user.id).catch(() => null);
            memberCache.set(String(user.id), member);
          }
          users.push({ ...user, member: member ? { nick: member.nick || null, avatar: member.avatar || null } : null });
        }
        hydrated.push({ emoji: reaction.emoji, users });
      }
      message._discordSyncReactions = hydrated;
    }
    return messages;
  }
  async messages(channelId) {
    const out = [];
    let before = null;
    for (;;) {
      const q = new URLSearchParams({ limit: '100' });
      if (before) q.set('before', before);
      const page = await this.request(`/channels/${channelId}/messages?${q}`);
      if (!page.length) break;
      out.push(...page);
      before = page[page.length - 1].id;
      if (page.length < 100) break;
    }
    return out.reverse();
  }
}
module.exports = { DiscordApi };
