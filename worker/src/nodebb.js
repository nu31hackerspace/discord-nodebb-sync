'use strict';
class NodeBBClient {
  constructor(baseUrl, secret) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.secret = secret; }

  headers(json = false) {
    return { ...(json ? { 'content-type': 'application/json' } : {}), 'x-discord-sync-secret': this.secret };
  }

  async request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers: { ...this.headers(Boolean(options.body)), ...(options.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`NodeBB ${res.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }

  importThread(payload) {
    return this.request('/api/discord-sync/v1/thread', { method: 'POST', body: JSON.stringify(payload) });
  }

  configureChannel(payload) {
    return this.request('/api/discord-sync/v1/channel', { method: 'POST', body: JSON.stringify(payload) });
  }

  async listCategories() {
    const data = await this.request('/api/discord-sync/v1/categories');
    return data.categories || [];
  }

  async listSyncChannels() {
    const data = await this.request('/api/discord-sync/v1/channels');
    return data.channels || [];
  }

  async getSyncChannel(discordChannelId) {
    try {
      return await this.request(`/api/discord-sync/v1/channel/${encodeURIComponent(String(discordChannelId))}`);
    } catch (error) {
      if (/NodeBB 404:/.test(error.message)) return null;
      throw error;
    }
  }

  resetChannel(discordChannelId) {
    return this.request(`/api/discord-sync/v1/channel/${encodeURIComponent(String(discordChannelId))}`, { method: 'DELETE' });
  }

  health() { return this.request('/api/discord-sync/v1/health'); }
}
module.exports = { NodeBBClient };
