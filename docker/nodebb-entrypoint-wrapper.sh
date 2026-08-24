#!/bin/bash
set -euo pipefail

CONFIG_DIR="${CONFIG_DIR:-/opt/config}"
CONFIG="${CONFIG_DIR}/config.json"
SETUP_JSON="/usr/src/app/setup.json"

mkdir -p "$CONFIG_DIR"

# Feed NodeBB's installer with production PostgreSQL defaults on first start.
if [ ! -f "$CONFIG" ]; then
  cat > "$SETUP_JSON" <<JSON
{
  "defaults": {
    "postgres": {
      "host": "${POSTGRES_HOST:-postgres}",
      "port": ${POSTGRES_PORT:-5432},
      "database": "${POSTGRES_DATABASE:-nodebb}",
      "username": "${POSTGRES_USER:-nodebb}",
      "password": "${POSTGRES_PASSWORD:-}"
    }
  }
}
JSON
else
  # Safe on every restart. If NodeBB is already configured, make sure the
  # bundled integration plugin is active before starting the forum.
  /usr/src/app/nodebb activate nodebb-plugin-discord-sync --config="$CONFIG" >/dev/null 2>&1 || true
fi

exec /usr/local/bin/entrypoint.sh "$@"
