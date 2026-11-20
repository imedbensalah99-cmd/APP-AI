# OMDA Approval Desk

A browser-local review desk for JSON plans exported by `integrations/omda-freellmapi-workflow-studio`.

## What it does

- Imports a strict, bounded Workflow Studio plan (128 KiB maximum, 24 steps maximum).
- Revalidates the `PLAN_ONLY` envelope, exact keys, manual-only execution, dependencies and protected workstream approval gates.
- Creates a fresh SHA-256 fingerprint over a canonical representation of the imported plan.
- Records one immutable `approved` or `rejected` decision for each approval-required milestone.
- Requires a 5...240 character reason for rejection.
- Exports a verified JSON receipt or formula-neutralized CSV.

## Safety boundaries

- This is an internal review record only. It does not send email, submit job applications, publish websites, deploy code, call a provider, or execute a workflow.
- Every imported plan starts with fresh `pending` decisions. The plan's own `approved` boolean is not accepted as evidence of a prior review.
- The receipt is bound to the exact plan digest; changing the plan invalidates the receipt.
- SHA-256 is an integrity fingerprint, not a digital signature. It does not authenticate the author or reviewer.
- The page makes no network calls and uses no cookies, localStorage, IndexedDB, or server persistence. State is held in page memory until exported or the page closes.
- The app renders imported text through `textContent`, not HTML.

## Run locally

Serve the repository root with any static HTTP server, then open:

`/integrations/omda-freellmapi-approval-desk/index.html`

For example, from the repository root:

`python3 -m http.server 8000`

Then open `http://127.0.0.1:8000/integrations/omda-freellmapi-approval-desk/`.

## Tests

`node --test integrations/omda-freellmapi-approval-desk/engine.test.mjs`
