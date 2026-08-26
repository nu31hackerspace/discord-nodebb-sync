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
/forum-sync channel:<Discord forum channel> category:<optional NodeBB category>
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

## Architecture

NodeBB plugin responsibilities are separated by layer:

```text
lib/mappings/repository.js       all persistent Discord <-> NodeBB mappings
lib/services/users.js            Discord user -> NodeBB user identity
lib/services/categories.js       category creation/binding/metadata
lib/services/import.js           historical/realtime Discord -> NodeBB import
lib/content/discord-to-nodebb.js content/mention/attachment rendering
lib/services/outbound-sync.js    NodeBB hooks -> normalized sync events
lib/clients/discord-worker.js    transport to the Discord worker
```

Worker responsibilities are separated similarly:

```text
worker/src/commands/             slash commands
worker/src/inbound/              Discord -> NodeBB Gateway events
worker/src/outbound/             NodeBB event dispatch + shared post renderer
worker/src/discord/              Discord forum operations
worker/src/http/                 internal bridge transport
```

NodeBB -> Discord uses a normalized event envelope (`topic.created`, `post.created`). Future `post.updated`/`post.deleted` handlers can reuse the same HTTP transport, mapping repository and renderer; only the corresponding NodeBB hooks and event handlers need to be added. `render-post.js` is the single place that builds the Discord author header, so create/update can share exactly the same rendering.

Mappings are written in both directions. A NodeBB `pid` stores the complete `discordMessageIds[]` set, not only the first chunk, which prepares long posts for future update/delete support. Normal lookups are direct; database scans are retained only as reset compatibility for mappings written by older builds.

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

After changing plugin code, rebuild/recreate NodeBB so the local npm package is packed and installed again:

```bash
docker compose -f docker-compose.dev.yml up -d --build nodebb
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

## npm package

This repository is a single Git repository containing both the NodeBB plugin and the Discord worker. The repository root is also the publishable npm package `nodebb-plugin-discord-sync`; `worker/` stays in the same repository but is excluded from the published package by the `files` list in `package.json`.

Publish a plugin release from the repository root:

```bash
npm login
npm version patch
npm publish
```

After publishing, a normal NodeBB installation can install the plugin with:

```bash
npm install nodebb-plugin-discord-sync@0.1.1
./nodebb activate nodebb-plugin-discord-sync
./nodebb build
```

Production `nodebb-deploy/Dockerfile` installs the plugin from the npm registry. Its build argument `NODEBB_PLUGIN_DISCORD_SYNC_VERSION` selects the exact package version. Development does not require publishing every edit: `Dockerfile.dev` runs `npm pack` against this repository and installs the resulting package tarball, so dev exercises the same package contents/layout that npm will publish.

### Optional GitHub release publishing

The repository also contains `.github/workflows/publish-plugin.yml`. Add an npm automation token as the repository secret `NPM_TOKEN`, bump the root package version, then push a matching plugin release tag, for example:

```bash
npm version 0.1.1 --no-git-tag-version
git add package.json
git commit -m "Release plugin 0.1.1"
git tag plugin-v0.1.1
git push origin master plugin-v0.1.1
```

The workflow runs the worker/plugin tests and publishes only the root NodeBB plugin package. The `worker/` directory remains in the same Git repository and is not included in the npm tarball.

## Release

The NodeBB plugin and Discord worker are one product and always use the same version.

Set the same version in both package files:

```text
package.json
worker/package.json
```

Create one Git tag, for example:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The `Release Discord NodeBB Sync` GitHub Actions workflow validates that the tag, plugin package version, and worker package version are identical. It then publishes both artifacts:

```text
npm:  nodebb-plugin-discord-sync@0.2.0
GHCR: ghcr.io/nu31hackerspace/discord-nodebb-sync-worker:0.2.0
```

GitHub repository secret required for releases:

```text
NPM_TOKEN
```

The worker image is published to GHCR with the repository `GITHUB_TOKEN`.
