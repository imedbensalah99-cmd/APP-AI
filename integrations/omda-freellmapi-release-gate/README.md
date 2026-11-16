# OMDA Release Gate — imported snapshot auditor

A deterministic, browser-local Go/No-Go evaluator for the isolated FreeLLMAPI staging environment.

## Safety boundary

- No network requests, credentials, provider calls, cookies, browser storage, D1 writes, deployment or automatic remediation.
- The page reads a user-selected JSON file in memory and clears the selected file/report on request.
- Input is capped at 64 KiB; exact-key schema validation rejects unexpected fields.
- Reports contain only sanitized findings and aggregate facts, not raw IP allowlists, resource IDs, tokens or provider responses.
- REVIEW_READY means ready for human review only. It never authorizes deployment.

## Snapshot schema

See fixtures/current-staging-snapshot.json for a sanitized example of the observed 2026-11-16 state. The bundle has exactly these top-level fields:

- schemaVersion, capturedAt
- github: repository, branch, head SHA, branch protection, required checks, and up to 25 workflow runs
- render: service name, branch, plan, auto-deploy flag, suspended flag, IP allowlist, latest deploy SHA and status
- cloudflare: worker names and D1 database count/capacity only (no IDs or database contents)

Do not include credentials, environment variables, raw logs, D1 rows, or unrelated project resource names. Keep the snapshot limited to the FreeLLMAPI staging components.

## Use

1. Export the GitHub branch metadata and recent Actions runs for omda-freellmapi-secure-runtime-v1.
2. Copy the Render service's non-secret settings and latest deploy metadata.
3. Export only the relevant FreeLLMAPI Worker names and account-wide D1 count/capacity; do not include OMDA2 resource details.
4. Assemble the exact schema, save as JSON, open index.html from a local/static file server, and import the file.
5. Review every blocker and warning. Download JSON/CSV if needed.

This is an offline evidence evaluator, not a live integration. A fresh import is required after any infrastructure or CI change.

## Tests

node --test engine.test.mjs ui.test.mjs
node --check engine.mjs
