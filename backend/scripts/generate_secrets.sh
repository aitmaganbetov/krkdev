#!/usr/bin/env bash
set -euo pipefail

# Generate strong random values for backend .env (PR-03 helper).

gen_hex() {
  local bytes="$1"
  openssl rand -hex "$bytes"
}

gen_b64() {
  local bytes="$1"
  openssl rand -base64 "$bytes" | tr -d '\n' | tr '/+' '_-' | cut -c1-48
}

echo "Suggested secrets (copy into backend/.env):"
echo

echo "MYSQL_ROOT_PASSWORD=$(gen_b64 48)"
echo "DB_PASSWORD=$(gen_b64 48)"
echo "LOCAL_DB_PASSWORD=$(gen_b64 48)"
echo "READONLY_DB_PASSWORD=$(gen_b64 48)"
echo "SECRET_KEY=$(gen_hex 32)"
echo "ADMIN_PASSWORD=$(gen_b64 36)"
echo

echo "After rotating secrets:"
echo "1) Restart services: docker compose up -d --build"
echo "2) Re-login in frontend to refresh JWT sessions"
