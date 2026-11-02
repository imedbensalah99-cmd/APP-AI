# OMDA FreeLLMAPI — Private Agent Test Console (STAGING ONLY)

## Current verified status — 2026-11-02

- Cloudflare Worker: `omda-freellmapi-agent-private-console-staging-v1`
- Deployed with a **service binding only**: `AGENT_BRIDGE` → `omda-freellmapi-agent-bridge-staging-v1` (production environment, same Cloudflare account).
- Its `workers.dev` URL is **disabled**. Preview URL is **disabled**. No custom route and **no Cron**.
- **No secrets on this new Worker**; it is fail-closed by default (`OMDA_PRIVATE_TEST_ENABLED` is not set). Do not enable until owner-only authenticated invocation path and both 64-hex secrets are installed securely.
- Remote GitHub Actions no-credential test **PASS**, run 41496151564: `GET` to new worker's `/agent/test` on workers.dev → HTTP **404**; existing internal bridge's `/agent/chat` on workers.dev → HTTP **404**.
- Offline syntax + 7 security tests **PASS**, run 41495475053. Existing bridge offline 10 tests **PASS**, run 41494635575.
- No real agent inference, payment, publishing or scheduled activity has been performed. User's manual GPT-OSS 20B Groq Playground smoke test succeeded separately.

## Security model

This Worker only accepts `POST /agent/test` with exactly `{ "task": "..." }` (160 characters max, 512 bytes max); `GET` and other routes are blocked. It requires:
1. `OMDA_PRIVATE_TEST_ENABLED=true` (**not set**)
2. `OMDA_PRIVATE_TEST_TOKEN` — separate randomly generated 64-hex secret (**not set**)
3. `OMDA_BRIDGE_TOKEN` — the original bridge's separate Bearer token; must match the existing secret in that worker (**not set**)
4. Private `AGENT_BRIDGE` Cloudflare Service Binding (**deployed**)

The internal bridge itself also remains protected by independent enablement and bearer checks, 1/min and 10/day D1 quotas, and the Render server-side `OMDA-Agent-Staging` guard restricted to Groq `openai/gpt-oss-20b`. The private console cannot bypass those protections.

## Safe next gates

1. Identify a private, owner-authenticated invocation surface. **Do not enable either Worker workers.dev or previews**, or grant broad public access.
2. Provision both private console secrets through a supported secret-only channel **without logging or disclosing their values**. Existing Cloudflare bridge token is not readable back via API. Never overwrite it with a guessed value. Avoid duplicating credentials into GitHub, chats or documentation.
3. Verify bridge enablement and client-profile status without exposing customer keys. Any Cloudflare tool safety denial is a hard stop, not a cue to work around it.
4. With consent for one capped free inference, issue exactly one private `POST /agent/test`, validate expected Groq model and response, and check D1 count increments by one. Never repeat failed `POST` requests automatically.
5. Re-disable test enablement after the probe. No videos, automated schedules, publishing, paid providers, or changes to production OMDA/OMDA2.

Original documentation under `integrations/omda-freellmapi-agent-bridge/README.md` describes the bridge's original bootstrap state. Current deployed state should be verified via live Cloudflare bindings and quotas, not stale README text.
