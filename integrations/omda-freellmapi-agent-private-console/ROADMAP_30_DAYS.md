# OMDA Free Agent — 30-Day Cloud Execution Roadmap

**Baseline:** 2026-11-03. **Target review:** 2026-12-02. This is a work plan, **not a promised delivery date**: access permissions, quotas, CI and validation gates determine progress. Do not silently skip blocked gates.

## What is actually verified before Day 1
- FreeLLMAPI Playground returned `OMDA_GROQ_TEST_OK` for Groq `openai/gpt-oss-20b` (one user-initiated inference).
- Isolated staging bridge: 10/10 offline unit tests pass, no public workers.dev or previews, quota D1 initially 0 rows, no cron. Live Agent inference **not** tested.
- Private Agent Test Runner: 7/7 offline tests pass, deployed with private Cloudflare Service Binding to staging bridge, no secrets, no public URL, no cron, disabled by default.
- Render staging Free service and encrypted data backup previously verified; it can cold-start and reset local disk. Use durable storage.
- Model/provider quota in bridge: **10 calls/day and one/minute, max 128 output tokens**, until a separately verified increase. Nine agents cannot each call hourly under this limit.

## Product goal
A mobile-friendly **single conversational OMDA** that can take natural Arabic/English orders: research jobs, review CV and produce Excel, build a responsive website with preview, draft an email, create Word/PDF, and operate cloud task queues without requiring the user to write code or prompts. One coordinator dispatches bounded specialist tools. Real emails, job applications and website publishing need scoped authorization and review; no open-ended autopublishing.

## Non-negotiable guardrails
- Cloud-only, free-only, zero paid AI/API calls or credit consumption; no local Windows or Termux; keep original OMDA AI Company, OMDA2 and other production services unchanged.
- Keep staging Worker private; no worker.dev exposure, unreviewed secrets, implicit credentials, or destructive repository changes.
- No live Agent execution unless authorized credentials, server-side Groq-only routing, hard quotas, logs and abort are verified. A safety tool block is a stop condition, not something to bypass.
- No promises of 24–48h continuous LLM inference. Implement intermittent resumable cloud tasks; proof requires actual long-duration tests.
- Each day ends with a report: tasks attempted, verified successes, failures, evidence links, free budget used, blockers, next-day plan.

## Phase: Audit & secure Agent

### Day 01 — 2026-11-03
- **Implement:** Inventory current Cloudflare/Render/GitHub state, secrets-by-name only, workflows and free-plan limits.
- **PASS gate:** Dated inventory and zero-cost baseline.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 02 — 2026-11-04
- **Implement:** Choose owner-authenticated private invocation path and verify Cloudflare Access/service-binding controls.
- **PASS gate:** Owner-only access design reviewed; no public worker.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 03 — 2026-11-05
- **Implement:** Finish supported secret provisioning and exactly one Groq-only bounded staging agent request.
- **PASS gate:** One actual answer and no paid fallback; if blocked, record blocker.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 04 — 2026-11-06
- **Implement:** Validate D1 and server quota increments, audit response, test rollback/disable.
- **PASS gate:** Recorded quota delta and disable procedure.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 05 — 2026-11-07
- **Implement:** Build basic authenticated Command Center dashboard in staging.
- **PASS gate:** Mobile UI renders behind auth; OFF by default.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 06 — 2026-11-08
- **Implement:** Implement task schema, job IDs, statuses, approvals and safe cancellation.
- **PASS gate:** Unit tests for created/running/paused/completed/failed states.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 07 — 2026-11-09
- **Implement:** End-to-end one-command flow: user asks for short analysis; orchestrator invokes one agent.
- **PASS gate:** One full traced run with logs and result.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

## Phase: Documents, jobs and communications

### Day 08 — 2026-11-10
- **Implement:** Implement durable workspace folder layout, artifact naming and storage permissions.
- **PASS gate:** Files survive runner restart; no secrets in artifacts.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 09 — 2026-11-11
- **Implement:** Build Excel generation using verified cloud Python/OpenPyXL runner.
- **PASS gate:** Download .xlsx with formulas and styling; spreadsheet test passes.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 10 — 2026-11-12
- **Implement:** Build PDF and Word generators, conversion and link delivery.
- **PASS gate:** Valid .pdf and .docx created from sample instruction.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 11 — 2026-11-13
- **Implement:** Integrate read-only job research using allowed sources.
- **PASS gate:** Three verifiable Qatar job links in a report, dates checked.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 12 — 2026-11-14
- **Implement:** Implement CV-match ranking, eligibility filters and factual evidence tracking.
- **PASS gate:** No invented qualifications; explained ranking.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 13 — 2026-11-15
- **Implement:** Create email drafting workflow with contacts, context and explicit send-approval gate.
- **PASS gate:** Draft only; no real email sent absent authorization.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 14 — 2026-11-16
- **Implement:** End-to-end multi-tool run: job scan → suitability table → Excel → email draft.
- **PASS gate:** All artifacts downloadable and human review required.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

