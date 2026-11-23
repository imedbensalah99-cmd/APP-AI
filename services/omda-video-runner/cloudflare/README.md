# OMDA Cloud Staging Video Bridge

Cloudflare staging dashboard + durable job ledger + private 10-second narrated MP4 proof storage in D1. See `worker.js` and `docs/STATE.md`.

## Isolation
- Separate Cloudflare Access app and staging Worker, not the existing OMDA production Worker.
- Source stores no API keys. Bind `RUNNER_TOKEN` as a Cloudflare encrypted `secret_text` binding; Rotate Render `OMDA_RUNNER_TOKEN` together.
- Cloudflare Access must fully protect the staging hostname; Worker fails closed if `ctx.access.getIdentity` is absent.
- `Origin` and application/json required for mutations. No CORS wildcard. No YouTube endpoints.

## Endpoints (all require Cloudflare Access)
- `GET /` — mobile-friendly staging studio
- `GET /api/status` — Render health and storage mode
- `GET /api/jobs` — durable metadata
- `POST /api/jobs` — no-spend synthetic 10-sec video only, no provider overrides
- `POST /api/jobs/:id/sync` — poll provider and import artifact
- `POST /api/staging/import-smoke` — import known staging smoke proof
- `GET /api/assets/:id/video|captions|manifest` — private video / SRT / manifest
- `POST /api/jobs/:id/review` — artifact review only, no upload

## Cloud scheduler
`*/5 * * * *` calls `scheduled` to reconcile up to four pending jobs. After an MP4 completes, its bytes are SHA-256 checked and stored as a D1 BLOB, capped at 1.6 MB. D1 storage is appropriate **only for this small proof**, not real long-form production; D1 has a 2MB row/BLOB maximum. All jobs remain private. A Render restart before import can lose the remote artifact; mark `REMOTE_EXPIRED` instead of silently fabricating success.

## Verification boundary
Cloudflare Worker deployment, Access anonymous-login redirect, D1 schema, Render health, local tests are independently checkable. A full staging video ready-state is verified **only** after D1 contains a video BLOB, checksum, caption and manifest. Owner Android playback still needs authenticated browser review.