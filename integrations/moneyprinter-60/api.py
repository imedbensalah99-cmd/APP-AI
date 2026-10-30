"""Private, no-spend, review-only gateway to genuine MoneyPrinterTurbo."""
import hashlib
import hmac
import json
import os
import re
import subprocess
import threading
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError

app = FastAPI(title="OMDA MoneyPrinter 60 — staging", docs_url=None,
              redoc_url=None, openapi_url=None)
LOCK = threading.RLock()
JOBS = {}
KEYS = {}
ROOT = Path("/tmp/omda-mpt-60")
ROOT.mkdir(mode=0o700, exist_ok=True)
LIMIT = 8

class JobRequest(BaseModel):
    title: str = Field(min_length=5, max_length=100)
    script: str = Field(min_length=100, max_length=2200)
    terms: list[str] = Field(min_length=3, max_length=15)
    idempotency_key: str = Field(min_length=12, max_length=100)
    duration_seconds: int = 60
    language: str = "ar"
    publish_intent: bool = False
    provider_policy: str = "FREE_ONLY"

def auth(authorization):
    secret = os.getenv("OMDA_MPT_BRIDGE_TOKEN", "")
    if len(secret) < 32:
        raise HTTPException(503, detail="BRIDGE_AUTH_UNCONFIGURED")
    if not authorization or not hmac.compare_digest(authorization, "Bearer " + secret):
        raise HTTPException(401, detail="UNAUTHORIZED")

def active():
    return os.getenv("OMDA_MPT_ENABLE_JOBS", "0") == "1"

def origin(url):
    p = urlsplit(url)
    return (p.scheme, p.hostname, p.port)

def upstream():
    url = os.getenv("OMDA_MPT_URL", "").rstrip("/")
    p = urlsplit(url)
    if (p.scheme != "https" or not p.hostname or p.username or p.password or
            p.query or p.fragment or p.path not in ("", "/")):
        raise HTTPException(503, detail="UPSTREAM_URL_UNCONFIGURED")
    key = os.getenv("OMDA_MPT_API_KEY", "")
    if len(key) < 32:
        raise HTTPException(503, detail="UPSTREAM_AUTH_UNCONFIGURED")
    return url, key

def make_payload(body):
    if (body.duration_seconds != 60 or body.language != "ar" or
            body.publish_intent or body.provider_policy != "FREE_ONLY"):
        raise HTTPException(400, detail="POLICY_DENIED")
    if re.fullmatch(r"[A-Za-z0-9_.-]{12,100}", body.idempotency_key) is None:
        raise HTTPException(400, detail="INPUT_INVALID")
    # Pexels indexes footage using English search phrases. Fail explicitly rather
    # than silently returning unrelated or empty visuals for Arabic-only terms.
    if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 -]{1,79}", t.strip())
           for t in body.terms):
        raise HTTPException(400, detail="ENGLISH_STOCK_TERMS_REQUIRED")
    return {
        "video_subject": body.title,
        "video_script": body.script,
        "video_terms": body.terms,
        "video_source": "pexels",
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
        "bgm_type": "none",
        "bgm_volume": 0,
        "match_materials_to_script": True,
    }

def client(key):
    return httpx.Client(headers={"x-api-key": key},
                        timeout=httpx.Timeout(20, connect=5),
                        follow_redirects=False, trust_env=False)

def mpt(method, path, payload=None):
    url, key = upstream()
    if not path.startswith("/api/v1/"):
        raise HTTPException(500, detail="UNSAFE_PATH")
    try:
        with client(key) as c:
            resp = c.request(method, url + path, json=payload)
            resp.raise_for_status()
            envelope = resp.json()
        if not isinstance(envelope, dict) or envelope.get("status") != 200:
            raise ValueError("Invalid response envelope")
        if not isinstance(envelope.get("data"), dict):
            raise ValueError("Invalid result")
        return envelope["data"]
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, detail="UPSTREAM_UNAVAILABLE") from None

