# OMDA Task Session Lifecycle API

A dashboard-session-protected API for tracking the lifecycle of an OMDA task plan. It stores lifecycle metadata and an append-only, SHA-256-linked event ledger in the existing SQLite database.

This API does not execute tasks, invoke agents or providers, publish content, send email, submit jobs, or deploy services. A running status is an operator-controlled lifecycle marker, not proof that work is executing.

## Authentication

Every endpoint requires the existing dashboard session token in the Authorization: Bearer header. The unified /v1 API key is not accepted.

## Endpoints

- GET /api/omda/task-sessions?page=1&pageSize=20&status=running
- POST /api/omda/task-sessions
- GET /api/omda/task-sessions/:id
- POST /api/omda/task-sessions/:id/transitions
- GET /api/omda/task-sessions/:id/verify

Create a session with a label and a 64-character SHA-256 fingerprint of the source plan. Transitions require an expectedRevision to reject stale writes.

## State transitions

- draft → running (start) or cancelled (cancel)
- running → paused, completed, cancelled, or failed
- paused → running (resume), cancelled, or failed
- completed, cancelled, and failed are terminal

Complete and fail transitions require an evidence note of at least five characters. Each accepted transition updates the session and appends its event in the same SQLite transaction.

## Bounds and retention

- 8 KiB maximum request JSON body.
- 50 active sessions per dashboard user.
- 2,000 events per session.
- 100 sessions maximum per list page.
- Event history is retained. The migration rollback refuses to drop the tables while any session exists.
- Event-table update/delete triggers enforce append-only behavior at the database layer.
- SHA-256 chaining detects edits but is not a digital signature and does not prove reviewer identity.

## Verification

The PR CI workflow runs the focused lifecycle, API, and migration round-trip tests, then builds the server. No Cloudflare D1, Render, or external service changes are required for this feature branch.
