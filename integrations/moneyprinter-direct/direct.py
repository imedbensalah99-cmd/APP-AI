"""OMDA direct Render-hosted MoneyPrinterTurbo runner (staging, zero spend).

MoneyPrinterTurbo CLI runs INSIDE this very container. No upstream bridge exists.
The only accepted sources are free Pexels/Pixabay stock with explicitly
configured keys; no LLM, paid generations, uploads or public media routes.
Temporary Render data is NOT deleted until future authenticated Drive
round-trip integrity verification has been implemented.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Literal

import toml
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

ENGINE = Path("/opt/MoneyPrinterTurbo")
HOME = Path(os.getenv("MPT_HOME", "/tmp/omda-mpt-direct")).resolve()
JOBS_ROOT = HOME / "omda-jobs"
LOCK = threading.RLock()
JOBS: dict[str, dict] = {}
KEYS: dict[str, str] = {}
BUSY = False
MAX_BODY = 8192
app = FastAPI(title="OMDA — native MoneyPrinterTurbo on Render",
              docs_url=None, redoc_url=None, openapi_url=None)


class VideoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=5, max_length=100)
    script: str = Field(min_length=100, max_length=2200)
    terms: list[str] = Field(min_length=3, max_length=15)
    idempotency_key: str = Field(min_length=12, max_length=100)
    video_source: Literal["pexels", "pixabay"] = "pexels"
    duration_seconds: Literal[60] = 60
    language: Literal["ar"] = "ar"
    provider_policy: Literal["FREE_ONLY"] = "FREE_ONLY"
    publish_intent: Literal[False] = False


def require_auth(value: str | None) -> None:
    secret = os.getenv("OMDA_MPT_DIRECT_TOKEN", "")
    if len(secret) < 32:
        raise HTTPException(503, detail="DIRECT_AUTH_UNCONFIGURED")
    if not value or not hmac.compare_digest(value, "Bearer " + secret):
        raise HTTPException(401, detail="UNAUTHORIZED")


def source_key(provider: str) -> str:
    return os.getenv({"pexels": "PEXELS_API_KEY",
                      "pixabay": "PIXABAY_API_KEY"}[provider], "").strip()


def validate_request(body: VideoRequest) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]{12,100}", body.idempotency_key):
        raise HTTPException(400, detail="INVALID_IDEMPOTENCY_KEY")
    # Stock providers' search indexes use English phrases.
    if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 -]{1,79}", term.strip())
           for term in body.terms):
        raise HTTPException(400, detail="ENGLISH_STOCK_TERMS_REQUIRED")


def configure_engine(provider: str) -> None:
    """Configure genuine MPT, keeping credentials out of Git and output logs."""
    template = ENGINE / "config.example.toml"
    if not template.is_file():
        raise RuntimeError("MPT_ENGINE_MISSING")
    HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    cfg = toml.load(str(template))
    section = cfg["app"]
    section["video_source"] = provider
    section["pexels_api_keys"] = [source_key("pexels")] if source_key("pexels") else []
    section["pixabay_api_keys"] = [source_key("pixabay")] if source_key("pixabay") else []
    # Explicitly disable all external video generation and cross-posting.
    section["upload_post_enabled"] = False
    section["upload_post_auto_upload"] = False
    section["upload_post_api_key"] = ""
    section["upload_post_platforms"] = []
    section["api_key"] = ""
    cfg["diagnostics"]["log_requests"] = False
    config_path = HOME / "config.toml"
    with config_path.open("w", encoding="utf-8") as f:
        os.chmod(config_path, 0o600)
        toml.dump(cfg, f)


def manifest(body: VideoRequest) -> list[dict]:
    return [{
        "video_subject": body.title,
        "video_script": body.script,
        "video_terms": [t.strip() for t in body.terms],
        "video_source": body.video_source,
        "video_aspect": "9:16",
        "video_count": 1,
        "video_clip_duration": 5,
        "video_fit_mode": "cover",
        "video_concat_mode": "sequential",
        "n_threads": 1,
        "voice_name": "ar-SA-HamedNeural-Male",
        "voice_rate": 1.0,
        "video_language": "ar",
        "subtitle_enabled": True,
        "bgm_type": "",
        "bgm_volume": 0,
        "match_materials_to_script": True
    }]


def probe(path: Path) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height",
         "-of", "json", str(path)],
        capture_output=True, check=True, text=True, timeout=20)
    return json.loads(result.stdout)


def inspect_output(raw: Path, dest: Path) -> dict:
    """Accept only narrated, genuine MPT video from private MPT task storage."""
    raw = raw.resolve()
    tasks_root = (HOME / "storage" / "tasks").resolve()
    if not raw.is_relative_to(tasks_root) or not raw.is_file() or raw.suffix != ".mp4":
        raise ValueError("MPT_UNTRUSTED_OUTPUT")
    info = probe(raw)
    if not 45 <= float(info["format"]["duration"]) <= 90:
        raise ValueError("MPT_DURATION_INVALID")
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise ValueError("MPT_NARRATION_MISSING")
    # Length is normalized to 60s without replacing the narrated audio.
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
         "-i", str(raw), "-map", "0:v:0", "-map", "0:a:0",
         "-vf", "tpad=stop_mode=clone:stop_duration=15,scale=1080:1920,fps=24",
         "-af", "apad,atrim=duration=60", "-t", "60",
         "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
         "-crf", "27", "-threads", "1", "-c:a", "aac", "-b:a", "96k",
         "-movflags", "+faststart", str(dest)],
        check=True, timeout=360)
    info = probe(dest)
    seconds = float(info["format"]["duration"])
    streams = info.get("streams", [])
    if not (59.7 <= seconds <= 60.3 and
            any(s.get("codec_type") == "video" and s.get("width") == 1080
                and s.get("height") == 1920 for s in streams) and
            any(s.get("codec_type") == "audio" for s in streams)):
        raise ValueError("OUTPUT_TECHNICAL_GATE_FAILED")
    if dest.stat().st_size < 10000 or dest.stat().st_size > 150 * 1024 * 1024:
        raise ValueError("OUTPUT_SIZE_GATE_FAILED")
    hash_state = hashlib.sha256()
    with dest.open("rb") as f:
        for data in iter(lambda: f.read(1024 * 1024), b""):
            hash_state.update(data)
    return {"duration_seconds": seconds, "resolution": "1080x1920",
            "size_bytes": dest.stat().st_size, "sha256": hash_state.hexdigest(),
            "engine": "MoneyPrinterTurbo CLI (local Render container)",
            "published": False, "drive_uploaded": False}


def execute(job_id: str, body: VideoRequest) -> None:
    global BUSY
    directory = JOBS_ROOT / job_id
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        configure_engine(body.video_source)
        input_file = directory / "request.json"
        input_file.write_text(json.dumps(manifest(body), ensure_ascii=False),
                              encoding="utf-8")
        os.chmod(input_file, 0o600)
        with LOCK:
            JOBS[job_id]["state"] = "RENDERING"
        with (directory / "mpt_stdout.json").open("w", encoding="utf-8") as out, (
                directory / "mpt_stderr.log").open("w", encoding="utf-8") as err:
            result = subprocess.run(
                [sys.executable, str(ENGINE / "cli.py"),
                 "--batch-file", str(input_file), "--stop-at", "video"],
                cwd=str(ENGINE), env={**os.environ, "MPT_HOME": str(HOME)},
                stdout=out, stderr=err, timeout=1200, check=False)
        if result.returncode:
            raise RuntimeError("MPT_EXECUTION_FAILED")
        data = json.loads((directory / "mpt_stdout.json").read_text(encoding="utf-8"))
        if data.get("failed") != 0 or data.get("succeeded") != 1:
            raise RuntimeError("MPT_RENDER_NOT_SUCCESSFUL")
        completed = data.get("tasks") or []
        if len(completed) != 1 or completed[0].get("status") != "succeeded":
            raise RuntimeError("MPT_RESULT_INVALID")
        outputs = (completed[0].get("result") or {}).get("videos") or []
        if not isinstance(outputs, list) or not outputs:
            raise RuntimeError("MPT_NARRATED_VIDEO_NOT_FOUND")
        output = directory / "review.mp4"
        report = inspect_output(Path(outputs[0]), output)
        with LOCK:
            JOBS[job_id].update(state="READY_FOR_STORAGE", result=report)
    except (Exception) as exc:
        # Hide scripts, credentials, filesystem paths and subprocess stderr.
        err = type(exc).__name__
        if isinstance(exc, RuntimeError):
            err = str(exc)[:64]
        with LOCK:
            JOBS[job_id].update(state="FAILED", error=err)
    finally:
        with LOCK:
            BUSY = False


@app.get("/health")
def health():
    return {"status": "AVAILABLE",
            "mode": "DIRECT_MONEYPRINTERTURBO_ON_RENDER",
            "engine_installed": (ENGINE / "cli.py").is_file(),
            "version_pin": "27843a994bfa29c43c02150861d51490a6ca4bd2",
            "generation_enabled": os.getenv("OMDA_MPT_ENABLE_JOBS") == "1",
            "free_stock": {"pexels": bool(source_key("pexels")),
                           "pixabay": bool(source_key("pixabay"))},
            "target_seconds": 60, "publishing_enabled": False,
            "drive_connected": False, "durable_storage": False}


@app.post("/v1/jobs", status_code=202)
async def create_job(request: Request, authorization: str | None = Header(default=None)):
    global BUSY
    require_auth(authorization)
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, detail="PAYLOAD_TOO_LARGE")
    try:
        body = VideoRequest.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(422, detail="INVALID_REQUEST") from None
    validate_request(body)
    if os.getenv("OMDA_MPT_ENABLE_JOBS") != "1":
        raise HTTPException(503, detail="GENERATION_DISABLED")
    if not source_key(body.video_source):
        raise HTTPException(503, detail="FREE_STOCK_KEY_UNCONFIGURED")
    fingerprint = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    with LOCK:
        existing = KEYS.get(body.idempotency_key)
        if existing:
            job = JOBS[existing]
            if job["fingerprint"] != fingerprint:
                raise HTTPException(409, detail="IDEMPOTENCY_CONFLICT")
            return {"job_id": existing, "state": job["state"]}
        if BUSY or len(JOBS) >= 2:
            raise HTTPException(429, detail="RENDER_CAPACITY_FULL")
        job_id = uuid.uuid4().hex
        JOBS[job_id] = {"state": "QUEUED", "fingerprint": fingerprint}
        KEYS[body.idempotency_key] = job_id
        BUSY = True
    try:
        threading.Thread(target=execute, args=(job_id, body),
                         daemon=True, name="omda-mpt-render").start()
    except Exception:
        with LOCK:
            BUSY = False
            JOBS.pop(job_id, None)
            KEYS.pop(body.idempotency_key, None)
        raise HTTPException(503, detail="RENDER_THREAD_FAILED") from None
    return {"job_id": job_id, "state": "QUEUED", "published": False}


@app.get("/v1/jobs/{job_id}")
def job_status(job_id: str, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, detail="JOB_NOT_FOUND")
    with LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise HTTPException(404, detail="JOB_NOT_FOUND")
        return {"job_id": job_id, "state": job["state"],
                "result": job.get("result"), "error": job.get("error"),
                "published": False}


@app.get("/v1/jobs/{job_id}/review.mp4")
def download(job_id: str, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, detail="JOB_NOT_FOUND")
    with LOCK:
        item = JOBS.get(job_id)
        if not item or item["state"] != "READY_FOR_STORAGE":
            raise HTTPException(404, detail="VIDEO_NOT_READY")
    path = JOBS_ROOT / job_id / "review.mp4"
    if not path.is_file():
        raise HTTPException(410, detail="EPHEMERAL_VIDEO_EXPIRED")
    return FileResponse(path, filename="omda-60-review.mp4",
                        media_type="video/mp4", headers={"Cache-Control": "no-store"})
