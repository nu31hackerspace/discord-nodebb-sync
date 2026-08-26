# Discord → NodeBB Sync

NodeBB plugin + Discord worker for bidirectional synchronization between Discord forum channels and NodeBB categories/topics.

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

New NodeBB topics/replies in a synchronized category are sent back to Discord through an internal worker bridge. The plugin stores the returned Discord thread/message IDs, so NodeBB replies can preserve Discord reply targets. Discord-originated posts carry an internal origin marker and the worker ignores its own bot messages, preventing sync loops.

## Environment

Worker:

```text
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
NODEBB_URL
DISCORD_SYNC_SECRET
IMPORT_BOTS=false
DISCORD_WORKER_PORT=8787
```

NodeBB container:

```text
DISCORD_WORKER_URL=http://discord_worker:8787
DISCORD_SYNC_SECRET
```

The Discord application needs the Guilds, Guild Messages and Message Content intents.

## Reset one channel

Delete the NodeBB category/content and Discord mappings for one channel so it can be imported again from scratch. User mappings are kept.

Run from `nodebb-deploy`:

```bash
docker compose -f docker-compose.dev.yml --profile discord-worker run --rm discord_worker \
  node src/cli.js reset --channel <DISCORD_CHANNEL_ID>
```

Then run `/forum-sync` for that Discord channel again.

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
docker compose -f docker-compose.dev.yml up -d --build nodebb
```

Start or rebuild/recreate the worker:

```bash
docker compose -f docker-compose.dev.yml --profile discord-worker up -d --build discord_worker
```

Restart the worker without rebuilding:

```bash
docker compose -f docker-compose.dev.yml restart discord_worker
```

Follow worker logs:

```bash
docker compose -f docker-compose.dev.yml logs -f --tail=100 discord_worker
```

After changing backend plugin code, restart NodeBB:

```bash
docker compose -f docker-compose.dev.yml restart nodebb
```

## Discord OAuth login

`nodebb-deploy` installs and activates `nodebb-plugin-sso-oauth2-multiple` automatically. This plugin configures its `discord` strategy at NodeBB startup from:

```text
DISCORD_OAUTH_CLIENT_ID
DISCORD_OAUTH_CLIENT_SECRET
```

The Discord application must have this redirect registered in Discord Developer Portal:

```text
<NODEBB_URL>/auth/discord/callback
```

Imported users are pre-linked in the exact mapping used by OAuth2 Multiple:

```text
Discord user id -> discordId:uid -> NodeBB uid
```

So `Log in with Discord` opens the already imported NodeBB account instead of creating a duplicate. Users who log in through Discord before their first imported message are also adopted by the importer later.
