# OMDA Director — cloud-only, zero-spend pilot

Isolated Cloudflare Worker with scheduled handler (no public endpoints), its own D1 state and a tightly scoped Agency OS KV binding. It does not edit production OMDA, OMDA 2, or MoneyPrinter. It creates **written, internal drafts only**. Original Agency OS cron subsequently executes the approved source roles through Cloudflare Workers AI. Reality Checker gives PASS/REVISE/BLOCK; Director may schedule **one** corrective re-run after REVISE, then stops.

Safety:
- One newly selected mission per scheduled tick; at most two jobs per day (Director) and six shared Agency jobs/day; maximum two open Agency jobs.
- Each goal requires a final Reality Checker. No tools, live web search, repository writes, payment, emailing, video generation or publishing.
- D1 `UNIQUE(goal_id, iteration)` blocks duplicate launches; status and QA verdict are synchronized from original Agency KV.
- Only manually curated goals in Director D1 can start automatically. Defaults to zero goals; pilot goal must be inserted explicitly.
- No web-facing API; all `fetch()` calls return 404. Cloudflare cron is the only trigger.
- Worker does not include an Agents SDK package yet (it is a small safe orchestration stepping stone), nor Workflows/Durable Objects, nor an actual ChatGPT scheduled-task connection. Do not claim it supports these until deployed and tested.

Deployment: create separate D1 `omda-agency-director-v1`, apply `schema.sql`, upload `worker.mjs` with `DIRECTOR_DB` D1 and `AGENCY_JOBS` KV namespace, set schedule `0 * * * *` after a one-off test, and verify successful scheduled dispatch and QA. For test use a temporary `*/5 * * * *` schedule, then reduce to hourly. Save logs as evidence. No public key access.
