# OMDA Plan Readiness Analyzer

A bounded, offline static analyzer for plans exported by OMDA Workflow Studio.

## What it does

- Validates the Workflow Studio v1 plan contract and rejects unknown fields.
- Checks protected workstreams (website, email, jobs, code) for approval gates.
- Detects explicit external-action wording without an approval gate.
- Checks same-workstream dependency continuity and gate placement.
- Warns when imported approval booleans are present; a plan flag is not proof of reviewer identity.
- Reports completed steps without a useful evidence note and vague step titles.
- Computes a deterministic SHA-256 fingerprint, a readiness score, and READY / REVIEW / BLOCKED decision.
- Exports a bounded JSON or CSV findings report.

## Use

Open the OMDA Command Center and choose Plan Readiness Analyzer, or serve the integrations folder with any static HTTP server and open this directory's index.html.

Export a plan from Workflow Studio as JSON, then import it into the analyzer. The report can be downloaded as JSON or CSV.

## Safety

This is a static review aid, not an approval system or task executor. It performs no network requests, provider calls, email, job submission, publishing, deployment, or filesystem writes. It does not persist imported content in browser storage. The report intentionally omits the original command text. SHA-256 identifies the exact imported plan content but is not a digital signature and does not prove who created or reviewed it.

Input is limited to 128 KiB and 24 steps. CSV cells are quoted and formula-neutralized.

## Tests

Run:

    node --test integrations/omda-freellmapi-plan-readiness/engine.test.mjs

The focused GitHub Actions workflow also checks JavaScript syntax and serves the UI and engine through a loopback-only HTTP smoke test.
