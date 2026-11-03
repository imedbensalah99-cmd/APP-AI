# OMDA FreeLLMAPI Agents — BACKLOG.md (isolated, evidence-based overlay)

This scoped roadmap accompanies the original owner-uploaded V4/STATE/BACKLOG and V5. It **does not supersede** those original instructions. All activities require project isolation, free-tier verification, and exact approvals for email sends, public publishing or paid operations.

## Dependency order and acceptance
1. [DESIGN] Storage: confirm dedicated readiness-D1 schema and quota, separate task backup and reversible migration with independent restore; never repurpose fresh encrypted backup tables.
2. [NOT_STARTED] Owner authentication and durable Task OS: deny unauthorized sessions; create/inspect/pause/resume/cancel; exact one-time hashed approvals; dedupe idempotency key; survive restart.
3. [CI_VERIFIED] XLSX offline: two-sheet real OOXML ZIP, generator-only formulas, styling, frozen headers, filters, bilingual values, SHA-256 manifest. Evidence: workflow 41614811834 (commit 1951c37).
4. [NOT_STARTED] Authentic private artifact delivery: task-owned object storage, checksum, owner-only retrieval after restart and Android test.
5. [NOT_STARTED] Genuine DOCX + PDF + ZIP bundles: independent format parsers and Arabic rendering.
6. [CI_VERIFIED / OFFLINE_ONLY] Website brief -> real site generator -> private authenticated preview -> review; public publishing requires exact authorization.
7. [OFFLINE_ONLY] Bilingual Writing Studio: preserve facts, compare revisions, parser-valid unsent .eml, avoid invented recipients and sending.
8. [NOT_STARTED] Qatar job/CV evidence utility: current official sources, eligible analyst/coordinator roles, real tracker, verified recipients or blank, drafts only.
9. [BLOCKED_ACCESS] One private Groq smoke inference through approved bridge, hard zero-cost proof and server allowlist; never use paid fallback.
10. [BLOCKED_QUOTA] Reliable event-driven monitoring under cron 5/5, quota/migration safeguards and restore pilots.
11. [NOT_STARTED] Full mobile auth, accessibility, threat tests, rollback evidence and production-readiness review.
12. [IDEA] New safe features: duplicate checker, research provenance viewer, deterministic bilingual practice, validated CSV import with formula-escape.

## Immediate next slice
Owner-authorized staging **read-only** auth/perimeter evaluation and independent backup restore rehearsal; if those remain blocked, build an offline Task OS schema/approval state-machine with mock-backed security tests without claiming persistence. Preserve verified XLSX module and do not deploy without scope-specific approval.


## 2026-11-03 engineering checkpoint
- [CI_VERIFIED / NOT DEPLOYED] MIME email generator accepts Arabic UTF-8 bodies and encoded subjects, emits parser-valid unsent draft, neutralizes header injection. CI 41615769838.
- [CI_VERIFIED SCHEMA ONLY] Task OS namespaced relational schema, temporary SQLite replay/concurrency tests, actor scoping and one-time approval guard. CI 41616226493. **Not a running D1-backed service.**
- [NOT_STARTED] Real API auth, D1 migration/recovery, persistent artifact delivery and mobile end-to-end remain gated. Do not confuse offline tests with a useful owner task system.


## Task API checkpoint — 2026-11-03
- [CI_VERIFIED, NOT DEPLOYED] Signed Access JWT verification with strict issuer/aud/owner matching and WebCrypto; private configuration and default kill switch.
- [CI_VERIFIED, NOT DEPLOYED] D1-compatible create/list/inspect/pause/resume/cancel/events with optimistic versions, atomic audit and idempotency hashes; real disposable SQLite + RS256 tests on GitHub Actions (run 41620688703).
- [NOT_STARTED] Real Cloudflare Access-protected Task OS route and dedicated Access app; do not reuse Gateway or other project audiences.
- [NOT_STARTED] Isolated backup of task tables, fresh-instance restore, reversible D1 migration and free quota proof.
- [NOT_STARTED] Durable task runner, exact hashed approvals API, server-side rate limits, artifact persistence, authenticated mobile dashboard and restart acceptance in staging.
- [BLOCKED_ACCESS] Live Groq only after validated free plan, hidden private caller, server quotas and one authorized smoke request.


## Recovery and release gate — 2026-11-03
- [CI_VERIFIED] Task OS *SQLite* encrypted archive and fresh-db recovery with AES-256-GCM, 32-byte external key, schema fingerprint, integrity/FK proof. 11 negative/positive cases. This is not live Cloudflare D1 backup/restore.
- [CI_VERIFIED] Verified owner Task API 30/minute atomic conditional UPSERT cap, one row/owner, reject with 429 on excess; 4 real SQLite cases. Candidate D1 schema includes the limiter but live D1 has no Task OS tables.
- [BLOCKED_ACCESS] Dedicated Cloudflare Access Task OS app, independent owner route, verified owner identity, nonpublic Worker binding and signed JWT probe.
- [NOT_STARTED] Owner-authorized private **live task D1 export, isolated restore, migration/reconciliation, rollback rehearsal** and free quota audit. Cloudflare Time Travel bookmark existence only establishes a potential recovery point; not independent restore.
- [NOT_STARTED] Authenticated private artifact storage and mobile dashboard, durable worker/approvals, staging E2E acceptance, verified external-task idempotency, and explicit promotion gate.
