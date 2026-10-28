# OMDA × OpenMontage — Free-only policy (29 Oct 2026)

Upstream: https://github.com/calesthio/OpenMontage
Pinned source commit: 195eab24478dc9363326aec437aefc3701635ddf
Upstream license: GNU AGPLv3. Preserve its copyright and source obligations.

## Hard restrictions
- No paid video, image, speech or music APIs; no Google Flow/Veo credits.
- No direct YouTube publishing from this sandbox.
- No GPU-rental services and no paid infrastructure provisioning.
- The patched BaseTool execution wrapper blocks API tools by default.
- Only explicit stock APIs (Pexels, Pixabay, Unsplash) are allowlisted;
  their free quotas and each asset's license still need review.
- Registry excludes blocked provider tools, including ones with billing keys.
- No Google API credentials, service account JSON, Cloudflare secrets,
  private browser sessions or Youtube tokens may be committed to GitHub.
- Rendering requires owner review and publishing remains approval-gated.

## Actual scope
This is a pinned-source installer and reviewed policy layer. It does not
magically replace the visual quality of paid generative video tools. For real
documentaries, the equivalent production STAGES use stock/open footage,
Piper offline Arabic TTS and FFmpeg/Remotion editing. Premium AI-generated
motion cannot be promised at matching fidelity or speed for zero spend.

Render free-tier runtime, RAM, storage and idle suspension can obstruct large
renders. Google Drive hierarchy has been created separately; unattended
server-to-Drive uploads are NOT connected until an authorized backend OAuth
flow and readback checks are implemented. No complete Germany documentary
has been produced or uploaded.

## Validation requirements before deployment
1. Run unit tests and pin/verify the upstream commit.
2. Verify patch anchors and prevent all paid/publish tools at execution.
3. Review dependency/package supply chain and AGPL obligations.
4. Inspect footage source licenses and availability.
5. Test tiny no-spend offline render with original or permitted assets.
6. Connect cloud-to-Drive with server-side credentials, verify uploaded bytes.
7. Test 120-second scene-based footage documentary in staging.
8. Owner reviews output before enabling any publishing integration.