def safe_file_url(file_url, base):
    if not isinstance(file_url, str) or len(file_url) > 2048:
        raise ValueError("Invalid output URL")
    url = urljoin(base + "/", file_url)
    p = urlsplit(url)
    if (origin(url) != origin(base) or
            not p.path.startswith("/tasks/") or p.fragment or p.username or p.password):
        raise ValueError("Unsafe output URL")
    return url


def verify_visual_activity(path):
    """Reject static/near-identical upper-screen frames, not semantic quality.

    At most twelve tiny 32x32 frame samples are held in memory. Cropping the top
    of the frame avoids false positives from subtitles moving near the bottom.
    This is a necessary, NOT sufficient, check for real, relevant footage.
    """
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
             "-i", str(path),
             "-vf", "fps=1/5,crop=iw:trunc(ih*0.65/2)*2:0:0,"
                    "scale=32:32,format=gray",
             "-frames:v", "12", "-f", "rawvideo", "-"],
            capture_output=True, timeout=35, check=True)
    except (OSError, subprocess.SubprocessError):
        return False
    size = 32 * 32
    frames = [proc.stdout[i:i+size]
              for i in range(0, len(proc.stdout), size)]
    if len(frames) < 9 or any(len(frame) != size for frame in frames):
        return False
    return sum(
        sum(abs(a-b) for a, b in zip(left, right)) / size >= 3.0
        for left, right in zip(frames, frames[1:])
    ) >= 3


