# OMDA / Agency OS — private integration hub v1.0

- Isolated Cloudflare Worker; does **not** replace the OMDA production or Agency OS Worker.
- Access restricted to the owner's Cloudflare Access self-hosted app. No public routes, **JWT RS256 signature/issuer/audience/time verified** using Cloudflare Access JWKS.
- Shared existing D1 databases *read-only*: `OMDA_READ` (the original OMDA studio DB), `VIDEO_READ` (MoneyPrinter60 draft queue). Only aggregate counts grouped by status are exposed.
- `AGENCY_JOBS` binds Agency OS KV to show current tasks and securely enqueue only safe drafts. The existing Agency OS Cron Worker is the sole execution engine; this hub doesn't pretend to do AI work.
- Provider statuses are explicit: Workers AI bound in Agency Worker, Groq/Gemini not configured, FreeLLMAPI not installed. No API secrets or paid connections.
- Limits: task length 8–1400 chars, 1–3 approved agents, 6 requests per UTC day, maximum 3 active tasks. No scripts from OMDA are shown or submitted to Agency. No publishing/spending.
- Owner must sign into Cloudflare Access to see the dashboard. Authenticated browser smoke test is a separate acceptance step.
- GitHub branch and cloud service remain independent of OMDA 2.

## Status and limitations

The latest OMDA Render staging logs show a *genuine 60-second* Pixabay/Edge-TTS/FFmpeg low-memory test with 3 composed segments, SHA256 and `PUBLISHED=False` (2026-10-31). A useful technical pilot; not proof of cinema-grade footage, daily job automation, or YouTube publishing.

The full video START SYSTEM -> GitHub Actions engine, Google Drive OAuth-backed upload, agency tool execution, and FreeLLMAPI key vault are **NOT** implemented by this bridge.

Run `node --check worker.mjs` and `node test.mjs` before deployment. Use Cloudflare Worker bindings and Access app; never expose this Worker without verified Cloudflare Access authentication.
