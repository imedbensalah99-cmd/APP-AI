# OMDA Synthetic Video Renderer (no spend)

This is a real offline FFmpeg renderer, **not** a Flow/Gemini video generator or a deployed cloud service. It creates cinematic original procedural backgrounds, shaped Arabic captions, SRT, original soundscape, and an H.264/AAC 1080×1920 MP4. A `manifest.json` truthfully says whether the audio includes genuine Arabic speech.

## Test locally or in an authorized cloud runner

```bash
python -m pip install Pillow
python src/omda_render.py --story examples/sardera_elevator.json --output output
ffprobe -v error -show_streams output/OMDA_SARDERA_PROOF.mp4
```

Without an installed Arabic TTS model the default output is visibly labeled `SYNTHETIC_DEMO_NO_NARRATION`: ambience only. **Do not misrepresent it as a finished narrated video.**

## Real Arabic narration (approved MIT model)

Use a licensed local Piper Arabic ONNX voice. For example, `vadimbelsky/arabic-emirati-female-piper` is advertised on Hugging Face under MIT license (verify the current model card and dependencies before commercial publication). Download both `arabic-emirati-female-model.onnx` and matching `.onnx.json`, then:

```bash
pip install piper-tts
python src/omda_render.py --piper-model ./voice/arabic-emirati-female-model.onnx --output output
```

This mode refuses to claim voice success unless a real WAV file was generated. Model weights are **not** bundled in this code. An operator/runner must provision them. No automatic upload, credential scraping, payment, Flow generation, or publication is implemented.

## Why the cloud integration remains pending

- Free Cloudflare Workers lack the CPU time for full-HD FFmpeg rendering.
- GitHub-hosted Actions may be used for *testing* the software, but GitHub prohibits using Actions as a general production serverless video rendering service.
- A hosted runner with permission, FFmpeg, Piper, private storage and a signed OMDA bridge is necessary. A source file alone does not create such a runner.
- Production deployment, billable resource creation, Gemini/Flow credits and YouTube uploads remain explicitly approval-gated.

## Free-tier Render staging adapter (not yet deployed)

This package includes `Dockerfile`, `render.yaml`, and `src/server.py`. It hosts a **private-token** staging API that can render a synthetic/no-spend MP4 with a secure POST, poll jobs, and download the result. All file endpoints require `OMDA_RUNNER_TOKEN` (a generated secret, never put it in client JS). `require_narration` defaults to `true` and blocks until a permissively licensed Piper voice is configured. Set `false` only for a clearly labeled ambience-only demonstration.

Endpoints: `GET /health` (public, no sensitive values), `POST /v1/render`, `GET /v1/jobs/{job_id}`, `GET /v1/files/{job_id}/{video|captions|manifest}` (bearer token). No arbitrary shell execution. No external AI generation. No YouTube publishing. No durable queue or restart recovery.

Render's Free Web plan has **ephemeral storage**, can sleep after 15 minutes, and may suspend when free allowance is exhausted. It is suitable for **staging**, not reliable production. It is **not yet deployed**, and the current OMDA Cloudflare Worker is **not connected to it**. Do not expose tokens or access the runner directly from untrusted browsers; the production bridge needs separate server-side secret binding.