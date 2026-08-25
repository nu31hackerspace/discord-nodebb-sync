# Discord → NodeBB Sync

NodeBB plugin + Discord worker for importing and synchronizing Discord forum channels with NodeBB.

## Structure

```text
library.js        NodeBB plugin entrypoint
lib/              plugin code
plugin.json       NodeBB plugin manifest
worker/           Discord worker
```

The plugin runs inside NodeBB. The worker is a separate container/process.

## Discord command

```text
/forum-sync channel:<Discord forum channel> category:<optional NodeBB category> enabled:<true|false>
```

Only Discord administrators can see and run the command.

If `category` is omitted, NodeBB creates a category immediately using the Discord channel name, even when the Discord channel is empty. If a category is selected, the channel is bound to its numeric NodeBB `cid`; later renaming does not break the mapping.

Mappings and sync state are stored through NodeBB's database abstraction:

```text
Discord channel id <-> NodeBB cid
Discord thread id  <-> NodeBB tid
Discord message id <-> NodeBB pid
Discord user id    <-> NodeBB uid
```

The worker does not keep the synchronized-channel list in memory. For every relevant Discord event it asks the NodeBB plugin whether that channel is enabled.

## Environment

Worker:

```text
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
NODEBB_URL
DISCORD_SYNC_SECRET
IMPORT_BOTS=false
```

The Discord application needs the Guilds, Guild Messages and Message Content intents.

## Tests

```bash
npm test
```

## Local Docker development

Local NodeBB, PostgreSQL and the worker are managed from the sibling `nodebb-deploy` repository. Do not run a standalone `docker build` for normal development.

```bash
cd ../nodebb-deploy
```

Start NodeBB + PostgreSQL:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build nodebb
```

Start or rebuild/recreate the worker:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml --profile sync up -d --build discord_worker
```

Restart the worker without rebuilding:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml restart discord_worker
```

Follow worker logs:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml logs -f --tail=100 discord_worker
```

After changing backend plugin code, restart NodeBB:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml restart nodebb
```
