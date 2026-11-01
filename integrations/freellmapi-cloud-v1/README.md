# OMDA AI Company — FreeLLMAPI Cloud v1

**Scope:** OMDA AI Company only. Keep OMDA 2 and legacy deployments unchanged.

## Deployment
- Router: [omda-freellmapi-cloud-v1 on Render](https://dashboard.render.com/web/srv-dbjoatec6qcc73c4kfp0)
- URL: https://omda-freellmapi-cloud-v1.onrender.com
- Upstream: https://github.com/tashfeenahmed/freellmapi
- Initial upstream commit: `eae1a4038d5908c7a9a6ad771df96d324731c78a` (v0.16.15 pre-release)
- Plan: Render **free** Docker web service, Frankfurt, no auto-deploy.
- Backup: Cloudflare Worker `omda-freellmapi-backup-v1` using dedicated D1 `omda-freellmapi-backups-v1`, with an encrypted `FAPIBK1\0` backup payload and bearer authentication.

## Secret variables (values must never enter Git or chat)
- `ENCRYPTION_KEY` (64 hex)
- `FREEAPI_DB_BACKUP_URL` (HTTPS worker endpoint)
- `FREEAPI_DB_BACKUP_TOKEN` (bearer token)
- `FREEAPI_DB_BACKUP_KEY` (64 hex)
- `FREEAPI_DB_BACKUP_INTERVAL_MS=300000`
- `NODE_ENV=production`, `PORT=3001`, `HOST=0.0.0.0`

## Verified on 2026-11-01
- Render deployed successfully (status `live`) at upstream commit `eae1a403`.
- Initial encrypted backup was uploaded to dedicated D1 successfully.
- A subsequent redeploy logged `[db-backup] restored 430080 bytes` and then a fresh upload. This verifies restore from the independent backup.
- Provider credentials have not been added; OMDA Director has not yet been connected to the unified key.
- **Security hold:** `npm prune --omit=dev` still reported 25 dependency advisories (1 critical, 14 high, 9 moderate, 1 low). Assess production exploitability and remediate before connecting real provider credentials or allowing autonomous use.

## Go-live gates
1. Confirm real HTTP health check on `/api/ping`.
2. Confirm the encrypted backup continues after storing non-sensitive test state.
3. Claim the first admin through the dashboard (remote first-run setup requires the one-time code printed in the *private* Render logs).
4. Set individual provider API keys **only in the secured FreeLLMAPI dashboard or approved secrets manager**.
5. Test one provider request via `/v1/chat/completions` using the unified API key.
6. Securely connect OMDA Director and complete one end-to-end agent execution.
7. Monitor free monthly quotas; keep autonomous publishing and any paid actions off until separately authorized.

## Limits
Render shares 750 free instance-hours/month per workspace with other free services, sleeps after 15 minutes idle, and loses local SQLite state when it sleeps or restarts. D1 backups must be tested before storing any provider credentials. The backup Worker caps a single encrypted upload at 10 MiB; large backups need a revised storage solution. R2 was not enabled in this Cloudflare account, so this version intentionally uses D1.

## Isolation and safety
Do not change existing OMDA Worker services, production branches, OMDA 2 components, existing databases, or provider accounts. Treat source as third-party software; review upstream versions and re-test before manually upgrading.
