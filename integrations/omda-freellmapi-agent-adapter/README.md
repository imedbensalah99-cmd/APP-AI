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


## Step 6 execution — 2026-11-02

A **separate staging-only agent-watch Worker** was created:
- Cloudflare Worker: `omda-freellmapi-agent-watch-staging-v1`
- Independent Cloudflare D1: `omda-freellmapi-agent-readiness-v1`, table `agent_checks`
- Worker never accepts public HTTP requests (`fetch=404`, workers.dev disabled, previews disabled); no secrets bound
- Scheduled code reads only two FreeLLMAPI endpoints using *anonymous GET*: `/api/ping` and `/v1/models`
- It stores only timestamp, HTTP codes and readiness status, retaining at most 30 checks. Never stores credentials, responses or prompts
- Six unit/security tests passed; independent real probe on GitHub Actions observed `healthHttp=200`, `modelsWithoutAuthorizationHttp=403`, `state=PERIMETER_OK`. Source: https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41422810899
- **Scheduled Cloudflare cron NOT active**. The account has reached the Workers Free limit of 5 cron triggers. API rejected a new trigger (10072). We did **not** upgrade, remove triggers, edit current Director or touch production
- An isolated GitHub Actions workflow provides read-only probe on branch updates, but it is **not a recurring default-branch schedule**. The D1 for agent check results is empty until the separate Worker is actually invoked.
- No connection to inference keys, no paid API, no generative task/publishing, and no live changes to original Director or OMDA 2.

**Next safe gate:** Choose a production-neutral recurring trigger (or later safely reuse an existing authorized cron without disturbing it) and secure a scoped client-profile API credential; only then authorize a bounded no-spend inference test. Never present perimeter readiness as proof of model inference or Agent orchestration.
