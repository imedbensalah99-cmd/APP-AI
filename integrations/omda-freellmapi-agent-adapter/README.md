# OMDA AI Company — FreeLLMAPI current workstream (6 gates)

Scope: FreeLLMAPI (new clean account), Cloudflare, Render, OMDA AI Agents. No video production. No changes to OMDA 2, current production Director, legacy backup, or MoneyPrinter.

1. Secure Render staging FreeLLMAPI — verified LIVE.
2. Cloudflare access controls/origin gate — verified.
3. Migration/security fixture tests — passing; legacy account restore not required.
4. Preserve legacy backup but do not attempt restoration; owner explicitly waived this.
5. Dedicated encrypted backup of new clean account — **verified in staging** (Cloudflare D1 latest 3; encrypted Render upload and restore across fresh deployment, 2026-11-02).
6. AI Agents integration — **isolated read-only monitor + disabled-by-default protected bridge**, with new server-side OMDA Agent profile guard deployed to Render staging; no live inference, secrets, automation or publishing.

## Current safe artifacts

- Backup schema and module: `../omda-freellmapi-fresh-store/`. Dedicated D1 `omda-freellmapi-fresh-backup-v1`, Worker `omda-freellmapi-fresh-backup-v1` (subdomain initially disabled and no token).
- Adapter: `adapter.mjs` + `adapter.test.mjs`, strictly read-only until separately approved authenticated service-to-service access.
- FreeLLMAPI Render service: `omda-freellmapi-secure-staging-v1`, with fresh-only **encrypted upload and restore verified**. The old restore-only flag has been turned OFF only for the new D1 target.
- Old encrypted D1 dataset/snapshot remains unchanged.

## Gates before enabling actual agents

Confirm backup-token and 64-hex key are set independently in Cloudflare and Render through authorized UI, verify source and destination credentials match, verify D1 remote PUT/GET and restore across a Render restart, ensure no old backup target remains, then design a scoped server-to-server credential with private identity. Only afterward may a separate staging agent send a bounded test. No paid providers, auto-publication, or changing production in this milestone.


## Step 6 execution — 2026-11-02

A **separate staging-only agent-watch Worker** was created:
- Cloudflare Worker: `omda-freellmapi-agent-watch-staging-v1`
- Independent Cloudflare D1: `omda-freellmapi-agent-readiness-v1`, table `agent_checks`
- Worker never accepts public HTTP requests (`fetch=404`, workers.dev disabled, previews disabled); no secrets bound
- Scheduled code reads only two FreeLLMAPI endpoints using *anonymous GET*: `/api/ping` and `/v1/models`
- It stores only timestamp, HTTP codes and readiness status, retaining at most 30 checks. Never stores credentials, responses or prompts
- Six unit/security tests passed; independent real probe on GitHub Actions observed `healthHttp=200`, `modelsWithoutAuthorizationHttp=403`, `state=PERIMETER_OK`. Source: https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41422810899
- **Scheduled Cloudflare cron NOT active**. The account has reached the Workers Free limit of 5 cron triggers. API rejected a new trigger (10072). We did **not** upgrade, remove triggers, edit current Director or touch production
- An isolated GitHub Actions workflow provides read-only probe on branch updates, but it is **not a recurring default-branch schedule**. The D1 for agent check results is empty until the separate Worker is actually invoked.
- No connection to inference keys, no paid API, no generative task/publishing, and no live changes to original Director or OMDA 2.

**Next safe gate:** Choose a production-neutral recurring trigger (or later safely reuse an existing authorized cron without disturbing it) and secure a scoped client-profile API credential; only then authorize a bounded no-spend inference test. Never present perimeter readiness as proof of model inference or Agent orchestration.


## OMDA Step 6 server-side guard now deployed — 2026-11-02

- Server guard on Render staging commit `8f65be6b516edf1d615174d508aaa5963c415972` is **LIVE**. Logs confirmed restoration of the 1,196,032-byte existing database and upload of a fresh encrypted backup after deployment; the user account was not reset.
- A Client Profile called exactly `OMDA-Agent-Staging` is restricted, on **every** route, to `POST /v1/chat/completions` with one fixed compact JSON schema (128 max tokens, temperature 0.2, no streaming/tools, text only). Off by default without `OMDA_AGENT_INFERENCE_ALLOWED=true`. The operator's manual UI toggle alone cannot enable inference.
- Inference dispatch additionally rejects any route whose provider/model is not **exactly Groq + `openai/gpt-oss-20b`**, before an upstream request. Server-side SQLite usage limiter: max 10/day, one/minute; Cloudflare's separate D1 bridge limiter independently enforces the same. Do not confuse this with proof of a free plan on Groq.
- Client-profile identity cannot be renamed to or from the protected label, preventing simple name-based guard bypass from the profile-edit endpoint.
- CI: server policy unit tests + TypeScript build [PASS](https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41439434635); migration, SQLite restore and audit [PASS](https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41439434679).
- Real external post-deploy read-only verification [PASS](https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41439916152): Render GET `/api/ping`=200, direct Render `/v1/models`=403 and Cloudflare browser gateway redirect=302. No API inference was attempted.
- Fresh Cloudflare D1 store has three encrypted versions; head recorded 2026-11-02T11:49:36Z. Cloudflare staging Agent Bridge is private (workers.dev and previews disabled), has only a D1 binding and no secrets, no cron, no public caller access.
- **Cannot safely activate inference yet:** OMDA Bridge requires private `OMDA_CLIENT_KEY`, `OMDA_ORIGIN_TOKEN`, and an independently generated `OMDA_BRIDGE_TOKEN`, directly provisioned in Cloudflare Secrets, plus a verified free-tier-only Groq account. These are not accessible through connector read APIs. Do not paste them into GitHub, Docs or a chat. The default `OMDA_AGENT_INFERENCE_ALLOWED` setting remains OFF.
- Legacy OMDA, OMDA 2, video systems and the old encrypted backup remain untouched.
