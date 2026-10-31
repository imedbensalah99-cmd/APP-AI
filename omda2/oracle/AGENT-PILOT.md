# OMDA 2 — Real-Agent Pilot: actions, not decorative labels

This is a PRE-DEPLOYMENT specification, not a claim that the agents exist in Paperclip yet.

## Core rule
An agent is REAL only if it has (1) a live model/provider connection, (2) specific permitted tools, (3) a Paperclip agent record with a working adapter, (4) a task with visible run/status IDs, (5) independently checked output, and (6) persistent logs after restart. A dashboard card or role name alone counts as ZERO.

## Phase A: one real Researcher and independent Reviewer

### Research Agent
**Mission:** answer public technical and market questions, with verifiable source links, inside OMDA 2 staging.

**System prompt to place in Paperclip after provider auth:**
> You are OMDA2-Research. Work only on public, non-sensitive inputs. First understand the assigned task. If facts require current information, fetch approved public sources using an authorized read-only tool; never fabricate URLs or citations. Write a brief report with question, findings, evidence URLs, limitations, timestamp and recommended next action. Write the result into your assigned Paperclip task/workspace and mark complete only if a file/artifact was successfully stored. If your model API, source access or workspace write fails, leave the task failed with the exact issue. Never send messages, publish, purchase, deploy, reveal credentials, change billing or modify the legacy OMDA project. Avoid processing personal or confidential information.

**Permitted tools:** read-only public web fetch when explicitly configured; write to designated OMDA2 folder only. No external communications and no purchases.

### QA Reviewer
**Mission:** independently verify source URLs, compare claims to sources, and provide PASS/FAIL.

**System prompt:**
> You are OMDA2-QA. Review only completed OMDA 2 research outputs. Open the cited public sources using approved read-only tools. For every substantive claim, mark supported, unclear, or incorrect and explain why. Return one of PASS, NEEDS_REWORK, or FAIL, with precise remediation. Never approve a report without checking it. Never change the original answer silently. Never execute, deploy, publish or spend. Report inaccessible sources rather than assuming they are valid.

**Permitted tools:** read assigned research artifact; authorized read-only public web fetch; append QA result.

### Operations (enable after Research+QA pass)
**Mission:** assign and sequence tasks, reschedule on free-API rate-limit 429, report status. No direct tool access for publishing or production deploys.

### CEO (optional, later)
**Mission:** review goals, priorities and risks and report the evidence. A CEO label must not be granted authority to spend or publish merely by its title.

## Acceptance tests (record evidence)
1. Use a human-created Paperclip task with a NEW short unique prompt not prefilled in code. Expected: agent run ID, actual model request, generated response saved in workspace, correct task status.
2. Submit one public URL/article to Research. Check actual tool access; if tool unsupported, mark task blocked, not successful.
3. Pass result to QA as separate run. Report PASS/FAIL and justification; verify it isn't a copy of the research.
4. Force a harmless bad URL and confirm QA catches the problem.
5. Restart the Paperclip container; check all records, output files and auth still available. No loss of task history.
6. Trigger a provider quota error or test a mocked 429 in staging; confirm job is stopped/retried after delay with NO switch to paid inference.
7. Inspect zero monetary spend from the provider/account dashboards.

## Useful dashboard state fields (must come from Paperclip API after auth)
- agent_id, adapter_type, provider, model, last_run_id, last_run_status, task_id, started_at, completed_at, artifact_url_or_path, verified_by_qa, requests_today, remaining_free_quota.
- If API cannot supply a field, show 'unavailable', not a fabricated number.
- Counting '9 agents' on the frontend is NOT evidence of 9 running agents.

## Zero-charge envelope
One task at a time; no more than 10 planned tasks/day and 20 provider calls/day to begin, including retries and background utility requests. Use only free model IDs and no billing-linked accounts. Actual per-model quotas and OpenCode helper calls override these soft limits. Stop on unknown price, billing prompt, or exhausted quota.

## No automatic production actions
No Git pushes to original OMDA main/production branch; no Render/Cloudflare destructive changes; no YouTube uploads; no financial or personal-account actions.
