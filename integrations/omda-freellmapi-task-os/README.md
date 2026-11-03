# OMDA FreeLLMAPI Agents — Task OS candidate migration (offline CI only)

This directory now contains a **CI-verified candidate Task API and security/recovery implementation**. It remains NOT DEPLOYED: no live owner-authenticated endpoint, durable cloud queue or approved D1 migration exists. The user-uploaded V4 and V5 project security rules take priority. Absolutely no Cloudflare DB migration is run by the GitHub Actions job.

## Existing authorized storage boundary
- Only consider the FreeLLMAPI-owned D1 omda-freellmapi-agent-readiness-v1 after its own backup/restore and quota checks. Its current tables agent_checks, agent_quotas must not be modified or replaced. The new omda_task_* namespace avoids existing names.
- Never apply this to OMDA 2, OMDA AI Company, the earlier FreeLLMAPI backup database, or the fresh encrypted-backup D1. The latter must remain a separate backup role.
- D1 plan slots are full (10/10). This candidate adds tables inside an existing trust-boundary DB only if owner confirms ownership and recovery gates are met. This does not prove free request/storage headroom.

## Security constraints covered by schema
- Project scope is locked to omda-freellmapi-agents; all user-owned records carry owner_scope.
- Composite parent keys and foreign keys keep task-step/artifact and approval effect ownership consistent.
- UNIQUE(owner_scope,idempotency_key) prevents duplicate logical task records within the same owner.
- Approval claims use an atomic conditioned UPDATE ... RETURNING matching the exact owner, target, digest, pending status and unexpired window. Tests cover wrong owner, changed payload, expired and replayed claims, including two concurrent claimers.
- External action ledger has unique approval and idempotency keys. This is only one layer of defense against uncertain network effects.
- Explicit 0 paid budget, lifecycle enums, input bounds, JSON validation, bounded attempts, artifact checksum shape and object references.
- A browser-visible task request must never supply an authoritative owner ID; server derives owner scope from a verified protected session.

## Critically unimplemented
- Live Cloudflare Access tenant verification, protected route, server-side owner onboarding and real staging; owner-scoped API and rate limiting exist in code only.
- D1 migration, real owner sessions, D1 transactions/behavior verification, rollback, independent task backup/restore, queue leases, artifact blob storage, Android UI or downloads.
- Approval semantic transition validation, actual provider-effect dispatch, uncertain-response reconciliation, true kill switch and provider quotas.
- No proof of D1 billing, fault tolerance or availability. No paid inference or live model tests.

## Safe next action
1. Verify allowed owner-auth route and no public bypass; verify D1 free quota headroom.
2. Prepare an isolated task database backup and restore rehearsal **without touching encrypted fresh-backup history**; plan forward repair for schema changes.
3. Only after gates, migrate isolated task tables in staging and independently test restart and replay; if blocked, keep implementation offline.
4. Build a typed owner-authenticated API with task idempotency, audit, pause/cancel and versioned exact-action approvals.
5. Wire the validated XLSX and EML artifact generator to the durable task and owner-only object store. Confirm retrieval on Android and after restart.

## Validation
CI: .github/workflows/omda-freellmapi-task-schema-ci.yml runs the Python standard-library sqlite3 tests against disposable in-memory and temporary file databases. No cloud endpoints, service secrets, model API calls or paid services are used. Validating local SQLite is *not* equivalent to a live D1 acceptance test. Schema remains CI_VERIFIED while Task OS as a user-facing feature is NOT_STARTED.


## New verified implementation: Access-validated Task API (child branch, 2026-11-03)

**Code:** access.mjs + worker.mjs + worker.test.mjs + sqlite-d1.test-helper.mjs.
**Current status:** CI_VERIFIED implementation against genuine disposable SQLite; NOT deployed to Cloudflare, NOT migrated to live D1, NOT authenticated against the owner's actual Access tenant.

Available routes (all require a **cryptographically verified** Cloudflare Access JWT in the Cf-Access-Jwt-Assertion header):
- GET /api/me — owner scope metadata only, no PII or secrets.
- POST /api/tasks — immutable validated command and deterministic intents; required Idempotency-Key; starts only in PLANNED, never executes.
- GET /api/tasks — owner-scoped last 25 planned tasks.
- GET /api/tasks/:uuid — details and ETag version.
- GET /api/tasks/:uuid/events — owner-scoped audit events.
- POST /api/tasks/:uuid/pause|resume|cancel — strict same-origin browser POST and If-Match: "vN". Running cancellation marks cancel_requested but never falsely reports stopped.

Mandatory *deployment* environment binding names (do not put values in GitHub/chat):
- OMDA_API_ENABLED=true (OFF until trusted Access route + backup/restore complete)
- OMDA_ACCESS_ISSUER = exact HTTPS team issuer ending in .cloudflareaccess.com
- OMDA_ACCESS_AUD = this application's dedicated audience (never reuse other OMDA applications' audience as an authorization substitute)
- OMDA_OWNER_EMAIL = allowlisted verified owner email only
- OMDA_OWNER_SUB (optional stronger identity binding)
- OMDA_ALLOWED_ORIGIN = exact https:// owner-only front-end origin; cross-site mutation rejected
- TASK_DB = explicit binding to the authorized dedicated FreeLLMAPI readiness D1, only AFTER isolated task backup and schema migration gates

