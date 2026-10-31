# OMDA 2 — Cloud-only Paperclip and real AI agents

**Status at 2026-11-01: staged infrastructure; no live Paperclip agent execution.**

This project is **not** the original OMDA AI Company. All source additions are under `omda2/` on branch `omda2-paperclip-cloud-v1`; existing OMDA branches and deployments were not altered.

## Verified

- New Cloudflare Worker: `omda2-command-center`, URL https://omda2-command-center.imedbensalah9988.workers.dev/ — code deployed, but requires a **server-side secret** `OMDA2_PASSWORD` before login can work. The dashboard is an early shell only; 9 labels are planned roles, not running agents.
- New Render free web service `omda2-paperclip-staging`: source build failed (>8 GiB build memory).
- New Render free web service `omda2-paperclip-runtime`: official Paperclip image was built successfully, but process crashed with exit 134 due to JavaScript heap out-of-memory. Not a healthy running Paperclip.
- New Render free PostgreSQL `omda2-paperclip-db`: available but not connected; expires 2026-11-30.
- Dedicated Google Drive folder: https://drive.google.com/drive/folders/1BNVt7JPpTmYfZsr9JYfEGLpuCPfdXeaL
- Project plan Doc: https://docs.google.com/document/d/1nA2tSKZq6YngKGMqDkCGlV6hPDJurkNs7L5kwBwM3q4/edit

## Preferred $0 cloud solution
**OCI Always Free A1 (2 OCPU + 12 GiB, subject to eligibility/capacity) + official Paperclip ARM64 Docker container + persistent bind mount + Tailscale Personal/Serve private HTTPS + verified free model endpoint + OpenCode or appropriate Paperclip adapter.**

See [the step-by-step deployment and operating runbook](oracle/RUNBOOK.md), [Compose template](oracle/docker-compose.yml), and [non-secret environment template](oracle/.env.example).

Use only a genuinely free model API (e.g. Gemini Developer API Free Tier *without billing*, Cloudflare Workers AI 10k free neurons/day, OpenRouter explicit `:free` models with quota). The Google AI Pro consumer subscription alone does not authorize free Gemini CLI access as of June 18, 2026. Never use paid credits, fake uptime load or autonomous publishing. Do not put model credentials in Google Drive, GitHub or frontend JavaScript.

## Launch gate
Before declaring success: verify OCI VM; verify Paperclip health, authentication and persistence after restart; connect a free inference provider and record a real AI API call; create one Research agent + QA agent with evidence from Paperclip run IDs and written artifacts; verify strict quota and no paid services. Until then: **0 functional agents verified**.

## Hard blockers
- No Oracle Cloud account or VM is connected through the available tools. User must sign up and pass phone/card verification if required. A small temporary card hold may occur. Oracle can reclaim idle free VMs.
- Free Render cannot reliably host this instance; no reason to loop deployments.
- The Cloudflare dashboard needs `OMDA2_PASSWORD` secret configured securely.
- Account-wide free quotas and actual model usage must be verified rather than assumed.
- Need automated encrypted offsite backup before production. The Drive folder is not a backup.

## Authoritative documentation
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.paperclip.ing/reference/deploy/docker/
- https://docs.paperclip.ing/reference/deploy/https/
- https://docs.paperclip.ing/reference/adapters/opencode/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://ai.google.dev/gemini-api/docs/pricing
- https://openrouter.ai/collections/free-models/
- https://render.com/docs/free
