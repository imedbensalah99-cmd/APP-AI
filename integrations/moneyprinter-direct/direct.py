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
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen
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
SOURCE_LOCK = threading.RLock()
SOURCE_CHECKS: dict[str, dict] = {}
SOURCE_TTL = 24 * 60 * 60  # Respect Pixabay 24h search-results caching policy.
# No paid providers or general-purpose outbound URLs accepted.
STOCK_SOURCES = {
    "pexels": {"rank": 2, "key_env": "PEXELS_API_KEY",
               "provider_api": "https://api.pexels.com/v1/videos/search",
               "commercial_use": True,
               "attribution": "Show Pexels in OMDA and credit creators when possible",
               "docs": "https://www.pexels.com/api/documentation/"},
    "pixabay": {"rank": 1, "key_env": "PIXABAY_API_KEY",
               "provider_api": "https://pixabay.com/api/videos/",
               "commercial_use": True,
               "attribution": "Display Pixabay source for search results and retain creator info",
               "docs": "https://pixabay.com/api/docs/"},
    "coverr": {"rank": 3, "key_env": "COVERR_API_KEY",
               "provider_api": "https://api.coverr.co/videos",
               "commercial_use": True,
               "attribution": "Clickable Coverr logo required for API usage",
               "docs": "https://api.coverr.co/docs/start/"}
}
app = FastAPI(title="OMDA — native MoneyPrinterTurbo on Render",
              docs_url=None, redoc_url=None, openapi_url=None)


class VideoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=5, max_length=100)
    script: str = Field(min_length=100, max_length=2200)
    terms: list[str] = Field(min_length=3, max_length=15)
    idempotency_key: str = Field(min_length=12, max_length=100)
    video_source: Literal["pexels", "pixabay", "coverr"] = "pixabay"
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
    return os.getenv(STOCK_SOURCES[provider]["key_env"], "").strip()


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
    section["coverr_api_keys"] = [source_key("coverr")] if source_key("coverr") else []
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
            "free_stock": {p: bool(source_key(p)) for p in STOCK_SOURCES},
            "target_seconds": 60, "publishing_enabled": False,
            "drive_connected": False, "durable_storage": False}


@app.get("/v1/sources")
def available_sources():
    """Public, safe metadata. A configured key is NOT a verified source."""
    with SOURCE_LOCK:
        checks = dict(SOURCE_CHECKS)
    return {"provider_order": ["pixabay", "pexels", "coverr"],
            "sources": [{
                "provider": name, "rank": item["rank"],
                "configured": bool(source_key(name)),
                "verified": bool(checks.get(name, {}).get("ok") and
                                 checks[name].get("key_fingerprint") == hashlib.sha256(source_key(name).encode()).hexdigest() and time.time() - checks[name]["time"] < SOURCE_TTL),
                "license": "commercial_allowed_with_conditions",
                "attribution": item["attribution"],
                "docs": item["docs"],
                "render_generation_eligible": bool(source_key(name)) and
                    bool(checks.get(name, {}).get("ok") and
                         checks[name].get("key_fingerprint") == hashlib.sha256(source_key(name).encode()).hexdigest() and time.time() - checks[name]["time"] < SOURCE_TTL)
                    and (name != "coverr" or
                         (os.getenv("OMDA_COVERR_ATTRIBUTION_READY") == "1" and
                          os.getenv("OMDA_COVERR_MPT_COMPAT_VERIFIED") == "1"))
            } for name, item in STOCK_SOURCES.items()],
            "other_sources": {"nasa": "topic_specific_license_review_required",
                              "wikimedia_commons": "per_asset_licensing_and_rate_limit_review",
                              "mixkit": "no_public_api_verified_do_not_scrape"},
            "storage": "render_temp_only",
            "publishing": False}


def _probe_provider(provider: str) -> str:
    """Single metadata-only key check: no paid endpoint, download, or scraping."""
    key = source_key(provider)
    if not key:
        return "KEY_UNCONFIGURED"
    if provider == "pexels":
        target = STOCK_SOURCES[provider]["provider_api"] + "?query=nature&per_page=3"
        headers = {"Authorization": key, "User-Agent": "OMDA-Private-MPT-Preflight/1"}
        envelope = "videos"
    elif provider == "pixabay":
        target = STOCK_SOURCES[provider]["provider_api"] + "?" + urlencode(
            {"key": key, "q": "nature", "per_page": 3})
        headers = {"User-Agent": "OMDA-Private-MPT-Preflight/1"}
        envelope = "hits"
    else:
        target = STOCK_SOURCES[provider]["provider_api"] + "?query=nature&page_size=3"
        headers = {"x-api-key": key, "User-Agent": "OMDA-Private-MPT-Preflight/1"}
        envelope = "hits"
    try:
        with urlopen(UrlRequest(target, headers=headers), timeout=15) as response:
            if response.status != 200:
                return "UPSTREAM_UNAVAILABLE"
            # At most 1 MiB response, avoid unexpected memory pressure.
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                return "RESPONSE_TOO_LARGE"
            data = json.loads(raw)
            if not isinstance(data, dict) or not isinstance(data.get(envelope), list):
                return "API_SCHEMA_MISMATCH"
            return "API_AUTH_OK"
    except HTTPError as e:
        if e.code in (401, 403):
            return "API_AUTH_REJECTED"
        if e.code == 429:
            return "API_RATE_LIMITED"
        return "UPSTREAM_UNAVAILABLE"
    except (URLError, OSError, ValueError, TimeoutError):
        return "UPSTREAM_UNAVAILABLE"


