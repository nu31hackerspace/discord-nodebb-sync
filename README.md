# Discord NodeBB Sync

NodeBB plugin and Discord worker for syncing Discord forum channels with NodeBB categories/topics.

## Components

```text
library.js, lib/      NodeBB plugin
plugin.json          NodeBB plugin manifest
worker/              Discord bot/worker container
```

The plugin runs inside NodeBB. The worker runs as a separate process/container.

## What Syncs

```text
Discord forum channel <-> NodeBB category
Discord thread        <-> NodeBB topic
Discord message       <-> NodeBB post
Discord user          <-> NodeBB user
Discord reaction      -> NodeBB reaction
NodeBB topic/post     -> Discord thread/message
```

Sync is enabled per Discord forum channel with the slash command:

```text
/forum-sync channel:<Discord forum channel> category:<optional NodeBB category>
```

Only Discord administrators can use the command. If `category` is omitted, the plugin creates a NodeBB category from the Discord channel name.

## Required NodeBB Plugins

`nodebb-deploy` installs and activates these with the NodeBB image:

```text
nodebb-plugin-discord-sync
nodebb-plugin-sso-oauth2-multiple
@nodebb/nodebb-plugin-reactions
```

Reaction sync is optional at runtime. If the reactions plugin is disabled, message/topic sync still works.

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
DISCORD_OAUTH_CLIENT_ID
DISCORD_OAUTH_CLIENT_SECRET
```

Discord application requirements:

```text
Guilds intent
Guild Messages intent
Guild Message Reactions intent
Message Content intent
OAuth redirect: <NODEBB_URL>/auth/discord/callback
```

## Local Development

Run the stack from the sibling `nodebb-deploy` repository:

```bash
cd ../nodebb-deploy
```

Start NodeBB and PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d --build nodebb
```

Start/rebuild the worker:

```bash
docker compose -f docker-compose.dev.yml --profile discord-worker up -d --build discord_worker
```

Restart only the worker:

```bash
docker compose -f docker-compose.dev.yml restart discord_worker
```

Logs:

```bash
docker compose -f docker-compose.dev.yml logs -f --tail=100 nodebb
docker compose -f docker-compose.dev.yml logs -f --tail=100 discord_worker
```

After changing plugin code, rebuild NodeBB. `nodebb-deploy/Dockerfile.dev` packs this repo with `npm pack` and installs the tarball into NodeBB.

```bash
docker compose -f docker-compose.dev.yml up -d --build nodebb
```

## Tests

```bash
npm test
npm pack --dry-run
```

## Release

The plugin and worker use the same version. The release tag must match both package files.

```text
package.json
worker/package.json
```

Release example:

```bash
npm version 0.2.0 --no-git-tag-version
npm --prefix worker version 0.2.0 --no-git-tag-version
git add package.json worker/package.json
git commit -m "Release discord nodebb sync 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

The GitHub Actions release workflow:

```text
1. validates tag/package versions
2. runs tests
3. runs npm pack --dry-run
4. publishes worker image to GHCR
```

`nodebb-deploy` installs the NodeBB plugin from the GitHub tag:

```text
https://github.com/nu31hackerspace/discord-nodebb-sync/archive/refs/tags/v${DISCORD_SYNC_VERSION}.tar.gz
```

Worker image:

```text
ghcr.io/nu31hackerspace/discord-nodebb-sync-worker:${DISCORD_SYNC_VERSION}
```

## Production Deploy

After release `v0.2.0` is pushed and the worker image is built:

```text
nodebb-deploy GitHub variable:
DISCORD_SYNC_VERSION=0.2.0
```

Then run the `nodebb-deploy` workflow. It builds the NodeBB image, installs the plugin from tag `v${DISCORD_SYNC_VERSION}`, and deploys the Swarm stack.

## Reset One Channel

Run from `nodebb-deploy`:

```bash
docker compose -f docker-compose.dev.yml --profile discord-worker run --rm discord_worker \
  node src/cli.js reset --channel <DISCORD_CHANNEL_ID>
```

This deletes the NodeBB category/content and sync mappings for one Discord channel. User mappings are kept.
