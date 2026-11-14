# OMDA CV Match Evidence Workbench

A static, browser-only tool that compares user-supplied CV evidence statements with job requirements.

## What it does

- Compares normalized English and Arabic keywords without an LLM or network request.
- Separates SUPPORTED, PARTIAL, UNVERIFIED and GAP requirements.
- Counts evidence only when the user explicitly confirms the statements.
- Weights required, preferred and optional requirements separately.
- Exports a JSON report or UTF-8 CSV with formula-injection neutralization.
- Does not include raw CV evidence statements in the exported report.

## Run tests

Run: node --test integrations/omda-freellmapi-cv-match/engine.test.mjs

Open index.html through a static HTTP server or the OMDA Command Center link.

## Limits and honest interpretation

This is deterministic keyword coverage, not semantic understanding, an eligibility verdict, a hiring prediction or a CV authenticity check. Synonyms are not inferred. A user-confirmed statement is not independently verified. Review every result and compare the original job advertisement and CV manually.

## Privacy and safety

- No fetch/XHR/WebSocket, provider calls, upload, cookies, browser storage or server persistence.
- Inputs remain in page memory only and are discarded when the page is closed or cleared.
- Export contains job requirement text, status, percentages and evidence IDs; raw CV statements are not exported.
- Input size is limited to 64 KiB; 200 evidence statements; 100 requirements; 300 characters per line.
- CSV fields are quoted and formula-leading values are prefixed with an apostrophe.
- No emails, job applications, deployments or external writes are performed.

Rollback: revert the isolated CV-match branch/PR. No cloud resources or databases are modified.
