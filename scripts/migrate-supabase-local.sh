#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

require_command supabase
require_command psql

echo "Applying local Supabase migrations..."
supabase db push --local

echo "Reloading PostgREST schema cache..."
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 <<'SQL'
select pg_notify('pgrst', 'reload schema');
select pg_sleep(1);
SQL

echo "Local Supabase migrations applied."
