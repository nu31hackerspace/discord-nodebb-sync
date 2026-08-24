# Discord → NodeBB sync

One source repository, two runtime images:

- `nodebb-plugin/` — native NodeBB plugin; creates users/categories/topics/posts/uploads and stores Discord↔NodeBB mappings through NodeBB's database layer.
- `worker/` — Discord integration process.

Images:

```text
ghcr.io/nu31hackerspace/nodebb-with-discord-sync:<commit-sha>
ghcr.io/nu31hackerspace/discord-nodebb-sync-worker:<commit-sha>
```

## Worker modes

Historical import is explicit and one-shot:

```bash
npm --prefix worker run import
```

It enumerates active/archived Discord forum threads through the REST API and imports their complete message history.

Realtime sync is event-driven:

```bash
npm --prefix worker run sync
```

`sync` opens a Discord Gateway WebSocket connection through `discord.js` and listens for new messages in threads whose parent forum channel is listed in `DISCORD_CHANNEL_IDS`. It does not periodically rescan Discord and has no polling interval.

Run the historical import once before realtime sync when migrating an existing forum archive. Both paths use the same idempotent NodeBB endpoint and mappings.

## Environment

```text
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_CHANNEL_IDS
NODEBB_URL
DISCORD_SYNC_SECRET
IMPORT_BOTS=false
```

The Discord application needs Guilds, Guild Messages and Message Content Gateway intents. The NodeBB plugin and worker must use the same `DISCORD_SYNC_SECRET`.

## Deployment

Deployment is intentionally kept in one separate infrastructure repository: `nodebb-deploy`. That stack contains both NodeBB+plugin and the Discord worker. There is no third deploy repository.
