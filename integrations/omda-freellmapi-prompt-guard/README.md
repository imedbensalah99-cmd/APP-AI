# OMDA Prompt Data Guard

A local-only preflight tool for inspecting prompt text before a user manually pastes it into an agent interface.

## What it does

- Detects common credential and token shapes, private-key blocks, credential assignments, URL secrets, email addresses, phone-like values, Qatar ID-like values, and Luhn-valid payment-card candidates.
- Produces metadata-only findings (label, category, severity, offsets). Matched values are never copied into the findings list.
- Replaces detected ranges with explicit placeholders in a separate sanitized copy.
- Provides a mobile-friendly Arabic UI and a no-dependency Node CLI.
- Keeps the browser flow offline: no fetch/XHR, cookies, localStorage, IndexedDB, analytics, remote scripts, or automatic submission.

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/integrations/omda-freellmapi-prompt-guard/`.

## CLI

```bash
node integrations/omda-freellmapi-prompt-guard/cli.mjs ./prompt.txt
node integrations/omda-freellmapi-prompt-guard/cli.mjs ./prompt.txt --format redacted
node integrations/omda-freellmapi-prompt-guard/cli.mjs ./prompt.txt --format json
node integrations/omda-freellmapi-prompt-guard/cli.mjs ./prompt.txt --strict
```

The CLI reads one UTF-8 file and writes only to stdout/stderr. It never writes a report file or calls a network service. `--strict` returns exit code 1 when any finding exists; malformed arguments or file/size errors return 2.

## Limits and safety

- 8,000 JavaScript characters and 16 KiB UTF-8 per prompt.
- No more than one input file per CLI invocation.
- No persistence in the browser.
- Browser rendering uses `textContent` for findings and the sanitized prompt is placed in a textarea value.
- Clipboard access occurs only after an explicit click.
- Download requires an explicit user click.
- CSV/HTML output is not generated; the sanitized download is plain text.
- No paid APIs, provider calls, email, job submission, publishing, or deployment.

This is heuristic pattern detection, not a certified DLP system. It can produce false positives and false negatives. A clean result is not proof that text is safe. Review the sanitized copy manually before sending it anywhere. Redaction may change meaning or remove necessary context.

The tool is a manual preflight aid. It does not intercept or modify the live FreeLLMAPI backend request path.
