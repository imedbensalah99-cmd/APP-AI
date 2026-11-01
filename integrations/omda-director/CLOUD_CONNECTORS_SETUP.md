# OMDA Director — GitHub Actions + Google Drive OAuth cloud connectors

## Confirmed as of 2026-11-01
GitHub in ChatGPT has repository admin/write access and Actions build test passed, but **Cloudflare Director still has no `OMDA_GITHUB_TOKEN`**. The existing Director v1 code on `main` already contains `githubPilotTick`, a once-only `github_pilot_v1` D1 record in READY state, and a fixed, safe workflow `.github/workflows/omda-agent-build.yml`. Do not add another secret to this repository, and do not mistake ChatGPT connector OAuth for Cloudflare environment variables.

The separate Google Drive connector in ChatGPT works, but its OAuth token cannot be exported or automatically reused by Cloudflare. The Drive module runs inside the existing `omda-agency-tools-readonly-v1` Cron to stay within the Cloudflare Free limit of five Cron triggers. It can use only OAuth secrets configured on that Cloudflare Worker.

## GitHub: one-time owner action needed
1. Open https://github.com/settings/personal-access-tokens/new to create a **fine-grained PAT** owned by the account. Select ONLY `imedbensalah99-cmd/APP-AI`. Set repository permission **Actions: Read and write**, other permissions as required by GitHub defaults. Use expiry and rotate it.
2. In the **Cloudflare dashboard** → Workers & Pages → `omda-agency-director-v1` → Settings → Variables and Secrets, create the encrypted secret `OMDA_GITHUB_TOKEN` containing that PAT. Never paste it into ChatGPT, GitHub source, D1, Drive or a ticket. `OMDA_GITHUB_BUILD_ENABLED` is currently a separate secret; it must be `true` to permit the one-time pilot.
3. The next hourly Director Cron may consume the **existing one-time READY job** `github_pilot_v1`: `OMDA-AUTOPILOT-PILOT-20261101`. It dispatches to the fixed workflow in `main`, which generates HTML and JSON artifacts only. No site publishing, email or main-branch writing.
4. Verify state `ACCEPTED` → `PASSED` in D1 and a corresponding GitHub Actions run. Do not claim it works without readback. For any failed/unknown network outcome there is **no automatic retry**.

GitHub reference: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event

## Google Drive: one-time owner action needed
1. In Google Cloud Console, create/select an OAuth project, enable **Google Drive API**, configure OAuth consent for your Google account, and create an OAuth client. Authorize with **only** `https://www.googleapis.com/auth/drive.file` and offline access. The bridge's new folder is app-owned; this scope cannot browse your entire existing Drive folder or Google Drive reports.
2. Obtain your OAuth **client ID, client secret and refresh token** through the official Google OAuth consent process. Use a trusted OAuth library or Google's OAuth Playground configured with your **own OAuth client**. OAuth in Testing status may issue short-lived refresh tokens; follow Google console verification/publishing guidance as needed for unattended operation.
3. In Cloudflare Workers → `omda-agency-tools-readonly-v1` → Settings → Variables and Secrets, add THREE encrypted secrets, not plain-text variables:
   `OMDA_GOOGLE_CLIENT_ID`, `OMDA_GOOGLE_CLIENT_SECRET`, `OMDA_GOOGLE_REFRESH_TOKEN`. Do not paste these into chat or source control.
4. Optional one-time proof creation: create D1 row `drive_bridge_jobs(id,state,...)` with id `once-v1` and state `READY`, then set Cloudflare secret `OMDA_DRIVE_SETUP_ENABLED=true`. Cron will create a NEW `OMDA AI Company - Autonomous Outputs` folder in user's Drive root and one harmless text proof, then stop. It will NOT touch the existing Agency OS folder or private files. No write if the flag/row is absent.
5. Check new D1 table `tool_checks` and `drive_bridge_jobs` after Cron; do not claim live OAuth verified before it runs.

Google references: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## Safety
Never send secrets in chat. No outbound emails, arbitrary URLs, paid model APIs, external publishing, private Drive reads, or OMDA 2 changes. Existing Cloudflare Director retains its own D1+KV and once-only GitHub pilot. The tools Worker has D1 only and HTTP 404; it now runs GitHub public read, Wikipedia search and credential-gated Drive checks using one existing Cron.
