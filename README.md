# APP-AI · Job Application Tracker

A free, mobile-friendly job application tracker built with React, TypeScript and Vite. The app saves records **only in your current browser**, not to GitHub or a server.

## Features
- Add, edit, delete, search and filter job applications
- Status dashboard and follow-up/deadline alerts
- Sort by recent update, deadline, follow-up or company
- Import and export CSV files, skipping duplicates
- Job-specific CV Maker with direct/related/missing skill guidance and print-to-PDF / HTML export
- Application Agent workspace: CV-keyword overlap, visible eligibility warnings, duplicate checking, factual email-draft preparation, and manual recruiter email handoff (no auto-send)
- Responsive interface for Android and desktop
- Free, open-source dependencies; no paid APIs, no analytics or accounts

## One-button Autopilot — no manual job selection

The new APP-AI home shows **RUN JOB AGENT**. With a verified private CV profile saved in your current browser, pressing it searches live public Qatar-eligible remote-job feeds, uses the daily public snapshot as fallback, filters ineligible/senior/high-experience vacancies, checks evidenced CV skills, and **automatically prepares tailored email drafts and per-vacancy CV files** for suitable leads. There is no copying of job JSON, manual selection, or separate CV-generation step for those matches. Zero supported matches and unknown eligibility are kept in a review-needed list rather than falsely deemed suitable. An opening can be stale or unsuitable even when a public listing links to it.

**Ready to review** shows the prepared message, ready-to-print tailored CV, and two principal choices: **Approve & open application** or **Trash**. Trashed vacancies are remembered on this browser so they are not regenerated next time. The app stores its queue and private CV variants locally, not in this public repository. Existing tracking and advanced manual options remain accessible separately.

**Important sending limitation:** This is autonomous preparation, not autonomous delivery. Approve performs a real employer-site or mail-app handoff after a final user confirmation. The user still must verify the posting and eligibility, save/attach the CV and submit the job form or email. The static public GitHub Pages site has **no authenticated email-sending backend or employer API**; it cannot securely press Send, attach CV files or confirm submission. Only a subsequent user confirmation marks a job Applied. A truly one-tap sent-email action requires an authenticated email connector/OAuth integration and secure backend, with the user's explicit authorization; none is enabled or purchased. There is no paid API and no hidden automatic submission.

**Privacy and setup:** The agent reads your verified CV only from browser localStorage. If it is missing, it opens the one-time private profile setup rather than inventing experience. Use your private CV import link or enter your existing verified details. Remote eligibility and every published vacancy must still be verified before applying. The optional old search/import/manual queue remains under **Advanced manual search**; the main home is designed around one-click automatic preparation.
## Per-job CV Maker (free, private, review-first)

On every discovered job card and in the application draft queue, choose **Make tailored CV**. The new CV Studio preloads your browser-local professional facts from APP-AI, or your previously saved base CV, and lets you review source work history, actual title, education, certifications, languages and contact details. All information is saved in the browser; no CV or candidate data is committed to this public repository.

The skill advisor compares the job description with your own CV evidence. It labels requirements **Direct match** (supported by exact wording), **Related only** (transferable evidence but not proof of that requirement), or **Not evidenced** (do not claim the skill). Only exact, user-selected skills can appear in the exported skills list, and all experience text is taken from the user's verified source. Job target roles are labelled as target opportunities, never misrepresented as previous/current positions. The analyzer is a deterministic, transparent keyword engine, **not a live AI model**. To obtain an additional AI language review without a paid API, use **Copy prompt for ChatGPT AI review** and paste it into ChatGPT yourself; nothing is sent automatically.

Each job's tailored CV is stored separately in localStorage. After checking the source-CV confirmation box, **Preview / Save as PDF** opens an A4-printable ATS-style CV and the user can choose Print → Save as PDF, while **Download editable HTML CV** downloads a standalone HTML version. Android print support depends on the browser. Neither export sends an application. To prevent false claims, never add unsupported credentials to your source CV, and cross-check the generated document before use.

Limitation: no authenticated AI model, PDF-generation server, employer auto-fill, or automatic outbound emails have been installed. The free deterministic advisor identifies supported wording and flags transferability; unknown technical requirements and mandatory eligibility must still be checked manually.
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
