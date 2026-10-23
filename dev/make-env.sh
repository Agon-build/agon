#!/usr/bin/env bash
# Runs on node-services in ~/agon-dev. Writes dev.env, the overrides that turn a
# copy of the production keys (prod.env) into a safe dev copy. Prints no values.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
[ -s prod.env ] || { echo "prod.env is missing; run: node dev/agon-dev.mjs setup" >&2; exit 1; }

value() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# Keep the webhook secret and the public URL across rebuilds.
secret=$(value AGON_TELEGRAM_WEBHOOK_SECRET dev.env)
[ -n "$secret" ] || secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
public=$(value AGON_PUBLIC_API_URL dev.env)
[ -n "$public" ] || public=http://localhost:8082

cat > dev.env <<EOF
NODE_ENV=development
DATABASE_URL=postgres://arcrun:dev@postgres:5432/arcrun
REDIS_URL=redis://redis:6379
APP_URL=http://localhost:3000
AUTH_DOMAIN=localhost:3000
AGON_SITE_URL=http://localhost:3000
AGON_PUBLIC_API_URL=$public
AGON_SEASON_COMMITS_OFF=true
AGON_SEASON_TICK_MS=2147483647
AGON_OUTSIDE_ENABLED=false
AGON_ESCROW_EXECUTION_ENABLED=false
AGON_ESCROW_RECONCILIATION_ENABLED=false
AGON_OPERATIONS_ALERT_WORKER_ENABLED=false
AGON_CERTIFICATION_WORKER_ENABLED=false
AGON_TESTS_WORKER_ENABLED=false
AGON_SCORES_WORKER_ENABLED=false
MISSION_ENABLED=
AGON_DELIVERY_EMAIL_FROM=
AGON_TELEGRAM_BOT_USERNAME=arcrunBot
AGON_TELEGRAM_BOT_TOKEN=$(value TELEGRAM_BOT_TOKEN prod.env)
AGON_TELEGRAM_WEBHOOK_SECRET=$secret
EOF
echo "dev.env written ($(wc -l < dev.env) keys)"
