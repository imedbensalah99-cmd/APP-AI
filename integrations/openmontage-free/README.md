# OMDA × OpenMontage — $0 Integration Sandbox

**Status: source guard built; not deployed or production-validated.**
Source: https://github.com/calesthio/OpenMontage
Pinned upstream commit: 195eab24478dc9363326aec437aefc3701635ddf
OpenMontage license: AGPLv3 (original LICENSE remains present in checkout).

This folder contains an installer for a complete pinned OpenMontage source
checkout and a restrictive OMDA policy patch. It does not replace the running
OMDA Cloudflare Worker or Render service.

## Install in a disposable cloud environment (not on the user's PC)

1. Provision a permitted temporary test environment with Git and Python 3.12.
2. Run: python integrations/openmontage-free/install.py --destination /tmp/omda-openmontage
3. The script clones the complete upstream source at the exact pinned commit.
4. It verifies AGPLv3 and patches BaseTool and the tool registry with the
   hard free-only guard. The installer refuses to overwrite existing paths.
5. Run: python -m unittest discover -s integrations/openmontage-free/tests -v
6. Check: python -m compileall -q /tmp/omda-openmontage/tools
7. Never put paid API keys into .env, container environment or GitHub.

To inspect the policy: see POLICY.md and omda_free_guard.py.

## Free production route

Research / fact verification: source material checked manually or with
non-billable workflows. Source footage from Archive.org, NASA, Wikimedia
Commons, and optionally free-key Pexels/Pixabay/Unsplash. Resolve exact place
identification and rights per clip; never guess locations from filenames.

Narration: Piper offline Arabic voice, quality and licensing checked.
Music: owner-provided or openly licensed tracks, rights recorded; automatic
ducking with FFmpeg. Visual editing: FFmpeg + Remotion / HyperFrames as
available with CPU-only resources. Quality checks: ffprobe, loudness,
black-frame detection, duration, captions, and approval before publishing.

Paid generator parity: unavailable. Stock-footage documentary structure can
be preserved; premium synthetic cinematic footage cannot be guaranteed equal.

## Existing OMDA cloud resources (preserved)

- Existing Cloudflare studio and staging Workers remain untouched.
- Existing Render free staging runner remains untouched.
- Drive production root: https://drive.google.com/drive/folders/11GaLY8grDizEbpsHBxwieOobg5KDRvZ2
- Germany pilot folder: https://drive.google.com/drive/folders/1kd4mvwJNxSYma3nuds9IsJU2sgQw9E5N
- Render-to-Drive OAuth/file upload still needs implementation and test.

## Testing and next gates

The branch CI checks guard logic, clones and patches pinned upstream
source, compiles the patched tools, and verifies paid/publish tool exclusion.
It does NOT generate a video, upload to Drive, spend credits or publish.
A separate authenticated cloud runner with sufficient resources is required
for full production validation. Read POLICY.md before activating anything.
