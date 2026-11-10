# OMDA Universal Command + Artifact Factory (staging, zero paid APIs)

## Feature delivered

This is a **new, working offline capability**, independent from the protected FreeLLMAPI inference bridge. It supports conversational Arabic and English instructions that may include **more than one intent**.

The engine routes commands into:
- `website` → real responsive HTML/CSS **starter preview**, with input HTML-escaped.
- `spreadsheet` → genuine **XLSX** Office Open XML workbook (Data + Summary sheets) with numeric/boolean types, styled headers, freeze panes, filters, and trusted summary formulas. User strings are always stored as literal inline strings, never executable formulas. Maximum 1,000 structured rows / 20 columns; optional rows supported. Formulas are recalculated by the spreadsheet app on open; cached formula results are not claimed.
- `email` → parser-compatible **unsent** RFC 5322 / MIME `.eml` draft with UTF-8 body transfer encoding and folded Arabic subject. No recipient is invented; no connector draft or sending is implied.
- `document` → Markdown brief, **not** misleadingly labeled a PDF/DOCX.
- `job_research` → honest research plan JSON; **not** a fabricated jobs search.
- `general` → Markdown project brief.

**No live job searches, email sends, website publishing, LLM model calls, external HTTP calls or paid API calls occur.** These operations require separate authorized agent tools. Generated HTML is a starter, not a complete custom production website.

## Functional browser prototype

- `../omda-freellmapi-command-center/index.html`: Arabic mobile UI with natural-language textbox, command presets and **actual client-side file downloads**.
- Uses `../omda-freellmapi-artifact-factory/engine.mjs` as an ES module.
- Source is committed **only to the isolated staging branch**. No public deployment, new domain, secrets or automated jobs were added.

To test the browser locally in a development environment (not required on the user's phone):

```bash
python3 -m http.server 18765 --directory integrations
# Open: http://127.0.0.1:18765/omda-freellmapi-command-center/index.html
```

## Functional GitHub Actions execution

Workflow: `.github/workflows/omda-freellmapi-artifact-factory-ci.yml`

In the isolated branch, open GitHub Actions → **OMDA Universal Artifact Agent — zero-credit CI** → Run workflow → enter an ordinary-language request. After the run completes, open its **Artifacts** section and download the `omda-artifacts-<run>` ZIP (retained 7 days). Avoid entering private information into workflow inputs, because runs may be visible to people with repository access.

Example:

```bash
OMDA_TASK_TEXT='اعمل لي ويبسايت وجدول إكسل وجهز مسودة إيميل' \
  node integrations/omda-freellmapi-artifact-factory/cli.mjs
```

Outputs appear in `integrations/omda-freellmapi-artifact-factory/generated/`, plus a manifest explaining which actions **were and were not** performed.

## Verification

- **17/17 new offline functional and security tests PASSED**, including a Python standard-library independent ZIP/XML/manifest verifier, in GitHub Actions [run 41614811834](https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41614811834) on the isolated XLSX child branch. The old **12/12** historical baseline also passed in [run 41528848349](https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41528848349).
- Same run generated **3 actual files**, verified nonempty and uploaded `omda-artifacts-1`. Log: `OMDA_GENERATED_ARTIFACTS=3`, `OMDA_PAID_CALLS=0`.
- Mobile UI syntax, local HTTP serving, and artifact engine tested in [run 41529236098](https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/41529236098).
- Existing Cloudflare FreeLLMAPI Bridge, private console, D1 quotas, Render and old OMDA/OMDA2 not modified for this new capability.

## Next engineering step

Connect the client-side Command Center to a **private, authenticated, persistent task orchestrator**, then add approved execution tools progressively (a researched job search, safe GitHub site build, DOCX/PDF export and draft email connector). Protect secrets, preserve hard free-tier budgets, avoid speculative success claims, keep send/apply/publish actions behind user authorization. Do not bypass blocked permission checks.

## Current XLSX integration and limitations (2026-11-03)

The existing command engine and offline mobile browser UI now download a **real binary `spreadsheet/data.xlsx`**, not a renamed CSV. The GitHub Actions CLI writes it as binary and records actual bytes and SHA-256 in `manifest.json`; CI independently opens the ZIP, parses all XML parts, validates two sheets, freeze/filter, formulas, and hashes. A green CI workflow provides a real short-lived GitHub Actions artifact, **not** an authenticated durable task download. The browser remains offline-only; no owner login, persistent cloud task queue, Render deployment, server-side artifact registry, or Android device acceptance was proved. The XLSX has formulas but does not embed recalculated formula results. Only trusted formulas are generated. No model calls, sends or website publication occur.

Verified state and backlog: `../omda-freellmapi-project/STATE.md` and `BACKLOG.md`. They are project-scoped copies, not root documents for other OMDA projects.

Email drafts are checked by Python's independent standard-library MIME parser in CI; no recipient is inserted unless explicitly provided, and all external sending remains gated.
