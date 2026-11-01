# OMDA Agency Tools v1 — public read-only, separate Cloudflare Worker

This tool Worker runs in the cloud without a phone or computer and persists status in the **existing OMDA Director D1 database**, in new tables only. It does not modify the main Director Worker, OMDA 2, or production site. HTTP requests return 404; only Cron activates it.

## Connected now
- Public GitHub repository metadata — read-only. No token or write access.
- Public Wikipedia research — fetch 3 citations per queued query. No broad search engine or source verification beyond Wikipedia.
- Cloudflare D1 check logs: `tool_checks` and `research_requests`. Strict maximum 2 queued searches per scheduled tick; no automatic retry.

## Not yet connected for cloud runtime
- **GitHub Actions dispatch**: current Director code requires `OMDA_GITHUB_TOKEN` as a Cloudflare secret; absent as of November 1. Do not embed token in source.
- **Google Drive**: ChatGPT connector works, but Worker still needs separate Google OAuth/service-account credentials for autonomous writes. Not falsely marked connected.
- Paid AI API, video publishing, outbound mail, multi-source web crawling: off.
- This toolkit is separate from Director's mission dispatch loop; the shared D1 is a staging bridge, not full automatic orchestration.

## Safety
No public HTTP access, no paid APIs, no uploads, no publishing, no arbitrary URLs, no GitHub writes, no secrets. No customer data should be placed in `research_requests`.

Cloudflare binding: `DIRECTOR_DB` D1 UUID `0c687072-daa8-41a9-a06e-89cb93fd7b9e`. Worker: `omda-agency-tools-readonly-v1`. Only use this Worker with the original OMDA AI Company.
