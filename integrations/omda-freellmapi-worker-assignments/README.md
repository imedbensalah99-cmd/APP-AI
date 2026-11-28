# OMDA Worker Task Assignments

This module adds explicit, owner-controlled task-session grants for authenticated OMDA workers.

A valid worker credential proves which worker is calling. It does not grant access to every task session owned by the dashboard account. The task owner must create an assignment for each session. Worker runtime access to a session is denied until an active assignment exists. Checks cover lease inspection, claim, renewal and release. Cross-account session IDs remain hidden as 404.

Assignments are append-only audit records. Revocation is revision-checked and atomically revokes an active session lease. Pausing, completing, cancelling or failing a task session revokes all active assignments in the same SQLite transaction as the lifecycle transition.

This is an authorization layer, not an Agent executor. It does not start processes, call model providers, publish content, send email, submit job applications or deploy services.

## Dashboard API

All dashboard routes require the existing dashboard session:

- GET /api/omda/workers/:workerRegistryId/assignments
- POST /api/omda/workers/:workerRegistryId/assignments
- GET /api/omda/workers/:workerRegistryId/assignments/:sessionId/verify
- POST /api/omda/workers/:workerRegistryId/assignments/:sessionId/revoke

Create body: { "sessionId": "UUID-v4" }

Revoke body: { "expectedRevision": 1 }

Repeated creation for an already-active worker/session pair is idempotent and returns the existing assignment with created: false.

## Worker API

- GET /api/omda/worker/task-sessions/:sessionId/lease
- POST /api/omda/worker/task-sessions/:sessionId/lease/claim
- POST /api/omda/worker/task-sessions/:sessionId/lease/renew
- POST /api/omda/worker/task-sessions/:sessionId/lease/release

Each requires a valid Worker Credential and an active assignment for the exact task session. Caller-supplied worker IDs are never accepted.

## Limits

- 100 active assignments per worker.
- 50 active worker assignments per task session.
- 500 retained assignment records per dashboard account.
- 2 events per assignment (assigned and revoked).
- Dashboard request bodies remain limited to 2 KiB.

## Audit and retention

The assignment event chain binds the assignment ID, dashboard user ID, worker registry ID, immutable worker ID, task session ID, action, timestamp and previous event hash. SQLite triggers prevent event update/delete and assignment identity mutation. The migration refuses rollback while assignment records are retained.

The migration is code-only until explicitly applied to a staging database. No Cloudflare or Render resource is modified by this integration.
