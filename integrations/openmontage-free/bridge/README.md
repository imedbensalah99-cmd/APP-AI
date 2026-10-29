# OMDA Documentary Bridge — Step 1 (staging, no spend)

**Last verified:** 29 October 2026, Qatar. **Status: deployed and security-tested; authenticated server-to-server handshake blocked pending separately authorized secret configuration.**

## Architecture

```text
Owner browser
  -> Cloudflare Access owner-only login
  -> omda-documentary-bridge-staging Worker
      -> private Render Bearer authentication
      -> omda-documentary-runner-staging on Render Free
          -> validated FREE_ONLY documentary tasks
          -> Drive ingest / FFmpeg / Drive archiving (not connected yet)
```

## Deployment inventory

- **New staging Worker:** `omda-documentary-bridge-staging`
  `https://omda-documentary-bridge-staging.imedbensalah9988.workers.dev`
- **Access policy:** `OMDA Documentary Bridge — Owner Only` (Access application ID `e5225a6b-fb2c-4d2c-854b-463326d449ea`).
  Mirrors the **same verified owner-email allowlist used by the existing OMDA private studio**. Do not broaden this policy.
- **Render runner:** `omda-documentary-runner-staging` (Free, Frankfurt; existing service ID `srv-dbh7ga3l550s7380pa8g`). Original Render media service remains untouched.
- **Source branch:** `omda-doc-bridge-staging-v1`, separate from the deployed Render service source branch.
- **Cloudflare production Worker `omda-studio-private`:** **not modified**.

## Source

`worker.mjs` is an isolated Cloudflare ES Module Worker:

- Uses `ctx.access.getIdentity()` and an explicit owner-email match. It does **not** trust caller-controlled email or JWT headers.
- Forwards only tightly validated `FREE_ONLY`, `publish_intent=false` job requests to a fixed Render origin over HTTPS.
- Restricts POST to JSON with same-origin and maximum-body checks. No external URL from a job controls the upstream request target.
- Does not contain Google Flow, paid API, YouTube publishing, billing or public media-download methods.
- `/api/status` makes a non-mutating authenticated `GET` request for a nonexistent job. A 404 from Render verifies that Render accepted the private bearer credential. A 401/503 is not a pass.
- `POST /api/jobs` only after Access identity, matching owner-email binding, private Render bearer token and schema validation.
- `GET /api/jobs/:job_id` tracks a known submitted job; no unauthenticated job listing.
- `GET /health` exposes sanitized, read-only backend health **only if Access allows the caller**. The Access policy currently protects all paths.

## Secrets and deliberately unfinished credentials

The new Worker expects two bindings that **must not** be committed to GitHub:

- `OMDA_OWNER_EMAIL`: must match the email identity in the dedicated Cloudflare Access owner-only allowlist.
- `OMDA_DOC_RUNNER_TOKEN`: a high-entropy random value shared with Render service environment variable of exactly the same name; at least 32 characters.

The cross-service secret installation attempted from this session was blocked by platform safety controls. **No matching secret was provisioned**, as confirmed by Cloudflare's empty bindings/secrets list and Render returning HTTP 503 to the unauthorized job probe. Do not disable auth checks, copy session cookies, harvest existing tokens or expose credentials in query strings/browser JavaScript to bypass this block.

The owner must complete secret provisioning through authorized secure configuration UI or an approved supported secret workflow. Afterward, verify `/api/status` **while signed in through Cloudflare Access** and require `render_authenticated:true`; never infer auth from an HTTP 200 alone. Do not start video jobs until the Google Drive server OAuth connection and footage licences are verified.

## Evidence — GitHub Actions 40819109516

`https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/40819109516`

- Offline `node --test worker.test.mjs`: **8/8 passed** (owner authentication, same-origin restrictions, no-spend/publish rejects, payload rights validation, bearer forwarding, error sanitization).
- Live read-only `node --test live-smoke.test.mjs`: **4/4 passed**.
  - Render `GET /health`: HTTP 200; `AVAILABLE`; `DRIVE_OAUTH_REQUIRED`, `paid_generation=false`, `youtube_publishing=false`.
  - Render anonymous `GET /v1/documentaries/omdabridgeprobe0001`: HTTP 503 (not configured, no data exposed).
  - Cloudflare anonymous `GET /api/jobs/omdabridgeprobe0001`: HTTP 302 (Access sign-in required).
  - Cloudflare anonymous `GET /health`: HTTP 302 (Access protects the entire Worker).
- All checks use no credits, no video generation, and no YouTube uploads.

## Acceptance gates still open

1. Configure owner identity binding and securely provision the same high-entropy runner token to new Worker and new Render staging runner.
2. Test the authenticated `GET /api/status` handshake after owner Cloudflare Access login; expect `render_authenticated:true`.
3. Test authenticated job submission using a controlled no-spend request only after Drive OAuth and verified sample assets are available, or develop a non-mutating dry-run endpoint on Render.
4. Persist queue and job states in Cloudflare D1 for restart recovery; current Render in-memory queue is temporary.
5. Connect the finished documentary dashboard to these real endpoints, then run 120-second Germany pilot with licensed footage.
6. Do not deploy this staging bridge over `omda-studio-private`, change production secrets, publish media, spend credits or claim full automation until end-to-end verification.

**Important:** Unit/live negative-access testing is not a successful authenticated production handoff. Distinguish these carefully in all reports.
