# Discord → NodeBB sync

One source repository for both halves of the integration:

- `worker/` — reads Discord forum channels and sends normalized imports/sync updates to NodeBB.
- `nodebb-plugin/` — runs inside NodeBB and creates users, categories, topics, posts and uploads while storing Discord↔NodeBB mappings.

They are one product and are versioned in one Git history. A single commit publishes two images:

```text
ghcr.io/<owner>/discord-nodebb-sync-worker:<commit-sha>
ghcr.io/<owner>/nodebb-with-discord-sync:<commit-sha>
```

`latest` is also published from `main`.

## Repository layout

```text
worker/                 worker source, tests and fixtures
nodebb-plugin/          NodeBB plugin source
docker/                 NodeBB image entrypoint wrapper
Dockerfile.worker       worker image
Dockerfile.nodebb       NodeBB 4.15.1 + integration plugin image
.github/workflows/      publishes both images to GHCR
```

## Local worker

```bash
cp worker/.env.example worker/.env
npm --prefix worker test
npm --prefix worker run import
npm --prefix worker run sync
```

The worker and NodeBB plugin must use the same `DISCORD_SYNC_SECRET`.

## Deployment

Runtime deployment is kept in two independent repositories, matching the NU31 infra pattern:

- `nodebb-deploy` deploys the custom NodeBB image (`official NodeBB 4.15.1 + bundled plugin`).
- `discord-nodebb-sync-deploy` deploys the worker image.

Both may deploy `latest`, but pinning both to the same source commit SHA is recommended when a change modifies the HTTP contract between worker and plugin.

## Current scope

Historical + repeated idempotent sync of Discord forum channels, users, display names, avatars, topics, replies, timestamps, images/files and reply references. Edits/deletes, reactions and reverse NodeBB→Discord sync are not implemented yet.
