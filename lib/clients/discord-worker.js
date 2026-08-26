'use strict';
function createDiscordWorkerClient({ workerUrl = process.env.DISCORD_WORKER_URL || '', secret = process.env.DISCORD_SYNC_SECRET || '' }) {
  const baseUrl = String(workerUrl || '').replace(/\/$/, '');
  async function sendEvent(event) {
    if (!baseUrl) throw new Error('DISCORD_WORKER_URL is not configured');
    const response = await fetch(`${baseUrl}/v1/nodebb/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-discord-sync-secret': secret },
      body: JSON.stringify(event),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Discord worker ${response.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  }
  return { sendEvent };
}
module.exports = { createDiscordWorkerClient };
