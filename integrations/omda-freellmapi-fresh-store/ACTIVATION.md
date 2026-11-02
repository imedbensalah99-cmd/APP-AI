# OMDA FreeLLMAPI — clean-start activation and rollback
_Status: prepared, NOT activated. Scope: FreeLLMAPI + OMDA AI Agents only._

## Verified inventory (2026-11-02)
- Render staging: [omda-freellmapi-secure-staging-v1](https://dashboard.render.com/web/srv-dbjp0rgu01pc7384jjcg). Auto-deploy OFF. Last confirmed live commit `c4d0acaa`; later GitHub commits have **not** been deployed.
- Isolated Cloudflare Worker: `omda-freellmapi-fresh-backup-v1`. The **workers.dev subdomain is disabled**, no `BACKUP_TOKEN` bound.
- Isolated D1: `omda-freellmapi-fresh-backup-v1`, database ID `24c3a15b-53ab-4d38-a8a0-be17f2f80a19`. It is empty. The Worker binding `FRESH_BACKUPS` refers only to this D1.
- **Never** point the clean service at legacy worker `omda-freellmapi-backup-v1`; never touch original data/keys.
- Confirmed real D1 SQL exercise: five synthetic rows -> newest three retained, correct current HEAD, all synthetic rows removed (0 remaining).
- Proven by GitHub unit/integration tests: real AES-256-GCM SQLite roundtrip to simulated Worker/D1; wrong-key/unauthorized fail-closed; original backup protection; nine server tests PASS.
- New Worker code has been uploaded; new Render fresh-only guard still exists on the GitHub staging branch only, **not deployed**. Do not confuse those states.

## Secure one-time onboarding, without pasting credentials into ChatGPT/GitHub
1. **Use your secure local password manager/cryptographic generator**, not a public password site, to generate *two independent random values*: a **32-byte random token** (64 hex characters) and a **different 32-byte AES encryption key** (64 hex characters). Keep both in the user's private password vault. The token must be 48-256 `A-Za-z0-9_-` characters; 64-hex works.
2. In Cloudflare Dashboard > Workers & Pages > `omda-freellmapi-fresh-backup-v1` > **Settings > Variables and Secrets**, add a **Secret** called `BACKUP_TOKEN` with the token. Never add the AES key here. Do not change D1 bindings.
3. **Only after secret is configured**, enable the Worker `workers.dev` subdomain, keeping Preview URLs disabled. The only valid route is `/freeapi.db.backup`. Verify anonymous GET returns **401**, not 200, on this route. Never expose the token in URLs.
4. In Render > `omda-freellmapi-secure-staging-v1` > Environment, set **in one save**:
   - `FREEAPI_DB_BACKUP_TARGET` = `https://omda-freellmapi-fresh-backup-v1.imedbensalah9988.workers.dev/freeapi.db.backup`
   - `FREEAPI_DB_BACKUP_TOKEN` = the exact token from Cloudflare.
   - `FREEAPI_DB_BACKUP_KEY` = the separate random AES encryption key.
   - `OMDA_FREELLMAPI_FRESH_ONLY` = `true`.
   - `FREEAPI_DB_BACKUP_INTERVAL_MS` = `3600000` (hourly).
   - Keep `FREEAPI_DB_BACKUP_RESTORE_ONLY=true` at first. **DO NOT** turn off until the fresh-only guard is deployed and confirmed active. A Render Environment save can trigger a deploy and erase temporary local SQLite data; do not store real accounts before this test.
5. Deploy the audited latest staging branch commit deliberately (autoDeploy OFF), verify `/api/ping=200` and unauthenticated `/v1/models=403`; check that the fresh-only guard is active. The backup URL MUST be exact. With the token set, authorized GET should return **404** before the first backup, never an old account's content. Check only HTTP code and never log credentials.
6. Change `FREEAPI_DB_BACKUP_RESTORE_ONLY=false` only after checking the target, token, fresh-only guard, and absence of legacy URLs. This triggers a Render deploy. Wait for a successful PUT into the **new** D1, then authorized GET and decrypted SQLite integrity check of the *new* database. Test a controlled redeploy/restart and verify restored data and key decryption before entering real provider credentials.
7. **Agent gate remains disabled** until backup/recovery is verified: `integrations/omda-freellmapi-agent-adapter/adapter.mjs` performs **read-only health and unauthorized access checks only**. Before actual agent inference, configure a restricted API key in the new FreeLLMAPI account with free providers only, define a hard no-spend policy and request caps, and test in an isolated agent staging environment. No video production/publishing.

## Stop/rollback
- If backup failed: set `FREEAPI_DB_BACKUP_RESTORE_ONLY=true` again and keep agents disabled. Do **not** rewrite the target URL to the old backup.
- If origin access changes from 403 to 200 without origin auth, fail closed and fix the origin gate before continuing.
- If decryption or sqlite `PRAGMA integrity_check` fails, leave the encrypted blob and old backups untouched. Verify token/key provenance privately; never rotate the backup key without preserving a recovery path to already-encrypted copies.
- D1 version retention: three versions (latest plus two rollback points) and 2 MiB max encrypted payload. Monitor capacity and failures before production.
- **Forbidden:** copy secrets into chat, repo, logs, query parameters, or Google Drive report. Do not modify OMDA 2, legacy OMDA, video services, or the original FreeLLMAPI backup.