@app.post("/v1/sources/{provider}/verify")
def verify_stock_provider(provider: str, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    if provider not in STOCK_SOURCES:
        raise HTTPException(404, detail="PROVIDER_NOT_SUPPORTED")
    # Pixabay API asks for 24h caching; no repeated query from this endpoint.
    with SOURCE_LOCK:
        cached = SOURCE_CHECKS.get(provider)
        if cached and cached.get("key_fingerprint") == hashlib.sha256(source_key(provider).encode()).hexdigest() and time.time() - cached["time"] < SOURCE_TTL:
            return {"provider": provider, "state": cached["state"],
                    "cached": True, "ready_for_generation": bool(cached["ok"])}
        # Reserve the query before the network call to avoid bursts.
        SOURCE_CHECKS[provider] = {"state": "CHECK_IN_PROGRESS",
                                   "ok": False, "time": time.time(),
                                   "key_fingerprint": hashlib.sha256(source_key(provider).encode()).hexdigest()}
    result = _probe_provider(provider)
    ok = result == "API_AUTH_OK"
    with SOURCE_LOCK:
        SOURCE_CHECKS[provider] = {"state": result, "ok": ok, "time": time.time(),
                                   "key_fingerprint": hashlib.sha256(source_key(provider).encode()).hexdigest()}
    return {"provider": provider, "state": result, "cached": False,
            "ready_for_generation": ok and
                (provider != "coverr" or
                 (os.getenv("OMDA_COVERR_ATTRIBUTION_READY") == "1" and
                  os.getenv("OMDA_COVERR_MPT_COMPAT_VERIFIED") == "1"))}


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
    if body.video_source == "coverr" and (
            os.getenv("OMDA_COVERR_ATTRIBUTION_READY") != "1"
            or os.getenv("OMDA_COVERR_MPT_COMPAT_VERIFIED") != "1"):
        # MPT's Coverr client currently uses Bearer auth; Coverr's new public
        # example uses x-api-key. Do not dispatch a real video until both the
        # native MPT client and clickable attribution are manually verified.
        raise HTTPException(503, detail="COVERR_INTEGRATION_PENDING")
    with SOURCE_LOCK:
        checked = SOURCE_CHECKS.get(body.video_source)
        verified = bool(checked and checked.get("key_fingerprint") == hashlib.sha256(source_key(body.video_source).encode()).hexdigest() and checked.get("ok") and
                        time.time() - checked["time"] < SOURCE_TTL)
    if not verified:
        raise HTTPException(503, detail="FREE_STOCK_API_PREFLIGHT_REQUIRED")
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


@app.get("/v1/staging-review/{access_code}/video.mp4")
def staging_review(access_code: str):
    """Unlisted 24-hour owner test link. No directory listing or publication."""
    import time as _time
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,80}", access_code):
        raise HTTPException(404, detail="REVIEW_NOT_FOUND")
    folder = JOBS_ROOT / "trial03"
    marker = folder / "review.token"
    video = folder / "review.mp4"
    try:
        if _time.time() - marker.stat().st_mtime > 86400:
            raise HTTPException(410, detail="REVIEW_EXPIRED")
        recorded = marker.read_text(encoding="utf-8")
        if not hmac.compare_digest(recorded, access_code):
            raise HTTPException(404, detail="REVIEW_NOT_FOUND")
        if not video.is_file() or video.is_symlink():
            raise HTTPException(404, detail="REVIEW_NOT_READY")
    except FileNotFoundError:
        raise HTTPException(404, detail="REVIEW_NOT_READY") from None
    return FileResponse(video, filename="omda-arabic-documentary-trial.mp4",
                        media_type="video/mp4", content_disposition_type="inline",
                        headers={"Cache-Control":"private, no-store, max-age=0",
                                 "X-Content-Type-Options":"nosniff"})
