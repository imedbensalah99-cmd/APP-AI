# OMDA 2 Cloudflare AI Task Engine — Staging
This is a **real implementable model-task service** and a *future Paperclip adapter*, NOT Paperclip itself.

## Verified deployment
- Script: `omda2-agent-engine` (private workers.dev route **disabled**)
- Binding AI (Workers AI) ✅
- Binding TASK_DB → `omda2-agent-tasks-v1` ✅
- D1 schema: `agent_runs`, `audit_events`, `daily_limits` ✅
- Secret ADMIN_TOKEN: **not configured**; all non-health endpoints fail closed
- RUN_ENABLED: **false**, no inference
- Cron schedules: **none**, no background spending
- Provider usage: **no inference tests have been run**

## Auth and no-charge guardrails
Do not set `RUN_ENABLED=true` before **verifying the account's plan and AI daily quota in the Cloudflare dashboard**. The connector cannot read billing subscriptions (403). Cloudflare's public pricing describes a free daily allocation, but paid accounts can be charged when exceeding it. The code additionally caps execution to 4 model calls UTC/day; that cap does NOT cover other projects using the same account, so it cannot guarantee $0 on a paid plan.
Set `ADMIN_TOKEN` as a randomly generated 32+ char **Cloudflare secret**, never as a plain-text binding or in GitHub. Do not send it in chat.
When both billing and authentication have been verified, `RUN_ENABLED` may be explicitly enabled through a reviewed deployment. Route exposure requires a separate review with API authentication/rate limiting; do not enable workers.dev now.

## API contracts (Bearer ADMIN_TOKEN required)
- `GET /healthz`: public non-sensitive capability flags
- `GET /v1/status`: model, quota and enabled state
- `GET /v1/runs`: 20 latest runs and outcomes
- `POST /v1/tasks`: JSON `{"role":"research","task":"Public safe question"}`, OR role=qa
- It stores status, model, timestamps, results and audit events in D1. Research drafts don't browse, so they explicitly cannot claim verified sources.

## Paperclip integration later
Paperclip should remain the orchestrator and call this service through a narrow, authenticated HTTP adapter or a compatible OpenAI-style proxy when it is hosted on OCI. This bridge is **not yet connected to Paperclip**. Do not let a frontend speak to the model with secret in JS.

## Tests
1. Verify D1 schema through the Cloudflare API; check three tables.
2. Verify Worker has AI, TASK_DB, RUN_ENABLED bindings; workers.dev off; no Cron schedules; ADMIN_TOKEN absent.
3. Check no run exists with status completed; do not use a hard-coded fake model response.
4. After owner approves initial free-tier inference, execute a short public text generation; record run ID, actual output and usage; independently review via QA agent and validate restart persistence (OCI phase).
