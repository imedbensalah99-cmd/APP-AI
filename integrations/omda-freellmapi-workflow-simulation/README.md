# OMDA Workflow Simulation Lab

A bounded, deterministic, offline-only schedule simulator for Workflow Studio v1 plans.

## What it does

- Imports a Workflow Studio v1 JSON plan.
- Estimates task durations with editable per-step overrides.
- Schedules ready tasks across 1–4 virtual worker lanes.
- Respects dependencies and completed/blocked source states.
- Propagates blocked prerequisites to downstream tasks.
- Models approval wait as a dependency hold while freeing the worker lane after task work.
- Calculates makespan, dependency critical path, concurrency overhead and lane utilization.
- Exports JSON and formula-neutralized CSV reports.
- Includes a Node.js CLI for local/CI use.

## What it never does

- It does not execute tasks or change the imported plan.
- It does not request, record or verify approvals.
- It does not call an AI provider, external API, email, GitHub, Cloudflare or Render.
- It does not publish, deploy, submit job applications or write report files.
- The browser UI does not use cookies, localStorage, IndexedDB or remote scripts.

## Browser use

Serve the repository root with any static file server and open:

/integrations/omda-freellmapi-workflow-simulation/

Import a JSON export from Workflow Studio, edit duration estimates, choose concurrency and optional approval wait, then run the simulation and download a report.

## CLI

    node integrations/omda-freellmapi-workflow-simulation/cli.mjs plan.json
    node integrations/omda-freellmapi-workflow-simulation/cli.mjs plan.json --format csv
    node integrations/omda-freellmapi-workflow-simulation/cli.mjs plan.json --concurrency 3 --minutes 25 --approval-wait 15

The CLI reads one file (maximum 128 KiB) and writes to stdout only. Exit code 2 means invalid input or invalid options.

## Bounds

- Plan: 128 KiB, 1–24 steps.
- Virtual lanes: 1–4.
- Default/per-step work estimate: 1–1440 minutes.
- Approval wait estimate: 0–720 minutes.
- Exact plan and step keys are enforced before using Workflow Studio's validator.
- No third-party runtime dependencies.

## Scheduling model

This is deterministic list scheduling: at each simulated time, ready tasks are assigned in plan order to the earliest available lane. A lane is occupied only during estimated task work. If a step has an approval gate, its configured approval wait delays dependants but does not occupy a lane. The critical path is computed without lane contention; the reported makespan includes lane contention.

All durations are user estimates, not measured execution times. A simulation result is not a promise, approval receipt, execution log or deployment authorization.
