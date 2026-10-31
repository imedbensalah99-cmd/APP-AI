# OMDA 2: zero-cost, cloud-only deployment & operations runbook

**Status:** PREPARED, NOT DEPLOYED ON ORACLE. Do not report that Paperclip or agents are live until all acceptance checks pass.

## Decision (2026-11-01)
Prefer Oracle Cloud **Always Free Ampere A1** if account registration, home-region capacity and the A1 shape are available. Allocate a single **2 OCPU / 12 GB ARM64** instance; keep all resources strictly Always Free. Keep the account Free Tier and never upgrade it to PAYG. Oracle might require credit-card verification and may apply a temporary authorization hold; that is not guaranteed to be zero cash movement. If the user declines verification, the best alternative is a limited **Cloudflare Workers AI + D1** experiment, NOT an always-on Paperclip company.

**Why not Render Free:** The actual new Paperclip Docker instance ran out of JS heap and exited 134. Render Free has ephemeral filesystem and spins down on idle; its free PostgreSQL expires in 30 days. Stop retrying it as a long-lived Paperclip deployment.

## Components and isolated accounts
- Core: official Paperclip multi-arch GHCR Docker image; use digest pin after confirming linux/arm64 compatibility.
- Compute and persistent state: Oracle OCI A1 with host volume `/srv/omda2/data`.
- Private TLS mobile access: Tailscale Personal + Serve; **not** public Cloudflare Tunnel / insecure local_trusted.
- Data: Paperclip embedded database backed by the persistent volume. No dependency on expiring Render Postgres.
- Model primary: Google AI Studio **Gemini Developer API Free Tier**, only a project without linked paid billing, using a free-eligible model confirmed in AI Studio. API free quotas vary.
- Model fallback A: **Cloudflare Workers AI free allocation** (10,000 neurons per day, subject to model restrictions), via its OpenAI-compatible chat endpoint and a narrowly scoped API token. Must be configured separately.
- Model fallback B: **OpenRouter :free model** (currently 50 requests/day for accounts with no credit purchase). Never select a paid model or a routed provider that may charge.
- Adapter: Paperclip OpenCode or native supported Chat Completions connection. HTTP custom adapter only after signed callback validation.
- UI: existing OMDA 2 mobile Cloudflare Worker is independent, currently locked without its `OMDA2_PASSWORD` secret. Do not show fake agent status.

## What requires an action from the account owner
1. Create or sign in to an eligible Oracle Always Free account and provision a **single** A1 Flex VM in the *home region*. This step can require card/phone verification; do not enter those in chat.
2. Install Docker Engine / Compose and Tailscale on the cloud VM, **not on the PC**. From the user's phone, install Tailscale for private access.
3. Transfer this `oracle/` folder to the cloud VM; create `/srv/omda2/data` with suitable owner permissions. Ensure the host filesystem has sufficient free space.
4. Create `.env` based on `.env.example`; fill the Tailscale HTTPS hostname. Generate **distinct** keys securely ON THE VM:
   - `openssl rand -hex 32` for `BETTER_AUTH_SECRET`
   - `openssl rand -hex 32` for `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET`
   - `chmod 600 .env`, never commit it.
