# OMDA AI Company — FreeLLMAPI current workstream (6 gates)

Scope: FreeLLMAPI (new clean account), Cloudflare, Render, OMDA AI Agents. No video production. No changes to OMDA 2, current production Director, legacy backup, or MoneyPrinter.

1. Secure Render staging FreeLLMAPI — verified LIVE.
2. Cloudflare access controls/origin gate — verified.
3. Migration/security fixture tests — passing; legacy account restore not required.
4. Preserve legacy backup but do not attempt restoration; owner explicitly waived this.
5. Dedicated encrypted and durable backup of new clean account — **in progress**. D1 and Worker scaffolding built, but cross-platform secret provisioning is **not completed**. Do NOT enable writes or assume persistence.
6. AI Agents integration — **read-only adapter only**. Probe GET /api/ping and unauthorized GET /v1/models. No prompts/jobs/inference/writes; production connection remains disabled.

## Current safe artifacts

- Backup schema and module: `../omda-freellmapi-fresh-store/`. Dedicated D1 `omda-freellmapi-fresh-backup-v1`, Worker `omda-freellmapi-fresh-backup-v1` (subdomain initially disabled and no token).
- Adapter: `adapter.mjs` + `adapter.test.mjs`, strictly read-only until separately approved authenticated service-to-service access.
- FreeLLMAPI Render service: `omda-freellmapi-secure-staging-v1`, with `FREEAPI_DB_BACKUP_RESTORE_ONLY=true`.
- Old encrypted D1 dataset/snapshot remains unchanged.

## Gates before enabling actual agents

Confirm backup-token and 64-hex key are set independently in Cloudflare and Render through authorized UI, verify source and destination credentials match, verify D1 remote PUT/GET and restore across a Render restart, ensure no old backup target remains, then design a scoped server-to-server credential with private identity. Only afterward may a separate staging agent send a bounded test. No paid providers, auto-publication, or changing production in this milestone.
