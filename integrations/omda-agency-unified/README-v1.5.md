# OMDA + Agency OS — no-spend Free Router pilot v1.4

**Scope:** owner-only OMDA unified hub + existing isolated Agency OS Worker. Never touch OMDA production, MoneyPrinter, or OMDA 2.

## Model policy
- Default agent executor remains Cloudflare Workers AI, `@cf/zai-org/glm-4.7-flash`.
- Optional explicit checkbox `OpenRouter free for first agent only`; QA and later agents still use Workers AI.
- The sole external inference model is `google/gemma-4-26b-a4b-it:free` (official zero-price model, explicit ID). Arbitrary or paid model IDs are rejected.
- Before any request, free router checks the **saved** OpenRouter key via `GET /api/v1/key`. If `is_free_tier !== true`, request is blocked before inference. This does not prove free-tier availability for other four stored providers.
- No free-model fallback to paid models; max_tokens 320, 2 attempts per UTC day, all attempted requests counted in D1. Every failed attempt counts. Upstream model/service may still return 429/no capacity.
- OpenRouter and its underlying model providers see prompt content during inference. Use only fictional/sanitized drafts. No production customer data.

## Transport & secrets
- `Agency Worker` calls the internal `omda-agency-unified` via **Cloudflare Service binding**, never with a public URL.
- `INTERNAL_BRIDGE_KEY`: independent 32-byte hex HMAC secret placed in **both** Workers as `secret_text`, generated within Cloudflare API execution; never stored in files, chat, or GitHub.
- HMAC-SHA256 signs timestamp, nonce, and exact JSON request body. 30-second freshness, nonce dedup in D1. Only the internal signed path bypasses Cloudflare Access; owner browser routes remain behind Access + JWT.
- `PROVIDER_MASTER_KEY` (original AES-256-GCM key) must be **inherited** during Worker updates; never regenerate or reveal.
- D1 provider vault adds `free_inference_attempts(id PRIMARY KEY,day,provider,state,created_at)`, and index by day/provider.

## Validation
- node --check unified-worker-v1.4.mjs
- node --check agency-worker-v1.4.mjs
- node --test test.mjs
- 9 isolated mock tests passed, including unsigned access, bad HMAC, expiration, paid model rejection, free-tier guard, one simulated free model completion, daily cap, and owner-only public routes.
- These are local mocked tests, **not live inference or browser authenticated tests**.

## Acceptance
1. Cloudflare D1 migration with zero current free pilot attempts.
2. Both Worker secrets exist and Worker bindings survive uploads.
3. Agency OS `MODEL_GATEWAY` binding points to the isolated Unified Worker.
4. Enqueue one **fictional** two-agent `modelProvider:'openrouter-free'` job. Wait for Scheduled Worker cron and inspect KV per-agent `model`/`provider` fields.
5. If OpenRouter free-tier check fails, stop safely. No model inference is sent. If successful, only first agent uses OpenRouter free; QA via Workers AI.
6. Avoid production/publishing; no video or Google Drive authorizations via this route.

## Source references
https://openrouter.ai/collections/free-models
https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/

## v1.5 fix
The initial OpenRouter `openrouter/free` live request reached the provider but returned HTTP 200 without usable content (`EMPTY_OUTPUT`); this used one daily attempt and no paid route. v1.5 pins `google/gemma-4-26b-a4b-it:free`, supports reasoning disabled with a 320 output-token ceiling. Source: https://openrouter.ai/google/gemma-4-26b-a4b-it:free . Second attempt still subject to the original two/day cap.