5. Confirm an ARM64 image exists before starting: `docker buildx imagetools inspect ghcr.io/paperclipai/paperclip:latest`. Pin the selected multiarch digest in `PAPERCLIP_IMAGE`; this sample defaults to `:latest` and must be pinned after validation.
6. Start Tailscale: `sudo tailscale up`, enable HTTPS certificates and MagicDNS in Tailscale admin; serve on the cloud VM: `sudo tailscale serve --bg --https=443 http://127.0.0.1:3100`.
7. Run `docker compose config -q` and `docker compose up -d`. Do not open port 3100 to the public internet; Compose binds it to host loopback.
8. Check from VM: `curl -fsS http://127.0.0.1:3100/api/health`; from a phone in the tailnet, verify HTTPS at the Tailscale URL.
9. Claim the first Paperclip admin **securely** in authenticated mode using the operator's **one-time CLI invite**, for example `docker compose exec paperclip sh -lc 'cd /app && pnpm paperclipai auth bootstrap-ceo'`; verify against the installed version's help and use the printed private invite URL on the phone. Do not post the invite into chat or logs.
10. Connect only one strictly free model API (or free Cloudflare Workers AI route) through a server-side Connector. Never put API keys in front-end code or Google Docs.
11. Inside Paperclip create one company, one **real working Research agent** and one **real QA reviewer agent**. A third Operations agent may be enabled after passing the first canary.
12. Set strict scheduling and quotas. Start with 1 concurrent run, <=10 agent tasks/day and <=20 total model API calls/day across all agents; halt at provider-specific 429/free-quota errors. Beware agent harnesses may generate multiple model calls per task. Paperclip budgets are not a substitute for provider-level billing lockdown.
13. Run 3 canary tests and store their proof (run ID, task ID, model, API request counts, timestamps, task output) before adding more roles.

## First actual working canary
**Input:** research a public, non-sensitive question such as 'What is a Cloudflare Worker?'.
- Research agent must call a real free AI model; not return a hard-coded canned answer.
- Agent records its source links, a 150-word answer, and a task completion with a Paperclip run ID.
- QA agent checks sources and returns PASS/FAIL with reasons, as an independent model run.
- System records quotas and raw call counts.
- Reboot OCI VM/container, sign in again, confirm the data and full execution log **persist**.
- Verify from phone. No publishing or other side effects.

## Live-agent permissions
Research: public internet read, internal project folder write, no sending.
QA: read outputs, mark PASS/FAIL, no publishing.
Operations: task assignment and job schedules only; don't change infrastructure.
CEO: governance and human-visible decision summaries; must not invent successful actions.
Developer, Writer, Designer, Video, Finance: DEFERRED until canary acceptance; labels alone are not agents.

## Spending and privacy controls
- Use ONLY free-eligible Oracle Always Free resources; account should not be upgraded to PAYG.
- Do not connect a billing account to Google AI Studio project. Do not connect a paid OpenRouter credit account.
- Make provider usage explicitly fail closed at the cap. Disable automatic fallback to paid models.
- Never send employment records, personal documents, credentials, customer AML data or internal company information to free APIs. Google free-tier content can be used to improve products.
- Prevent agent execution of arbitrary shell commands or external writes until tested and isolated. Guard tool access per agent, no global admin credentials.
- Back up `/srv/omda2/data` encrypted to offsite storage; Google Drive is a future backup target that needs separate OAuth and scheduled verification. A folder alone is not a backup.
- Paperclip, Docker, OCI, and provider quotas can change; revalidate before deploying.

## Risks / no false guarantees
- Oracle A1 free capacity may be unavailable. Oracle can reclaim idle Always Free VMs after sustained low utilisation; **do not generate fake load** to defeat policies.
- A $0 plan is best-effort, **not** a guarantee of uninterrupted 24/7 uptime or indefinite free API access.
- Tailscale is private and requires the phone to join the same tailnet. Public webhooks and external ChatGPT/Work access require separately designed authenticated public ingress.
- No Oracle deployment, model authentication or end-to-end test has actually occurred yet.

## Current verified source links
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle signup requirements: https://docs.oracle.com/en/learn/cloud_free_tier/
- Paperclip Docker: https://docs.paperclip.ing/reference/deploy/docker/
- Paperclip HTTPS & Tailscale: https://docs.paperclip.ing/reference/deploy/https/
- Paperclip adapters: https://docs.paperclip.ing/reference/adapters/opencode/
- Paperclip installation/admin: https://docs.paperclip.ing/guides/getting-started/installation/
- Tailscale Free: https://tailscale.com/pricing
- Cloudflare Workers AI free: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Gemini API free tier: https://ai.google.dev/gemini-api/docs/pricing
- Google individual Gemini CLI deprecation: https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals
- OpenRouter free routing: https://openrouter.ai/collections/free-models/
- Render Free limitations: https://render.com/docs/free