## Phase: Web building and quality

### Day 15 — 2026-11-17
- **Implement:** Specify website requests from ordinary language; ask only mandatory questions.
- **PASS gate:** Brief auto-generated from a 1-sentence restaurant request.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 16 — 2026-11-18
- **Implement:** Generate working responsive website source in isolated GitHub branch.
- **PASS gate:** Successful npm install/build using free runner.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 17 — 2026-11-19
- **Implement:** Set up automated browser checks, accessibility smoke tests and mobile screenshots.
- **PASS gate:** CI mobile viewport and navigation checks pass.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 18 — 2026-11-20
- **Implement:** Create temporary preview and approval workflow without publishing production.
- **PASS gate:** Preview visible only as authorized; review feedback stored.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 19 — 2026-11-21
- **Implement:** Enable opt-in deploy to a free host with permissions, reversibility and domain checks.
- **PASS gate:** Human-approved test deploy; rollback proven.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 20 — 2026-11-22
- **Implement:** Implement revision loop based on user feedback and bug reports.
- **PASS gate:** Two revisions applied, CI rerun; no silent production changes.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 21 — 2026-11-23
- **Implement:** Demonstrate one combined user request: website → preview → revision → approved deploy.
- **PASS gate:** Trace, preview, security, build and handoff accepted.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

## Phase: Durable 24–48h operations

### Day 22 — 2026-11-24
- **Implement:** Design durable orchestrator and event-driven state machine (not single 48h process).
- **PASS gate:** Queue state machine and resumability tests pass.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 23 — 2026-11-25
- **Implement:** Add retries with exponential delay, deduplication and idempotency keys.
- **PASS gate:** No duplicate email, deploy, or provider POST on retry.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 24 — 2026-11-26
- **Implement:** Set free-tier rate limits, quotas, token budgets and circuit-breakers.
- **PASS gate:** Hard cutoff at 10/day until reverified; zero paid fallback.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 25 — 2026-11-27
- **Implement:** Add dashboard metrics, failures, cost=0 proof and stop/pause controls.
- **PASS gate:** View status, logs and controls on Android.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 26 — 2026-11-28
- **Implement:** Run controlled 3-hour persistence and recovery simulation on mock jobs.
- **PASS gate:** No lost or duplicated tasks; log actual uptime.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 27 — 2026-11-29
- **Implement:** Run real limited 24h pilot under free quota, with 1 coordinator + 1 specialist.
- **PASS gate:** Verified 24h audit, successful tasks, retries and zero paid spend.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 28 — 2026-11-30
- **Implement:** Run controlled 48h pilot with small task budget and manual approval gates.
- **PASS gate:** Verified 48h timeline and quota/cold-start behavior, or explicit blockers.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 29 — 2026-12-01
- **Implement:** Security audit, secret rotation if needed, backup restore and incident rollback.
- **PASS gate:** Recovery test, user data isolation, no public private Workers.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

### Day 30 — 2026-12-02
- **Implement:** Acceptance demo and staged release; decide expansion to 3 then 9 roles from measured results.
- **PASS gate:** User can request job/Excel/website/email draft; 24h pilot verified; limitations documented.
- **Evidence:** commit / CI run / screenshot / artifact URL; status must be VERIFIED, BLOCKED, or NOT STARTED.

## Daily operating rhythm (proposed)
1. Inspect yesterday's evidence and platform quotas first (read-only by default).
2. Implement one vertical slice on isolated branch; run offline security tests and CI.
3. Attempt live integration only when explicitly authorized and with hard guardrails.
4. Record PASS / FAIL / BLOCKED, a reproducible trace, and one clear next action.
5. Never report task done merely because code was committed or a UI mockup exists.

## Releases / decision gates
- **Day 7 target:** one authenticated end-to-end Agent call, otherwise blocked and unresolved access listed.
- **Day 14 target:** practical jobs + Excel/PDF + email drafting workflows.
- **Day 21 target:** full small website from natural request through approved deployment.
- **Days 27–28 target:** verified 24–48h episodic run under a strict free quota, not nine simultaneous always-on LLMs.
- **Day 30 target:** release only proven functions; roll over failed gates and reschedule honestly.

**Automated daily plan delivery:** currently not schedulable on this account because all five task automation slots are occupied. No existing automation should be overwritten or disabled without user choice.
