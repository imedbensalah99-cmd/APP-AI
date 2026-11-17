# OMDA Audit Explorer

A static, local-only viewer for exports produced by integrations/omda-freellmapi-audit/audit.mjs.

## Capabilities

- Imports the schemaVersion 1 JSON export.
- Enforces a 512 KB input limit and the ledger's 500-event bound.
- Verifies the complete SHA-256 hash chain before rendering any event.
- Filters by supported event type and a bounded text query.
- Exports the filtered view as CSV with spreadsheet-formula neutralization.
- Exports the complete verified ledger as JSON.
- Redacts common token and credential patterns from displayed text.

## Run locally

From the repository root:

    python3 -m http.server 18766 --bind 127.0.0.1 --directory integrations

Open http://127.0.0.1:18766/omda-freellmapi-audit-explorer/ and import a JSON file produced by the audit ledger exportJson() method.

## Privacy and trust boundary

The page makes no network requests and does not use cookies, local storage, IndexedDB, or a backend. Imported data remains in page memory until the page is closed or the session is cleared. The hash-chain check detects accidental or unsophisticated tampering, but it does not authenticate the file's author: anyone able to rewrite the full file can recompute an unkeyed SHA-256 chain. Treat the source and provenance of every imported file as a separate trust decision.

The viewer does not execute events, call agents, send email, submit applications, publish content, or deploy services.
