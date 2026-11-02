# OMDA — Genuine MoneyPrinterTurbo directly on Render (staging)

This isolated service installs upstream `harry0703/MoneyPrinterTurbo` at audited
commit `27843a994bfa29c43c02150861d51490a6ca4bd2` in its **own Docker image**.
It invokes the real `cli.py` locally on Render; it is NOT an external API
proxy/bridge.

Deployment: Docker context repository root; Dockerfile at
`integrations/moneyprinter-direct/Dockerfile`; Python FastAPI wrapper on port
`PORT`. Use Render **free** plan, auto deploy OFF. New staging service; leave
the existing three Render services unchanged.

`GET /health` is safe and unauthenticated. `POST /v1/jobs`,
`GET /v1/jobs/{id}` and `GET /v1/jobs/{id}/review.mp4` require
`Authorization: Bearer <OMDA_MPT_DIRECT_TOKEN>` (minimum 32 chars).
`OMDA_MPT_ENABLE_JOBS=0` **by default**. Configure free Pexels or Pixabay
credentials in Render only, as `PEXELS_API_KEY`/`PIXABAY_API_KEY` and
a private `OMDA_MPT_DIRECT_TOKEN`; never commit credentials or publish them
in client-side JavaScript. A secure Cloudflare server-to-server connection is
a separate pending step. No automatic publishing, AI paid video API or Google
Flow credit usage is enabled.

MPT itself produces the video (stock search, Edge TTS `ar-SA-HamedNeural-Male`,
subtitles, video). Validated 60s portrait MP4 is retained temporarily at
`MPT_HOME/omda-jobs/<jobid>/review.mp4`. The render result must pass technical
validation; agent/semantic/legal checks still need implementation before a CEO
can authorize publishing.

**Storage lifecycle approved by owner:** Render = temporary workspace;
Google Drive = eventual durable archive. Never delete temporary Render files
until a trusted server-side Drive upload, readback, checksum and permissions
verification has succeeded. That Drive integration is intentionally NOT
implemented at this stage. The free Render filesystem is ephemeral and can
disappear without an upload, including on restart/redeploy. No automated
purge route is exposed yet.

**Limits:** Render free RAM/CPU may not complete 1080p rendering. Stock search
requires an actually available free provider key, not just a configured
provider name; existing Wikimedia Commons pilot hit HTTP 429. The engine
container boot and a 60s end-to-end video test must both pass before claiming
this path works in production.
