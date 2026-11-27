# OMDA Worker Identity and Lease Runtime

This integration adds a revocable worker credential registry and a worker-authenticated lease API on top of the Task Session Worker Lease coordinator.

## Safety boundary

- A human operator creates, rotates, and revokes worker credentials through the dashboard-authenticated registry API.
- The raw worker token is returned once. Only its SHA-256 digest is stored.
- Worker credentials are distinct from dashboard session tokens and unified inference API keys.
- A worker can only access task sessions owned by the same dashboard account.
- A worker ID is derived from the authenticated registry record; clients cannot choose or spoof it.
- Lease renew/release additionally checks the authenticated worker identity and the one-time lease capability.
- Revoking a worker immediately rejects future worker API requests. Any already-issued lease remains bounded by its existing 30–300 second TTL; an operator can also pause/cancel the task session to revoke its lease.
- The worker API does not execute code, call a model/provider, schedule background jobs, send mail, submit applications, publish content, or deploy services.
- This is an API capability layer, not proof that a process is running or that a worker is trustworthy.

## Dashboard registry API

All requests require the existing dashboard session:

- POST /api/omda/workers — JSON body { label: 'staging-worker' }; returns a one-time workerToken.
- GET /api/omda/workers — list worker metadata and audit-chain verification, never token hashes.
- POST /api/omda/workers/:id/rotate — JSON body { expectedRevision: 1 }; returns a new token once and invalidates the old token.
- POST /api/omda/workers/:id/revoke — JSON body { expectedRevision: 2 }; revokes the token.
- GET /api/omda/workers/:id/verify — verifies the append-only registry event chain.

The per-account active-worker limit is 10 and the retained registry-record limit is 50 (including revoked records). Registry requests are limited to 2 KiB. Unknown fields are rejected.

## Worker runtime API

Use the worker token as Authorization: Bearer omda_worker_...:

- GET /api/omda/worker/me
- GET /api/omda/worker/task-sessions/:id/lease
- POST /api/omda/worker/task-sessions/:id/lease/claim — optional JSON body { ttlSeconds: 90 }
- POST /api/omda/worker/task-sessions/:id/lease/renew — JSON body with leaseId, leaseToken, expectedRevision and optional ttlSeconds.
- POST /api/omda/worker/task-sessions/:id/lease/release — JSON body with leaseId, leaseToken and expectedRevision.

Worker IDs are derived from the authenticated credential; the claim body intentionally rejects a caller-supplied workerId.

## Local validation

From the repository root, run:

    npm ci
    npm run test -w server -- src/__tests__/routes/omda-workers.test.ts src/__tests__/routes/omda-task-session-leases.test.ts src/__tests__/routes/omda-task-sessions.test.ts src/__tests__/db/migrate/roundtrip.test.ts
    npm run build -w server

No Cloudflare or Render changes are required. The migration runs through the existing server migration runner at application startup. Do not apply it to staging until the stacked PRs have been reviewed and merged in order.
