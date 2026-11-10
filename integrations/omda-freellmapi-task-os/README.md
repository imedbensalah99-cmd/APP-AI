# OMDA FreeLLMAPI Agents — Task OS candidate migration (offline CI only)

This directory is a **security-validated schema candidate**, not a deployed queue or authenticated Task API. The user-uploaded V4 and V5 project security rules take priority. Absolutely no Cloudflare DB migration is run by the GitHub Actions job.

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
- Cloudflare Access/session authentication, authorization middleware, CSRF/CORS, rate limits and actual API endpoints.
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
