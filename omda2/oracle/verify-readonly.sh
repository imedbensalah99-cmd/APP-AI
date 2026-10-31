#!/usr/bin/env bash
# OMDA 2 read-only verification, run on OCI VM after Docker+Compose install.
set -euo pipefail

printf 'OMDA 2 — Paperclip local readiness checks (read only)\n'
command -v docker >/dev/null || { echo 'BLOCKED: Docker is not installed'; exit 1; }
command -v curl >/dev/null || { echo 'BLOCKED: curl is not installed'; exit 1; }
test -f .env || { echo 'BLOCKED: .env was not created on this cloud VM'; exit 1; }
test -d /srv/omda2/data || { echo 'BLOCKED: persistent /srv/omda2/data not found'; exit 1; }
docker compose --env-file .env config --quiet
echo 'PASS: Compose syntax and mandatory vars'
if ! docker compose ps --status running --services | grep -qx paperclip; then
  echo 'BLOCKED: Paperclip container not running'
  docker compose ps
  exit 1
fi
echo 'PASS: Paperclip container running'
if curl --connect-timeout 2 --max-time 8 --fail --silent --show-error http://127.0.0.1:3100/api/health >/dev/null; then
  echo 'PASS: Paperclip responds on VM loopback port 3100'
else
  echo 'BLOCKED: Paperclip API health check failed'
  exit 1
fi
if command -v tailscale >/dev/null 2>&1; then
  tailscale status --json | grep -q '"BackendState": "Running"' && echo 'PASS: Tailscale process connected' || echo 'CHECK: Tailscale connection needs verification'
else
  echo 'CHECK: Install Tailscale before private phone access'
fi
echo 'UNVERIFIED: AI provider, real agent runs, task artifacts, persistent restart test.'
echo 'No paid API requests, model calls or changes made by this script.'
