# OMDA Staging Architectural Decisions — 2026-10-28

| Decision | Choice | Rationale | Boundaries |
|---|---|---|---|
| Cloud compute | Render Free web service, Docker/FFmpeg/Piper | Executable, verified 10-second narrated MP4 and free plan; no owner's computer required | Sleeps when idle, ephemeral disk; no production uptime SLA |
| Primary control plane | Existing Cloudflare account | Preserve existing investment and owner-only login | Production `omda-studio-private` untouched |
| Staging control plane | Separate `omda-video-staging` Worker and Access application | Avoid production changes while testing an authenticated browser/API | Requires live owner login validation |
| Durable job ledger | Separate Cloudflare D1 | Worker free-friendly and append-only records | Must remain independent of prod database |
| Small video proof storage | D1 BLOB capped at 1.6MB | Can persist a verified 0.55MB proof without creating billable storage | D1 enforces 2MB max BLOB/row, **not** viable for typical videos; use R2/Drive only after explicit authorization |
| Scheduler | Cloudflare Cron `*/5 * * * *` | Checks pending jobs, no unnecessary idle Render poll | Cron propagation delay possible; actual scheduled persistence requires verification |
| Render transport | Server-to-server bearer secret | Browser never receives runner credential | Both sides rotated; no secret printed to logs or repo |
| Video generation | No-spend original synthetic graphics + local Arabic Piper voice | Measurable real output | Not Flow/Veo/Gemini; must not be presented as AI model video |
| Publishing | Locked | Owner must review final checksum separately | No YouTube integration enabled |
| Billing | No paid APIs or Flow credits | Owner explicitly requires $0 spend | No billing-account activation or auto-upgrade |

## Known blockers
- No scalable private MP4 storage until owner approves a suitable resource with verified price/no-overage controls.
- No provider-supported consumer Google Flow automation. Not connected or authorized.
- No authorized YouTube OAuth grant or upload review; publishing deliberately locked.
- No owner-authenticated Android browser test until owner signs in to staging Cloudflare Access.

## Verification notes
Initial Render self-test `staging-smoke-10s` completed with Arabic narration, 10.002 sec output; generated checksum can differ across restarts because sound synthesis may vary. Always compare the checksum returned by the currently running Render job to the downloaded MP4 before marking it persisted.