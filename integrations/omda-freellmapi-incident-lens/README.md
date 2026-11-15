# OMDA Incident Lens

A browser-local log triage utility for sanitized Render, Cloudflare and GitHub Actions logs.

## Use

1. Open index.html from a local static server or the OMDA Command Center link.
2. Paste log text or select a TXT, LOG, JSONL or JSON file.
3. Choose Analyze locally.
4. Review the sanitized incident groups and recommended diagnostic checks.
5. Export the sanitized report as JSON or CSV if needed.

No log text is uploaded. The raw input is cleared from the textarea after successful analysis. The sanitized report remains in page memory until Clear is selected or the tab is closed.

## Bounds and safety

- Maximum input: 256 KiB.
- Maximum input lines: 2,500.
- Maximum displayed line length: 2,000 characters.
- Recognizes common Bearer/JWT/provider-token patterns, key/value secrets, query-string credentials, private-key blocks and email addresses.
- CSV values beginning with spreadsheet formula characters are neutralized.
- The UI renders with textContent; it does not render log content as HTML.
- No network calls, cookies, browser storage, server persistence, provider calls or automatic remediation.

Redaction is pattern-based and cannot guarantee discovery of every secret or personal detail. Always inspect the exported report before sharing it. Classification is heuristic triage, not proof of root cause or a live service health check.

## Synthetic fixture

The fixtures/synthetic-staging.log file contains fabricated 502, 403, 429, timeout and memory examples for a safe UI demonstration. It contains no live service data or credentials.

## Tests

Run with Node.js 20 or later:

node --test integrations/omda-freellmapi-incident-lens/engine.test.mjs
node --check integrations/omda-freellmapi-incident-lens/engine.mjs

The GitHub Actions workflow performs these tests and a loopback-only static HTTP smoke check.
