# OMDA 2 — Paperclip Cloud (Isolated staging)

**Created:** 2026-11-01 (Asia/Qatar)

OMDA 2 is a **separate project** from the original OMDA AI Company. Only new Render services, a new database, a new Cloudflare Worker and a dedicated Google Drive folder were created. The existing OMDA production resources must not be changed.

## Architecture

- Core orchestration: [Paperclip](https://github.com/paperclipai/paperclip), official stable container image `ghcr.io/paperclipai/paperclip:latest`.
- Cloud runtime: Render web service `omda2-paperclip-runtime` (Frankfurt, free beta, auto-deploy OFF).
- Public application: https://omda2-paperclip-runtime.onrender.com — **must be verified and bootstrapped before production use**.
- Mobile shell: Cloudflare Worker `omda2-command-center`, served on `https://omda2-command-center.imedbensalah9988.workers.dev/`.
- New database: Render PostgreSQL 18 `omda2-paperclip-db`, free beta expires on **2026-11-30**; **DATABASE_URL is not yet configured**.
- Drive: https://drive.google.com/drive/folders/1BNVt7JPpTmYfZsr9JYfEGLpuCPfdXeaL
- Source branch: `imedbensalah99-cmd/APP-AI@omda2-paperclip-cloud-v1`, isolated from existing deployed branches; the branch only adds `omda2/` files.

## Current status and blockers

1. Paperclip Dockerfile built from source initially failed on Render (build memory limit 8 GiB).
2. Replaced build with a lightweight Dockerfile `FROM ghcr.io/paperclipai/paperclip:latest`; build succeeded.
3. Render deploy startup and HTTP health need verification.
4. Wire `DATABASE_URL` from the new Render PostgreSQL instance using the Render dashboard **without pasting secrets in chat**.
5. Free Render web services have no persistent disk. Persistent Paperclip agent workspaces, uploaded assets and secrets master key require persistent storage. Until that is addressed, this is staging, **not production**.
6. The Cloudflare dashboard intentionally fails closed until a secret named `OMDA2_PASSWORD` is configured in the **new Worker**'s Settings > Variables and Secrets. Do not hard-code the password in source.
7. Paperclip public admin bootstrap requires the authenticated/public onboarding process. Do not disable auth or claim the board through a publicly open first-visitor flow.
8. Connect an approved AI provider account inside Paperclip and set spend to zero until user approves usage. No agent has been created or activated.

## Planned agents

CEO, Operations, Developer, Research, Scriptwriter, Design, Video Production, Quality Assurance, and Finance. These are **planned roles**, not active agents.

## Security guardrails

- `PAPERCLIP_DEPLOYMENT_MODE=authenticated`, `PAPERCLIP_DEPLOYMENT_EXPOSURE=public`.
- Keep `BETTER_AUTH_SECRET` and `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` private and stable.
- Never publish, purchase, or execute financial transactions autonomously.
- Never reuse original OMDA credentials.
- New files and branches only; no updates to existing OMDA production services.
- Disable automatic upstream deployments and pin the official image digest once runtime is validated.

## Why this is not yet production-ready

Render free PostgreSQL expires in 30 days; Render free web filesystem is ephemeral; a fully persistent Paperclip company also needs durable asset and secret storage. A stable 24/7 cloud deployment may require a different cloud host or paid persistent resources.
