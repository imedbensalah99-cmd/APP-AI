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

## Application Agent (review-first)

Open **Job Application Agent** on the home page. Enter your own verified CV facts (not passwords, passport or QID details), paste an employer's vacancy text, then review overlap and flagged terms. Only information you enter is used when creating an email template; it is not AI-generated and does not verify skills, suitability, live vacancies or employer authenticity. The optional CV notes are saved only in localStorage in this browser. Click **Clear saved CV notes** to remove them from that local profile.

If this browser tracker already contains the same employer and role, APP-AI flags a duplicate. This check cannot see your separate Outlook emails or Google Drive workbook; review those before sending. Saving an opportunity always creates a **Wishlist** lead, never a submitted application. Opening the mail app only creates a draft; you must verify the recipient, manually attach your PDF CV and send it yourself.

**Important:** The public GitHub Pages website cannot securely access Outlook, your private CV, job portals, your existing daily job-search automations, or external recruitment systems. This is a preparation assistant; it is not a background crawler or autonomous job submitter. Do not publish CV data or exported CSVs to this public repository. All features work with existing free React/TypeScript dependencies and no paid APIs.

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
