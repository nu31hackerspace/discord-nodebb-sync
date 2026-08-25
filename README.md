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

`sync` opens a Discord Gateway WebSocket connection through `discord.js`. Realtime forum channels are loaded from persistent subscriptions stored by the NodeBB plugin and are added with `/forum-sync`.
The command is registered with Discord's `Administrator` default member permission and is hidden from non-admin members in the command picker. The worker also verifies the Administrator permission at interaction time.

## Environment

```text
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
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

## Discord slash command

The worker registers one guild slash command:

```text
/forum-sync channel:<Discord forum channel> category:<optional NodeBB category>
```

`category` uses Discord autocomplete backed by NodeBB. The visible choice contains the category name and `cid`; the stored mapping uses the numeric `cid`, not the category name.

If `category` is omitted, the plugin creates a NodeBB category immediately using the Discord channel name. This happens before historical messages are scanned, so an empty Discord forum channel still gets a NodeBB category and a persistent sync subscription.

If `category` is supplied, the plugin binds the Discord channel to that existing NodeBB category. A category already mapped to another Discord channel is rejected.

Sync subscriptions and mappings are stored through NodeBB's database abstraction, including:

```text
discord channel id <-> NodeBB cid
discord thread id  -> NodeBB tid
discord message id -> NodeBB pid
discord user id    -> NodeBB uid
```

The worker does not cache the synchronized-channel list in memory. For each Discord event it performs a point lookup against the NodeBB plugin by Discord channel ID and processes the event only when that persistent subscription is enabled. Realtime sync state is not configured through environment variables.
