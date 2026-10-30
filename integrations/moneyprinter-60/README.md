# OMDA — MoneyPrinterTurbo 60-second adapter (isolated staging)

The adapter proxies the REAL MoneyPrinterTurbo API; it is not a fake generator
and does not include the upstream heavyweight video engine. No production
OMDA service or Cloudflare Worker is changed by this branch.

New isolated Render free service:
* branch: omda-moneyprinter-60-staging-v1
* Docker context: integrations/moneyprinter-60
* Dockerfile: integrations/moneyprinter-60/Dockerfile
* Auto deploy: OFF, region Frankfurt, free plan only

Environment variables (NEVER put real secrets in GitHub):
* OMDA_MPT_BRIDGE_TOKEN: random 32+ character bearer token
* OMDA_MPT_URL: HTTPS origin of separately deployed genuine MoneyPrinterTurbo API
* OMDA_MPT_API_KEY: 32+ character upstream API x-api-key
* OMDA_MPT_ENABLE_JOBS: 0 until upstream is secured and verified

API:
* GET /health — safe nonsecret readiness
* POST /v1/mpt/jobs — authenticated, idempotent, review-only submission
* GET /v1/mpt/jobs/{job_id} — authenticated real upstream task tracking
* GET /v1/mpt/jobs/{job_id}/review.mp4 — authenticated MP4 verification

Fixed policy: 60-second target, 9:16, 1080x1920, Arabic voice, captions,
Pexels free stock source, free Edge TTS, one MP4 and zero publication.
Videos with duration outside 58.5–60.5 seconds or missing audio/video
streams are rejected. Free provider credentials, upstream readiness and
runtime capability must be verified separately; creating the adapter does
NOT complete automated generation.

LIMITATIONS: Ephemeral in-memory state and /tmp storage; free Render may
sleep or restart. Requires durable D1 + private cloud authentication bridge
before production. No publishing endpoints, Google Flow credits or paid
media-generation providers are invoked.

Tests: pip install -r requirements-dev.txt && pytest -q.
