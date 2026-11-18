# OMDA Agent Watch History

A browser-local, read-only history analyzer for the dedicated `agent_checks` table used by `omda-freellmapi-agent-watch-staging-v1`.

## What it does

- Imports a Cloudflare D1 query JSON response or a direct `results` array.
- Validates the exact five-column telemetry contract (`id`, `created_at`, `health_http`, `model_http`, `verdict`).
- Recomputes the verdict from HTTP codes and rejects mismatches, duplicate IDs, malformed timestamps, unexpected fields and oversized snapshots.
- Reports the latest state as `HEALTHY`, `ATTENTION`, `STALE`, `CLOCK_SKEW` or `NO_DATA`.
- Computes check counts, percentage of perimeter-safe checks, current failure streak and longest healthy streak.
- Exports only verified status history to CSV or JSON; no row IDs or raw provider payloads are included in exports.

## Read-only D1 query

Run this query in the Cloudflare D1 console for the dedicated database `omda-freellmapi-agent-readiness-v1` and export/copy the JSON result:

```sql
SELECT id, created_at, health_http, model_http, verdict
FROM agent_checks
ORDER BY created_at DESC
LIMIT 30;
```

Import the D1 query response in `index.html`. The page accepts at most 64 KiB and 30 records, retains the data only in page memory, and makes no network calls or persistent browser writes.

## Run locally

```bash
node --test integrations/omda-freellmapi-agent-watch-history/engine.test.mjs
node --check integrations/omda-freellmapi-agent-watch-history/engine.mjs
python3 -m http.server 8765
```

Then open `http://127.0.0.1:8765/integrations/omda-freellmapi-agent-watch-history/`.

`fixtures/sample-d1-response.json` is synthetic demo data and must not be presented as a live health reading.

## Manual live snapshot (no Cloudflare Cron required)

The Cloudflare account currently has no free Cron-trigger slot available for this Worker. To avoid changing or disabling another project's trigger, the repository includes a push-triggered GitHub Actions workflow: **OMDA Agent Watch Snapshot (read-only)**. After this PR is merged into the isolated target branch, a push touching this tool runs the probe, uploads the `omda-agent-watch-snapshot` artifact (3-day retention), and the JSON can be imported into this page. The probe performs exactly two anonymous GETs to the fixed Staging origin, has a 15-second timeout per request, does not follow redirects, and sends no credentials or body. A non-safe result fails the workflow after the artifact upload step.

## Live heartbeat scope

The existing Cloudflare Agent Watch worker performs only two anonymous GETs to `/api/ping` and `/v1/models`, stores status codes/verdicts, and retains the latest 30 records. It does not invoke an AI model, send prompts, publish content, or make paid calls. The history page does not change or expose that Worker.
