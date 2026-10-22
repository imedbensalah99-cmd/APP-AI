# APP-AI · Job Application Tracker

A free, mobile-friendly job application tracker built with React, TypeScript and Vite. The app saves records **only in your current browser**, not to GitHub or a server.

## Features
- Add, edit, delete, search and filter job applications
- Status dashboard and follow-up/deadline alerts
- Sort by recent update, deadline, follow-up or company
- Import and export CSV files, skipping duplicates
- Application Agent workspace: CV-keyword overlap, visible eligibility warnings, duplicate checking, factual email-draft preparation, and manual recruiter email handoff (no auto-send)
- Responsive interface for Android and desktop
- Free, open-source dependencies; no paid APIs, no analytics or accounts

## Theme 1 — one-button search and review

The **Search Jobs Now** button queries the public Himalayas jobs API directly from the user's browser for remote listings accepting applicants based in Qatar. Requests are real network calls, not decorative buttons. The API's underlying data refreshes about once a day. Only Qatar-eligible or worldwide remote listings are included; this does not cover most on-site Doha vacancies.

If live queries fail, the app reads the latest scheduled public snapshot from public/jobs-cache.json. A free GitHub Actions workflow at .github/workflows/job-refresh.yml attempts to update it daily; repository Actions must have write permissions. An empty or inaccessible feed shows an honest message, not fabricated jobs.

**Import ChatGPT leads** accepts a JSON array with company, role, sourceUrl, and optional location and description (1–50 jobs). The app can also import a URL-encoded array through a temporary #jobs= fragment and immediately strips it from the URL. Imported leads are unverified until the user checks the employer's actual site.

Select any jobs and press **Prepare application drafts**. The draft text uses only the verified CV facts saved privately in this browser. Edit the message and verify the employer's job posting and optional email address. **Approve & open** uses the user's email app (mailto) or opens the official job URL; it does NOT send email, attach a CV, fill an employer form, or submit. **Trash draft** really removes the draft. The user manually attaches the PDF CV and submits. **I sent / submitted** marks the application Applied only after a further confirmation; delivery cannot be independently verified by this website.

A fully automatic email sender would require a secure authenticated email backend/OAuth integration and provider permission, which is not configured here. No paid APIs or external accounts are activated. Public GitHub Pages never receives user CV details, drafts, or sent records; those are stored in browser localStorage. Keep a CSV backup. Match counts are keyword overlaps, not an objective hiring probability or guarantee of eligibility.
## Application Agent (review-first)

Open **Job Application Agent** on the home page. Enter your own verified CV facts (not passwords, passport or QID details), paste an employer's vacancy text, then review overlap and flagged terms. Only information you enter is used when creating an email template; it is not AI-generated and does not verify skills, suitability, live vacancies or employer authenticity. The optional CV notes are saved only in localStorage in this browser. Click **Clear saved CV notes** to remove them from that local profile.

If this browser tracker already contains the same employer and role, APP-AI flags a duplicate. This check cannot see your separate Outlook emails or Google Drive workbook; review those before sending. Saving an opportunity always creates a **Wishlist** lead, never a submitted application. Opening the mail app only creates a draft; you must verify the recipient, manually attach your PDF CV and send it yourself.

**Important:** The public GitHub Pages website cannot securely access Outlook, your private CV, job portals, your existing daily job-search automations, or external recruitment systems. This is a preparation assistant; it is not a background crawler or autonomous job submitter. Do not publish CV data or exported CSVs to this public repository. All features work with existing free React/TypeScript dependencies and no paid APIs.

## Optional private CV prefill link

The owner can open an optional, one-time profile import link with URL fragment `#cv=` followed by URL-encoded JSON containing `name` and `facts`. The browser-only app immediately removes the fragment from the URL and stores those professional facts in localStorage on this device; the public repository contains no CV or candidate data. Review imported data before preparing an application. The link itself includes the information, so keep it private, do not share it or post screenshots of it, and clear the saved browser profile if using a shared device. The import never contacts employers and does not create or send an application.

## Local development
Requires Node.js 20.19+ or 22+.

```sh
npm install
npm run dev
npm test
npm run build
```

Open the local URL printed by Vite. No backend or API keys are needed.

## Privacy and limitations
Records are kept in localStorage on the device and browser profile where you use the application. Clearing site data, using incognito, or switching devices can lose your records. **Export a CSV backup regularly.** CSV exports contain personal application information: keep them private. This project is a productivity tool; deadline alerts appear **inside the app**, not as background mobile notifications. No recruitment emails are automatically sent.

## Publishing on free GitHub Pages
The repository owner approved publication on October 22, 2026. The Pages workflow runs on pushes to `main` and can be triggered manually from **Actions → Publish APP-AI to GitHub Pages → Run workflow**. If GitHub Pages is not yet enabled, configure **Settings → Pages → Build and deployment → Source: GitHub Actions** first. The expected free site URL is `https://imedbensalah99-cmd.github.io/APP-AI/`. The site only contains source-built static assets, not users' personal application records. GitHub Actions also runs automated tests on pull requests.

The Vite base path is set to `/APP-AI/` for a GitHub project page. Do not commit exported CSVs or personal records.

## Development workflow
Work is proposed in feature branches and pull requests. Review and merge explicitly. Changes merged to the main branch now trigger a Pages deployment when Pages is enabled.
