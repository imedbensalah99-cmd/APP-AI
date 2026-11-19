# OMDA STATE — 2026-10-28, Qatar

## Verified staging resources
- Production Worker `omda-studio-private` unchanged by staging work.
- Staging Worker `omda-video-staging`, protected by separate Cloudflare Access app `OMDA Video Staging — Owner Only`, cloned owner allowlist.
- Staging hostname `omda-video-staging.imedbensalah9988.workers.dev` (requires owner Access login).
- D1 `omda-video-staging-db` (independent from production D1).
- Worker D1 and `RUNNER_TOKEN` secret bindings verified; no credential value in the repository or frontend.
- Render free `omda-video-runner-staging`, Frankfurt, connected to `imedbensalah99-cmd/APP-AI`, branch `omda-cloud-render-staging-v1`.
- Render health and initial narrated proof verified independently, 10.002-sec MP4, original synthetic visuals, Arabic narration. SHA-256 `c92caaea7e9a76ce14c5c96f4c7ea5f6ffb9652d94ed25271667bada8f811d96`.
- Staging Worker cron `*/5 * * * *`, polls pending jobs only.
- Cloudflare Access blocks unauthenticated access to staging API.
- Node standalone negative security tests pass: unauthorized, cross-origin, validation, empty queue, bad artifact ID.

## Workflow
Owner logs into staging website -> submits 10-sec SARDERA/NIMOLOO synthetic video -> Cloudflare D1 persists job -> authenticated Render API launches FFmpeg+Piper -> cron checks status -> if complete, fetches MP4/SRT/manifest with private server token -> SHA-256 verification -> D1 BLOB for small proof (<1.6MB) -> authenticated owner playback/download -> separate artifact-specific review decision. Publication is absent and forbidden.

## Limits and blockers
- D1 2MB per BLOB/row, staging videos capped at 1.6MB; longer videos will need separate private object storage, which may involve billing authorization.
- Render free filesystem is ephemeral. Job state survives in D1 but completed proof is durable only after successful import.
- Cloudflare Access user login must be performed by owner; cannot claim full owner-browser E2E verification without that session.
- No official connected Flow/Gemini video generation; no paid API calls or credit usage.
- No YouTube OAuth connection or publishing.
- No merge or deploy to production Worker; explicit bounded owner approval required.

## Required verification
Poll staging D1 after cron. Validate imported BLOB SHA-256 equals Render proof. Test owner playback and review through authenticated Access session. If Render times out, inspect D1 error_code and Render logs; do not misrepresent any incomplete state.