def verify_audible_audio(path):
    """An audio track is insufficient if the narrator is silent."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostdin", "-i", str(path),
             "-vn", "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True, timeout=25, check=True)
        measured = re.search(r"max_volume:\\s*(-?\\d+(?:\\.\\d+)?) dB",
                             proc.stderr)
        return bool(measured and float(measured.group(1)) > -32.0)
    except (OSError, subprocess.SubprocessError, ValueError):
        return False

def verify_output(job_id, url):
    base, key = upstream()
    url = safe_file_url(url, base)
    temp = ROOT / (job_id + ".part")
    dest = ROOT / (job_id + ".mp4")
    try:
        with client(key) as c:
            with c.stream("GET", url) as resp:
                resp.raise_for_status()
                if resp.status_code != 200:
                    raise ValueError("Redirect forbidden")
                length = 0
                with temp.open("xb") as out:
                    for piece in resp.iter_bytes(chunk_size=1024 * 1024):
                        length += len(piece)
                        if length > 150 * 1024 * 1024:
                            raise ValueError("File too large")
                        out.write(piece)
        if length < 10000:
            raise ValueError("Empty MP4")
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=codec_type,width,height",
             "-of", "json", str(temp)],
            capture_output=True, text=True, timeout=20, check=True)
        info = json.loads(result.stdout)
        seconds = float(info["format"]["duration"])
        streams = info.get("streams", [])
        good_video = any(s.get("codec_type") == "video" and
                         s.get("width") == 1080 and s.get("height") == 1920
                         for s in streams)
        good_audio = any(s.get("codec_type") == "audio" for s in streams)
        if not (58.5 <= seconds <= 60.5 and good_video and good_audio):
            raise ValueError("Invalid duration, format or audio stream")
        if not verify_visual_activity(temp):
            raise ValueError("Static or insufficiently varied video")
        if not verify_audible_audio(temp):
            raise ValueError("Silent audio; narrator not verified")
        digest_state = hashlib.sha256()
        with temp.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest_state.update(block)
        digest = digest_state.hexdigest()
        temp.replace(dest)
        return {"duration_seconds": seconds, "sha256": digest,
                "bytes": length, "published": False, "review_only": True,
                "visual_activity_gate": "PASS", "audible_audio_gate": "PASS",
                "human_quality_review_required": True}
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, httpx.HTTPError):
        raise HTTPException(422, detail="OUTPUT_VERIFICATION_FAILED") from None
    finally:
        temp.unlink(missing_ok=True)

@app.get("/health")
def health():
    return {"status": "AVAILABLE", "mode": "MPT_BRIDGE_STAGING",
            "target_seconds": 60, "aspect": "9:16",
            "generation_enabled": active(),
            "upstream_configured": bool(os.getenv("OMDA_MPT_URL")) and
                                   bool(os.getenv("OMDA_MPT_API_KEY")),
            "publishing": False, "paid_generation": False, "durable_queue": False}

@app.get("/v1/mpt/auth/check")
def auth_check(authorization: str | None = Header(default=None)):
    auth(authorization)
    return {"authenticated": True, "publishing": False}

@app.post("/v1/mpt/jobs", status_code=202)
async def submit(request: Request, authorization: str | None = Header(default=None)):
    auth(authorization)  # Authenticate before loading or parsing an untrusted body.
    raw = await request.body()
    if len(raw) > 8192:
        raise HTTPException(413, detail="JOB_TOO_LARGE")
    try:
        body = JobRequest.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(422, detail="INVALID_JOB_BODY") from None
    payload = make_payload(body)
    if not active():
        raise HTTPException(503, detail="GENERATION_DISABLED")
    upstream()
    fingerprint = hashlib.sha256(body.model_dump_json().encode("utf-8")).hexdigest()
    with LOCK:
        prior = KEYS.get(body.idempotency_key)
        if prior:
            if JOBS[prior]["fingerprint"] != fingerprint:
                raise HTTPException(409, detail="IDEMPOTENCY_CONFLICT")
            return {"job_id": prior, "state": JOBS[prior]["state"]}
        if len(JOBS) >= LIMIT:
            raise HTTPException(429, detail="QUEUE_FULL")
        job_id = uuid.uuid4().hex
        KEYS[body.idempotency_key] = job_id
        JOBS[job_id] = {"state": "SUBMITTING", "fingerprint": fingerprint}
    try:
        output = mpt("POST", "/api/v1/videos", payload)
        task_id = output.get("task_id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{12,100}", task_id):
            raise HTTPException(502, detail="UPSTREAM_TASK_INVALID")
        with LOCK:
            JOBS[job_id].update(state="PROCESSING", upstream_id=task_id)
        return {"job_id": job_id, "state": "PROCESSING", "published": False}
    except HTTPException as error:
        with LOCK:
            JOBS[job_id].update(state="BLOCKED", error=error.detail)
        raise

@app.get("/v1/mpt/jobs/{job_id}")
def get_job(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, detail="JOB_NOT_FOUND")
    with LOCK:
        stored = JOBS.get(job_id)
        if not stored:
            raise HTTPException(404, detail="JOB_NOT_FOUND")
        state, task_id = stored["state"], stored.get("upstream_id")
    if state == "PROCESSING":
        upstream_task = mpt("GET", "/api/v1/tasks/" + task_id)
        task_state = upstream_task.get("state")
        if task_state == -1:
            with LOCK:
                JOBS[job_id]["state"] = "FAILED"
        elif task_state == 1:
            options = upstream_task.get("combined_videos") or upstream_task.get("videos") or []
            try:
                if not isinstance(options, list) or not options:
                    raise ValueError("No video")
                checked = verify_output(job_id, options[0])
                with LOCK:
                    JOBS[job_id].update(state="READY_FOR_REVIEW", result=checked)
            except (ValueError, HTTPException):
                with LOCK:
                    JOBS[job_id].update(state="BLOCKED", error="OUTPUT_VERIFICATION_FAILED")
    with LOCK:
        current = JOBS[job_id]
        return {"job_id": job_id, "state": current["state"],
                "result": current.get("result"), "error": current.get("error"),
                "published": False}

@app.get("/v1/mpt/jobs/{job_id}/review.mp4")
def review(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, detail="JOB_NOT_FOUND")
    with LOCK:
        stored = JOBS.get(job_id)
        if not stored or stored["state"] != "READY_FOR_REVIEW":
            raise HTTPException(404, detail="VIDEO_NOT_READY")
    file = ROOT / (job_id + ".mp4")
    if not file.is_file():
        raise HTTPException(410, detail="EPHEMERAL_VIDEO_EXPIRED")
    return FileResponse(file, filename="omda-review.mp4", media_type="video/mp4",
                        headers={"Cache-Control": "no-store"})
