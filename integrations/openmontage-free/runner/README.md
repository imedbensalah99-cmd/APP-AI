# OMDA Documentary Runner — staged implementation, not deployed

**Objective:** A no-spend cloud path for original travel documentaries, with owner-controlled publishing. This component is not a substitute for original footage, fact checking, or a quality-approved Arabic narrator.

## Architecture and strict state boundaries

```text
Owner-only Cloudflare Dashboard (TODO: authenticated real job wiring)
  -> Cloudflare D1 (TODO: durable queue and receipts)
    -> Private Render Documentary API (THIS FOLDER; NOT DEPLOYED)
      -> Google Drive OAuth (NOT CONFIGURED ON RENDER)
      -> licensed footage + verified metadata -> FFmpeg 16:9
      -> supplied narration WAV or explicitly approved local Piper model
      -> upload video + review manifest back to Google Drive
    -> QC / Owner review (TODO: complete live UI)
    -> YouTube (DISABLED; never publish automatically)
```

### Security and cost

- Only `provider_policy=FREE_ONLY` and `publish_intent=false` accepted; no Gemini, Flow, OpenAI paid API, Veo, YouTube publishing endpoint or social-media OAuth call.
- Every API request except `/health` requires bearer `OMDA_DOC_RUNNER_TOKEN` with minimum 32 characters. Never put this secret in client-side JavaScript or GitHub.
- Google Drive OAuth must be completed explicitly by the owner. Store `OMDA_DRIVE_CLIENT_ID`, `OMDA_DRIVE_CLIENT_SECRET` and `OMDA_DRIVE_REFRESH_TOKEN` **only** as Render secret environment values. User authorization is not inherited from the ChatGPT Drive connector. Use the minimum appropriate Drive scope; pre-existing folders may need deliberate authorization and cannot be assumed accessible under `drive.file`.
- No Google Drive deletes, external media URL downloads or publication in this runner. Asset references are checked by folder, MIME, SHA-256 and Drive MD5.
- Uses Render's temporary filesystem and an in-memory queue for staging. Restarts erase job state. Do not use for continuous 30-minute daily production without a durable queue and performance testing.
- This code cannot guarantee $0 for cloud hosting beyond existing free-tier allowances. Billing and quotas must be verified before any deployment; never upgrade automatically.

### API

Public no-secret status: `GET /health`.
Authenticated: `POST /v1/documentaries` and `GET /v1/documentaries/{job_id}`.

Example **shape only** — IDs and hashes below are placeholders and will be rejected if wrong:

```json
{
  "job_id": "germanypilot01",
  "idempotency_key": "germanypilot-20261029",
  "folder_id": "DRIVE_FOLDER_ID",
  "country": "Germany",
  "title": "Germany: Alps and Lakes",
  "language": "ar",
  "duration_seconds": 120,
  "provider_policy": "FREE_ONLY",
  "publish_intent": false,
  "narration": {"drive_file_id": "VOICE_FILE_ID", "drive_sha256": "REPLACE_WITH_REAL_64_HEX"},
  "scenes": [
    {
      "drive_file_id": "VIDEO_FILE_ID", "drive_sha256": "REPLACE_WITH_REAL_64_HEX",
      "duration_seconds": 60,
      "place_name": "Zugspitze, Germany",
      "source_url": "https://example.com/source",
      "license": "CC-BY-4.0",
      "license_evidence_url": "https://example.com/license",
      "location_verification_url": "https://example.com/landmark-evidence",
      "narration_text": "نص موثق يطابق اللقطات"
    }
  ]
}
```

In real jobs provide **2 to 24 scenes** with durations totaling the requested runtime; every scene must have an independently valid file, known license, proof of location and narration text. Example endpoints are placeholders, never a rights verification. Extra attributes are never license evidence by themselves. Before public publication, review all footage rights and factual claims.

### Testing on GitHub (safe, no cloud mutations)

```bash
python -m pip install -r integrations/openmontage-free/runner/requirements.txt
python -m unittest discover -s integrations/openmontage-free/tests -v
```

CI runs a tiny H264/AAC scene compositor smoke test at low resolution with synthetic local fixtures; it does **not** render Germany, call Drive, generate media with Gemini or publish.

### Render deployment configuration (not yet applied)

If and only if free capacity, privacy and secrets have been verified: Docker build context `.`, Dockerfile path `integrations/openmontage-free/runner/Dockerfile`, branch `omda-openmontage-free-v1`, startup via image CMD, `autoDeploy=no`, Free plan only. Set the server-only token and Drive secrets through authorized secret controls. Do not expose the API publicly without Cloudflare Access and a backend-only bridge. Install or mount an approved Arabic Piper voice only after reviewing its license. Run health, auth, malformed payload, 2-second mock (no expense) and authorized Drive round-trip **before** attempting the 120-second Germany pilot.

### Acceptance gates still open

1. CI passes all API, Drive mock and compositor tests; Docker image actually builds and starts.
2. Cloudflare identity and durable D1 queue wired to the new runner without secrets in browser.
3. Owner-consented Google Drive token configured in Render, upload/readback tested using non-sensitive original fixture.
4. Professionally acceptable male Arabic narration provider, verified license and pronunciation, tested against script and video.
5. Copyright/legal review, source and location evidence for real Germany footage.
6. Run real Germany 120s 1080p, inspect logs/performance, quality, captions and Drive assets.
7. Owner reviews exact MP4 checksum; YouTube integration remains disabled until separately approved.

No step is considered complete without an actual test receipt.
