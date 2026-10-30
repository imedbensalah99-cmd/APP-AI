# OMDA MoneyPrinter60 Owner-only Draft Queue

**Staging only.** Dedicated Cloudflare Worker `omda-moneyprinter60-queue`, D1 database `omda-moneyprinter60-queue-staging`, owner-only Cloudflare Access application.

Dashboard: https://omda-moneyprinter60-queue.imedbensalah9988.workers.dev/

## Security
- Cloudflare Access app uses verified owner allowlist.
- Worker independently verifies RSA-signed Cloudflare Access JWT issuer, audience, email, expiry and issued-at time against Cloudflare JWKS. Any missing/invalid assertion returns 401.
- Only same-origin POST with `X-OMDA-Action` accepted.
- Strict 60-second Arabic SARDERA drafts, free-only source, no paid calls, and no external publication.
- Rate cap four draft creations per rolling 24 hours; idempotent submission keys.
- New D1 database distinct from every prior OMDA database; no existing Worker was modified.
- Owner can create draft, list jobs, approve for **render queue only** or reject. Draft approval is not publishing approval and does not initiate a video-generation task.
- The queue has **no** API route for YouTube, credits, paid providers or arbitrary remote API calls.
- Proof route only fetches publicly accessible sanitized GitHub Actions metadata via existing read-only worker.
- The public GitHub Actions video pilot remains separate, with original, non-personal synthetic demo content. **Do not** send private user-submitted scripts to publicly visible GitHub Actions job logs or artifacts until private retrieval and artifact storage are implemented.

## Deployment
Cloudflare Workers script uses module format, multipart API metadata with D1 binding `JOBS` and database ID obtained from owner account. Never store authentication tokens or user content in the public Github repository. D1 schema is in `queue-schema.sql`.

## Important outstanding work
1. Verify owner-authenticated create/list/approve/reject routes through a real Cloudflare Access browser session. Anonymous 302-only tests do not establish authenticated correctness.
2. Build private OIDC-authenticated GitHub Actions job dispatch and private artifact storage, with strict owner review and no public script exposure.
3. Add recovery/lease semantics, queue lifecycle, artifact integrity and per-day quota enforcement.
4. Add higher quality licensed scene material and improved Arabic narration for SARDERA.
5. Do not turn on automatic publishing without owner approval.

No scheduling and no automatic video generation are enabled by this queue.
