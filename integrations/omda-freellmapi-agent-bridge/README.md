# OMDA AI Company — FreeLLMAPI Agent Bridge (staging, deliberately OFF)

**Status at 2026-11-02:** cloud-only, GitHub source committed, Cloudflare Worker deployed as `omda-freellmapi-agent-bridge-staging-v1`, **workers.dev disabled**, previews disabled, **no secrets**, no Cron, no inference, no paid calls. No changes to legacy FreeLLMAPI, OMDA Director or OMDA 2. A user-reported `OMDA-Agent-Staging` client profile exists but is disabled in FreeLLMAPI. This bridge cannot use it.

## Safety architecture

- A single route `POST /agent/chat` and a single preselected model `openai/gpt-oss-20b`.
- Model, target host, system prompt and max output tokens are fixed in code. JSON request schema is exactly `{ "task": "<1000 characters>" }` with bounded body <= 3072 bytes. Ignores/rejects user-chosen models and tool calls.
- Upstream is pinned to `https://omda-freellmapi-secure-staging-v1.onrender.com`, with no redirects.
- The bridge has a separate `OMDA_BRIDGE_TOKEN` auth (required Bearer), plus `OMDA_CLIENT_KEY` (FreeLLMAPI client-profile key) and `OMDA_ORIGIN_TOKEN` (existing origin-gate credential). Never put these in Git, chat, prompts, logs or Google Drive.
- Three explicit fail-closed flags: `OMDA_AGENT_ENABLED=true`, `OMDA_FREE_ONLY_CONFIRMED=true`, `OMDA_PROVIDER_SCOPE=groq:openai/gpt-oss-20b`. **These flags are not presently set**, and alone do not prove provider-only paid-call exclusion.
- Cloudflare D1 database `omda-freellmapi-agent-readiness-v1` has a new dedicated `agent_quotas` table; the existing `agent_checks` table is unchanged. The account reached 10/10 free D1 DB limit, so we did not allocate another DB, delete anything, or upgrade.
- Atomic SQLite UPSERT quota (UTC): max 10 calls/day and one call/minute. Failed upstream attempts conservatively count toward quota. D1 real SQL test verified 1 allowed, same-minute rejected, 10/day allowed, 11th rejected; synthetic records removed afterward (0 rows). Does not prove upstream provider behavior.
- 6 Node.js offline security tests pass in GitHub Actions: https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41437280217.

## Absolute gate before any real Agent inference

1. Verify FreeLLMAPI client profile is disabled (currently user-confirmed, not independently inspected through logged-in API).
2. Confirm Groq-only provider routing **at the server**, not merely current manual fallback selection. Restrict future provider additions and eliminate paid fallback, or install a server-side provider dispatch guard. The bridge's model allowlist by itself cannot prevent a same-ID model from being routed to another provider.
3. Independently audit actual Groq Free plan limits and confirm billing is off. Configure a hard quota whose maximum is below the verified free allowance.
4. Have user provision the three service secrets **directly** in Cloudflare private settings, including the client-profile key shown once in their own UI. They must **never send secrets into chat**. Without this step the system intentionally stays disabled; ChatGPT connectors cannot read these plaintext secrets.
5. Only then, after a controlled staging nonpaid inference test approved within free tier, enable the client profile and allow bridge execution. Roll back by setting `OMDA_AGENT_ENABLED=false` and disabling its profile.
6. No automated runs, cron, videos, publications or legacy project changes as part of this bridge.

## Verification evidence and controls

- New Worker bindings: only D1 `QUOTA_DB`; no secrets, public workers.dev disabled, previews disabled, no cron.
- New D1 table has 0 rows after real SQL stress test.
- The Worker is intentionally **not** an active or publicly usable Agent interface.
- Source and CI tests live only on branch `omda-freellmapi-secure-runtime-v1`. Render staging code was not changed during this step, avoiding an unnecessary redeploy/restart of the persisted account.
