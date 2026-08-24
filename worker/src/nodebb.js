'use strict';
class NodeBBClient {
  constructor(baseUrl, secret) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.secret = secret; }
  async importThread(payload) {
    const res = await fetch(`${this.baseUrl}/api/discord-sync/v1/thread`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-discord-sync-secret': this.secret }, body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`NodeBB ${res.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }
  async health() {
    const res = await fetch(`${this.baseUrl}/api/discord-sync/v1/health`, { headers: { 'x-discord-sync-secret': this.secret } });
    if (!res.ok) throw new Error(`NodeBB health ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
module.exports = { NodeBBClient };
