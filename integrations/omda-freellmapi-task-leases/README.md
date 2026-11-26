# OMDA Task Session Worker Leases

This feature adds a bounded, single-owner lease to an existing dashboard-owned Task Session. It is designed to prevent two workers from simultaneously claiming the same running session.

## API

All endpoints require the existing dashboard session bearer token. The unified inference API key is not accepted.

- GET /api/omda/task-sessions/:id/lease
- GET /api/omda/task-sessions/:id/lease/verify
- POST /api/omda/task-sessions/:id/lease/claim
- POST /api/omda/task-sessions/:id/lease/renew
- POST /api/omda/task-sessions/:id/lease/release

### Claim

POST JSON:

    { "workerId": "worker-01", "ttlSeconds": 90 }

A claim is allowed only while the task session is running. The server returns a random 256-bit capability token once. Only its SHA-256 digest is stored. Copy it to the worker's protected secret store; do not place it in logs, source control, task labels, or evidence notes.

### Renew / release

POST JSON:

    {
      "leaseId": "UUID",
      "leaseToken": "one-time-delivered-token",
      "expectedRevision": 1,
      "ttlSeconds": 120
    }

Renew and release use optimistic lease revisions. A stale revision returns HTTP 409. Invalid tokens return HTTP 403. A token is invalidated immediately when the lease is released, expires and is reclaimed, or the parent task session is paused/cancelled/completed/failed.

### Bounds and safety

- TTL: 30–300 seconds; default 90 seconds.
- Worker ID: 1–64 safe ASCII characters.
- Request body: at most 2 KiB.
- Lease event history: at most 2,000 events per task session.
- SQLite writes use BEGIN IMMEDIATE and revision checks.
- Lease event history is append-only and SHA-256 chained.
- Lease tokens are never returned by inspect/verify and are stored only as SHA-256 digests.
- The migration rollback refuses to remove lease history.
- A lease is a coordination primitive only. It does not start a process, execute an agent, call a provider, spend credits, send email, submit jobs, publish, or deploy.
- The current dashboard session authenticates the operator who claims a lease. A future autonomous worker identity needs a separately reviewed authentication design; do not reuse dashboard tokens as permanent worker credentials.

## Local test

Run from the repository root:

    npm run test -w server -- src/__tests__/routes/omda-task-session-leases.test.ts src/__tests__/routes/omda-task-sessions.test.ts src/__tests__/db/migrate/roundtrip.test.ts

Then build:

    npm run build -w server

No Cloudflare D1 or Render mutation is required for this feature. The new migration is code-only until a separately approved deployment applies it.
