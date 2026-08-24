# Discord → NodeBB sync

Imports Discord **Forum Channels** into NodeBB and can keep re-running the same import as a simple near-real-time sync.

Mapping:

- Discord forum channel → NodeBB category
- Discord forum post/thread → NodeBB topic
- Discord message → NodeBB post/reply
- Discord user → real NodeBB user
- Discord attachments → copied into NodeBB uploads
- Discord timestamps → preserved in NodeBB
- Discord reply references → preserved where the referenced message was imported

Mappings (`discord user/thread/message/channel id → NodeBB uid/tid/pid/cid`) are stored through NodeBB's own database abstraction, so they work with PostgreSQL, MongoDB, or Redis and make repeated imports idempotent.

## Recommended database

Use **PostgreSQL** for NodeBB. NodeBB 4.15.1 contains a native PostgreSQL adapter and a PostgreSQL docker-compose example. The sync service itself does not need a separate database.

## Requirements

- Node.js 22+
- NodeBB 4.15.x
- a Discord bot token with access to the forum channels and message history
- Message Content intent enabled for the Discord application if Discord requires it for your bot

## Install the NodeBB plugin

From the NodeBB directory:

```bash
npm install /path/to/discord-nodebb-sync/nodebb-plugin-discord-sync
./nodebb activate nodebb-plugin-discord-sync
./nodebb build
```

Set the same secret in the NodeBB process environment:

```bash
export DISCORD_SYNC_SECRET='use-a-long-random-secret'
./nodebb restart
```

For exact Discord display names, enable NodeBB ACP → Settings → User → **Show full name as display name**. The importer stores the Discord display name as `fullname` and requests that preference for imported users. It also uses a NodeBB-compatible username fallback if a Discord name contains characters NodeBB does not permit in usernames.

## Configure the service

```bash
cp .env.example .env
```

Fill in:

```env
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CHANNEL_IDS=123456789012345678,234567890123456789
NODEBB_URL=https://forum.example.org
DISCORD_SYNC_SECRET=the-same-secret-as-nodebb
SYNC_INTERVAL_SECONDS=30
IMPORT_BOTS=false
```

## Full import

All configured channels:

```bash
npm run import
```

One channel without changing `.env`:

```bash
node src/cli.js import --channel 123456789012345678
```

The importer gets active and public archived threads, downloads every message in chronological order, creates users/categories/topics/replies, copies attachments, and records mappings. Running it again is safe: already mapped messages are skipped.

## Sync

```bash
npm run sync
```

`sync` repeats the idempotent pass every `SYNC_INTERVAL_SECONDS`. This intentionally uses polling for the first version instead of Discord Gateway events: it is simpler to operate and the same code path handles both historical import and new content.

## Test without Discord

Unit/integration tests of the mapping/import logic:

```bash
npm test
```

A normalized example thread is in `fixtures/sample-thread.json`. With NodeBB + plugin running:

```bash
npm run fixture
```

## Current scope

Implemented: historical topics/messages, users, timestamps, avatars, images/files, replies, archived + active forum threads, idempotent repeated sync.

Not yet implemented: edits/deletes propagated from Discord, Discord OAuth account claiming/linking, private archived threads, reactions, embeds/stickers, NodeBB → Discord reverse sync.
