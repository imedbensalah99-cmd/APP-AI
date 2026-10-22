# APP-AI · Job Application Tracker

A free, mobile-friendly job application tracker built with React, TypeScript and Vite. The app saves records **only in your current browser**, not to GitHub or a server.

## Features
- Add, edit, delete, search and filter job applications
- Status dashboard and follow-up/deadline alerts
- Sort by recent update, deadline, follow-up or company
- Import and export CSV files, skipping duplicates
- Responsive interface for Android and desktop
- Free, open-source dependencies; no paid APIs, no analytics or accounts

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
