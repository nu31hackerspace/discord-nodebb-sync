# Discord -> NodeBB Sync

Public source repository for one NodeBB plugin and its Discord worker.

## Layout

```text
package.json      # NodeBB plugin package
plugin.json       # NodeBB plugin manifest
library.js        # NodeBB plugin entrypoint
lib/              # plugin implementation
worker/           # Discord worker package and image
```

The repository root is the npm package `nodebb-plugin-discord-sync`. NodeBB must install this package inside its own container; the plugin is not a separate service.

The worker is separate. It reads Discord forum channels and sends normalized thread payloads to the plugin HTTP endpoint in NodeBB.

## Plugin API

```text
GET  /api/discord-sync/v1/health
POST /api/discord-sync/v1/thread
```

Both endpoints require the `x-discord-sync-secret` header matching `DISCORD_SYNC_SECRET`.

## Worker Modes

Historical import is explicit and one-shot:

```bash
npm --prefix worker run import
```

Realtime sync is event-driven:

```bash
npm --prefix worker run sync
```

`sync` opens a Discord Gateway WebSocket connection through `discord.js` and listens for new messages in threads whose parent forum channel is listed in `DISCORD_CHANNEL_IDS`.

## Environment

```text
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_CHANNEL_IDS
NODEBB_URL
DISCORD_SYNC_SECRET
IMPORT_BOTS=false
```

The Discord application needs Guilds, Guild Messages and Message Content Gateway intents.

## Local Development

Local NodeBB/PostgreSQL deployment is owned by the sibling deploy repository:

```bash
cd ../nodebb-deploy
cp .env.dev.example .env.dev
docker compose --env-file .env.dev -f docker-compose.dev.yml up --build nodebb
```

That compose file bind-mounts this repository into NodeBB as `nodebb-plugin-discord-sync`.

Run worker tests from this repository:

```bash
npm test
```

Build the worker image locally:

```bash
docker build -f worker/Dockerfile worker
```
