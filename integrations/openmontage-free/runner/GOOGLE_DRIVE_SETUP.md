# OMDA Step 2 — Private Google Drive storage

**Status (29 October 2026):** Implementation and mock tests are complete. Staging
Render has the correct **non-secret** OMDA QA folder ID, but a separate
Google OAuth grant has **not** been configured. No Render-produced Drive
file has been created or verified.

## Deployed protected routes

1. `GET /v1/storage/preflight`: Require owner-authorized Cloudflare Access
   JWT. Refresh Google OAuth access token only when the three server credentials
   exist; request metadata of configured QA folder; check exact folder ID,
   folder MIME, not trashed and `capabilities.canAddChildren === true`.
   This route **never writes a file**.
2. `POST /v1/storage/smoke`: Require owner JWT. If preflight succeeds,
   upload a tiny original JSON-only manifest to the dedicated QA folder;
   retrieve Google metadata (file ID, size, MD5, parent folder), download the
   complete bytes, compare SHA-256 and byte-for-byte readback, then return
   an owner-only proof receipt. No other existing Drive files are changed;
   this test leaves its benign test artifact in QA history. No video generation,
   YouTube upload, deletion or paid provider call.
3. Cloudflare `/api/storage/preflight` (GET) and `/api/storage/smoke`
   (explicit owner POST with custom header) forward only to the fixed Render
   staging hostname. Owner identity is checked by Cloudflare; the signed
   Access JWT is validated independently by Render.
4. A protected Dashboard shows the **actual** permission result and keeps
   the safe-upload test disabled until authorization passes. Documentary
   generation remains locked pending production acceptance and source rights.

## Existing Drive destination

- OMDA Media Company project:
  `https://drive.google.com/drive/folders/1Tpt4rJepOdvdiUH9QiUAoSJA-gDCZFa5`
- Germany pilot QA/Manifests folder:
  `https://drive.google.com/drive/folders/1h4wLxv0a5cH3_9iyN3juwOzB4yG1Wnlw`
- Render only has the public folder ID in `OMDA_DRIVE_QA_FOLDER_ID`.
  This does not grant access; OAuth is separately required.

## One-time owner-controlled OAuth authorization

The ChatGPT Google Drive connector is **not** the Render server's OAuth client.
Do not copy its credentials or browser tokens. A personal Google Cloud OAuth
client with the Drive API enabled and explicit owner consent is needed to
access private Drive files from Render.

The existing Render adapter expects these **server environment secrets**:
- `OMDA_DRIVE_CLIENT_ID`
- `OMDA_DRIVE_CLIENT_SECRET`
- `OMDA_DRIVE_REFRESH_TOKEN`

Store them only in authorized Render Environment / Secret configuration;
never put them in GitHub, URLs, project reports, chat messages, Dashboard
JavaScript or public logs. Keep the Worker private and production video
controls disabled during setup.

**Consent-scope tradeoff:** Google recommends `drive.file`, which limits an
app to files it creates or files explicitly selected through Google Picker.
The existing OMDA folder cannot be assumed available under `drive.file`
without Picker-mediated granting. Broader `drive` access can reach existing
folders but is a **restricted** Google scope and should only be requested
through the user's explicit informed consent and applicable Google
verification requirements. Do not silently expand scopes. An app-created
isolated Drive folder is the safer alternative once a scoped OAuth setup
has been prepared.

Official Google references:
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/drive/picker/guides/web-picker

For an owner-created web OAuth client, Google's OAuth Playground supports
use of one's **own** client ID and secret and server-side offline access,
but needs `https://developers.google.com/oauthplayground` configured as an
authorized redirect URI. Verify Google Cloud consent/testing/verification
settings before generating a refresh token; testing-mode refresh tokens
may not be stable enough for unattended production.

## Production acceptance checklist

- [x] Render staging binary upload and download adapter with SHA-256 and MD5.
- [x] Mock tests: missing/revoked OAuth, folder ID/MIME/write permissions,
  safe upload, exact readback, altered bytes and no accidental publication.
- [x] Owner-only Cloudflare endpoints and dashboard safe-test control.
- [x] Existing Drive QA folder and project root confirmed through connected
  Google Drive connector (not equivalent to Render OAuth).
- [ ] Owner grants scoped Google OAuth to a compatible dedicated client.
- [ ] Owner-configured Render server credentials (no secrets in this repo).
- [ ] Successful real `/api/storage/preflight` for the permitted QA folder.
- [ ] Explicit owner-triggered safe `/api/storage/smoke` returning file ID,
  matching SHA-256, byte count and readback receipt.
- [ ] Review permissions, retention, costs/quotas, and storage structure.
- [ ] Unblock media production only after full source/license/quality review.

This is not a claim that Drive production storage is connected already.