**Identity protocol:** A real RS256 signature is verified via the Access issuer JWKS, with issuer, audience, expiration, optional nbf/iat, email, sub, and optional owner-sub checks. JWKS is cached for 5 minutes. The application is fail-closed when disabled, missing configuration, unsigned, expired, or unmatched; no raw JWT or cert errors appear in responses. Credentials and CVs must never be inserted in public workflows, repos or logs. Cloudflare Access must additionally protect the routing layer; application-level JWT verification is defense in depth.

**State and concurrency:** tasks are inserted with a request digest bound to owner + idempotency key; a reused key with a different payload gives 409. D1 batch transaction atomically stores tasks and audit records. Mutations require an exact ETag and an atomic conditional UPDATE with an event in the same batch, preventing stale overwrite. A RUNNING task cancellation is 202 pending runner acknowledgment, never a false CANCELED. This branch implements state management only: no execution engine, job queue consumer, external action dispatcher or approvals API.

**Read-only/offline CI evidence:** https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41620688703 — 8 real SQLite schema security tests + 8 Node Task API tests with a real 2048-bit RS256-generated JWT, fake JWKS transport (no network), genuine SQLite-backed D1-compatible adapter, idempotent create, real reopen persistence, owner isolation, cross-origin/invalid body rejection, version conflict, and pending cancellation semantics. This is **CI_VERIFIED**, not **STAGING_VERIFIED**; no live Cloudflare/D1/Access or Android evidence exists.

**Outstanding release security gates:** real Cloudflare Access application scoped solely to FreeLLMAPI Task OS, hidden/private Worker route and disabled public workers.dev/preview, owner onboarding without disclosing credentials, verified task-D1 backup/restore, D1 migration rehearsal and free usage evidence, a rollback, rate limiting, CSRF/CORS review, durable artifact store, end-to-end mobile testing and approval ledger implementation. No public publication without explicit owner authorization.

Rollback: discard/close the isolated child-branch PR; no existing D1 tables, Render deployments, main, older OMDA systems or public Workers were changed.


## Verified follow-on security/recovery slice (2026-11-03, isolated recovery branch)

**Modules:**
- recovery.mjs — genuinely encrypted **AES-256-GCM** snapshots of ONLY the exact \`omda_task_*\` SQLite tables, using a fresh random 96-bit nonce per backup, an **external 32-byte secret key**, authenticated AAD, exact archive-version/schema fingerprint checks, plaintext size ceiling (4 MiB), and a temporary read-only transaction for snapshot consistency. Non-Task tables such as \`agent_checks\` and \`agent_quotas\` are never copied. The in-memory buffer returned by this library contains ciphertext only; file storage, transport, retention, ACLs and actual platform key-management are NOT implemented.
- restoreTaskBackup() authenticates/decrypts **before** touching the destination, requires a fresh empty isolated SQLite schema, refuses any unrelated tables, restores all task records in a SQL transaction, and checks \`foreign_key_check\` / \`integrity_check\`, rolling back on error. **Does not restore directly to Cloudflare D1** and must not be used for live Cloudflare without a separately audited integration and independent restore test.
- worker.mjs uses an atomic one-row-per-verified-owner **30 requests/minute** D1-compatible conditional UPSERT, returning HTTP 429 and Retry-After 60 on excess. \`omda_task_request_limits\` is included in candidate schema, snapshot whitelist and restore fixture. Do not enable before the schema migration gate.

**Verified test evidence:** https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41625375029 — **31/31 passing** (8 Python schema + 8 Node signed-JWT/SQL API + 11 encrypted backup/restore + 4 atomic throttling tests), with real disposable SQLite/Node 24, synthetic records, generated keys and no network. The tests reject corrupted ciphertext, wrong keys, owner-crossed records, cross-project tables and nonempty restore targets; validate multi-owner records and an idempotent rehearsal with existing readiness tables.

**Live read-only Cloudflare observation:** FreeLLMAPI readiness D1 \`6b4f75e0-b6ee-40ea-bba7-8954329061e3\` currently holds exactly \`_cf_KV\`, \`agent_checks\` and \`agent_quotas\`. Its Time Travel bookmark endpoint returned a bookmark present (NOT an independently proven restore). Seven Access applications were observed, including an *existing* FreeLLMAPI Gateway with a single owner-email allow policy; **no dedicated Task OS Access app provisioned**, and no separate Task OS authenticated route has been verified.

**Release blockers (must all be verified before any cloud write):**
1. Create a standalone Cloudflare Access policy/issuer-audience with owner proof and *default deny*, bind **only** the isolated Task OS route. Validate signed application tokens against the real tenant in staging; fake-JWKS CI is insufficient. Configure secure same-origin UI and kill switch; no public bypass.
2. Independently export task-owned data to a private encrypted, owner-controlled location and successfully restore it to a **fresh cloud-isolated instance** before any live D1 migration. The SQLite utility alone is not a cloud D1 restore proof. Verify storage limits/quota, rollback bookmark applicability, and owner authorization for migration.
3. Validate schema compatibility with the existing D1 tables (especially native D1 JSON/CHECK/FK), real concurrent inserts/rate-limit claims, CORS/CSRF and quotas, mobile UI flow, private artifact retrieval.
4. Do not create applications, run D1 \`ALTER/CREATE\`, change workers.dev, deploy services, merge, spend credits, send emails or publish content without the requisite owner authorization and a verified rollback.

**Rollback:** close draft PRs; neither real D1 nor Render staging nor Cloudflare workers were altered in this slice. This is CI_VERIFIED *only*, not STAGING_VERIFIED.
