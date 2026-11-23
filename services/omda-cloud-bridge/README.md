# OMDA cloud-video bridge — STAGING (28 October 2026)

This isolated Cloudflare Worker connects to an explicitly **free** Render Web Service running FFmpeg and a pinned Piper Arabic voice. There is no Google Flow/Gemini video generation, no credit spending and no YouTube publishing.

## Verified deployment resources

- Render service: `srv-dbh3gmnf3r2c73eq6u40`, `omda-video-runner-staging.onrender.com`, Free plan Frankfurt.
- Render initial deployment: `dep-dbh3gnff3r2c73eq7010` — succeeded.
- Narration self-test deployment: `dep-dbh3kqkipgvc73dmhjrg` — succeeded.
- Render one-shot 10-second proof: `COMPLETE`; SHA-256 `c92caaea7e9a76ce14c5c96f4c7ea5f6ffb9652d94ed25271667bada8f811d96`; MP4 557005 bytes; duration 10.002 sec; `narration_present=true`, `ai_video_generated=false`, `flow_credits_used=0`, `api_cost_usd=0`. This is staging, not a durable production artifact.
- Cloudflare staging bridge Worker: `omda-cloud-bridge-staging` with dedicated D1 `omda-video-staging-db` and two separate secret text bindings (`OMDA_RUNNER_TOKEN`, `OMDA_BRIDGE_ADMIN_KEY`). No private secret values are in this repository.
- A temporary, bounded one-time no-spend cron probe may be enabled by the operator to verify the bridge end to end. Disable it after checking D1 results. It MUST NOT be treated as a permanent content scheduler.
- The bridge's public `workers.dev` subdomain was disabled after the initial anonymous health test to avoid exposing any job API without Cloudflare Access. Re-enable only with a suitable owner-only Access policy/service binding.

## Invariants

- Production Worker `omda-studio-private`, its Access policy and production D1 `omda-studio-db` are not modified by staging work.
- All job routes require a 256-bit+ `OMDA_BRIDGE_ADMIN_KEY` bearer token. The public health route reveals only high-level states.
- Only `NO_SPEND_SYNTHETIC` / `require_narration=true` jobs are accepted. The worker enforces strict duration, title, scene and request size limits. An idempotency key prevents duplicate submissions.
- Worker calls Render using server-side `OMDA_RUNNER_TOKEN`; neither token may appear in browser JavaScript, GitHub files, dashboard logs or client artifacts.
- Render job files live on **ephemeral** storage, lost when the free instance sleeps/restarts. D1 holds job metadata only. Completed job != durable video library.
- Account owner must separately approve any production Worker deploy, production D1 migration, paid generation, OAuth connection or YouTube upload.

## API (staging only)

- `GET /health` — safe coarse probe (unprotected when subdomain is enabled).
- `POST /v1/jobs` — JSON body accepted only with secret bearer and allowed model `NO_SPEND_SYNTHETIC`; responds with durable ID.
- `GET /v1/jobs/:id` — reads runner progress and updates staging D1.
- `GET /v1/jobs/:id/video|captions|manifest` — authenticated ephemeral artifact proxy. Content is never public.

## Unfinished for production

1. Private service binding (or Cloudflare Access service token) between the existing owner's dashboard and the staging Worker; keep the staging public route disabled.
2. Audit and add zero-spend durable private video artifact storage, versioning, SHA-256 on download, expired-file handling and review gate.
3. Add owner authentication and CSRF checks to each dashboard mutation, run automated security tests and verify access from Android.
4. Implement the actual owner-approved Google Flow/Gemini provider pipeline when an official and entitled path exists. No cost is implied by this current project.
5. Configure YouTube OAuth and publish approval only after proof video review; never automatically publish.

## Security reminder

Do not commit Render bearer tokens, Cloudflare secrets, OAuth refresh tokens, browser cookies or any owner identity allowlist. Use environment secrets and private service bindings.