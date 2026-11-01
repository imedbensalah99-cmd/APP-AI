# OMDA + Agency OS | API Connections Vault v1.1 (staging)

Scope: only the existing owner-only `omda-agency-unified` Cloudflare Worker. Does not edit the original OMDA AI Company Worker, MoneyPrinterTurbo execution services, Agency OS worker, or OMDA 2.

## What works

- Cloudflare Access plus application-side RS256/JWKS issuer/audience/expiry and owner-email verification, applied to **all** routes.
- Browser-only API Connections page for Groq, Gemini, Cerebras, OpenRouter, Mistral.
- Credentials encrypted with AES-256-GCM and random 96-bit IV in a dedicated D1 database. Master encryption key stored as Cloudflare Worker secret `PROVIDER_MASTER_KEY`, never in source or Drive. Per-provider authenticated data binds ciphertext to provider. No plaintext read-back endpoint.
- Owner-only create/replace/delete. Same-origin checks, JSON-only, input length limits, no public CORS or unlocked health routes, CSP SHA256 for static inline script.
- Optional read-only `GET /models` checks for supported vendors. No chat/completions inference, no token spending, no publishing.
- No automatic AI provider selection is claimed. FreeLLMAPI is **not installed** and no provider keys have been added.
- Daily per-provider model-list test cap 4, per-request 9-second timeout, keys never shown in JSON responses or logs.

## API response details

`GET /api/providers`: only provider name, registered/connection flag, state, short SHA fingerprint, timestamps.
`POST /api/providers`: credentials encrypted. `Origin` must equal the protected site and `x-omda-safe-action: connections` header is required.
`POST /api/providers/:provider/test`: optional credentials-free-model-list read with stored key. `OpenRouter` model listing can be public; a 200 returns `UNKNOWN`, **not** `VALID`. For other providers a 200 means `models endpoint reachable`, not that chat is free or usable.
`DELETE /api/providers/:provider`: deletes encrypted key row.

## Required Cloudflare bindings

- `OMDA_READ` — original OMDA D1, READ ONLY in code
- `VIDEO_READ` — original MoneyPrinter60 D1, READ ONLY in code
- `AGENCY_JOBS` — original Agency OS KV, limited safe draft queue
- `PROVIDER_DB` — isolated new D1 database `omda-agency-provider-vault-v1` (ID stored in Cloudflare settings; do not expose secret values)
- `PROVIDER_MASTER_KEY` — new secret_text (64 hex digits), never store in repository or Google Drive
- `OWNER_EMAIL` — owner allowlisted email (plain_text, not secret)
- `ACCESS_TEAM`, `ACCESS_AUD` — existing Cloudflare Access app metadata (plain text)

## Local verification

```sh
node --check worker.mjs
node --test test.mjs
```

9 fixture tests: invalid JWT, wrong owner, same-origin enforcement, encrypted credential storage, no key reflection, no inference, rate-limited tests, successful deletion. This is not a full external penetration test or a signed-in-owner browser acceptance test.

## Operational cautions

Cloudflare D1 persists, but if `PROVIDER_MASTER_KEY` is lost or rotated without re-encrypting, saved upstream credentials become unreadable and must be re-entered. Provider terms, region availability, and billing controls remain governed by each provider. Use keys from free-only accounts or create a separate API project with hard quotas. Never send API keys to ChatGPT, GitHub, screenshots, Google Drive, or in Agency tasks. Test via the owner-only dashboard only.

Do not declare FreeLLMAPI, Gemini inference, Groq inference, or full autonomous media production ready based on a successful credential save or `/models` check. Tools (GitHub writes, web search, code execution) are separate Agent Runtime integrations and currently incomplete.
