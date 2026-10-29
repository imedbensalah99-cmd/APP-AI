"""OMDA Documentary Cloud Runner. Private, free-only, and approval-gated.

A real Drive -> FFmpeg -> Drive worker. Requires approved server-side Google
OAuth; missing credentials fail closed. No paid APIs, browser credentials,
social publishing, public file links or fake AI/video quality claims.
Staging state is volatile: production needs durable Cloudflare D1 queue.
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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT / "storage"))
sys.path.insert(0,str(ROOT / "renderer"))
from drive_storage import StorageBlocked, download_verified, upload_verified, KINDS
from documentary_render import DocumentaryBlocked, compose, ALLOWED_LICENSES, safe_id, https_url

app = FastAPI(title="OMDA Documentary Runner — Private Staging",
              docs_url=None, redoc_url=None, openapi_url=None)
WORK_ROOT = Path(os.getenv("OMDA_DOC_WORK_ROOT","/tmp/omda-documentaries")).resolve()
WORK_ROOT.mkdir(parents=True, exist_ok=True)
LIMIT_JOBS = 8
LOCK = threading.RLock()
JOBS: dict[str,dict] = {}
KEYS: dict[str,str] = {}
POOL = ThreadPoolExecutor(max_workers=1,thread_name_prefix="documentary")

_JWK_CLIENT = None
_JWK_ISSUER = None

def _cloudflare_jwk_client(issuer: str):
    """Fetch public Cloudflare Access signing keys with bounded cache/timeout."""
    global _JWK_CLIENT, _JWK_ISSUER
    from jwt import PyJWKClient
    if _JWK_CLIENT is None or _JWK_ISSUER != issuer:
        _JWK_CLIENT = PyJWKClient(issuer + "/cdn-cgi/access/certs",
                                  cache_jwk_set=True, lifespan=300, timeout=5)
        _JWK_ISSUER = issuer
    return _JWK_CLIENT

def ensure_auth(header: str | None):
    """Authenticate private backend with either legacy secret or signed Access JWT.

    The Access path needs no shared secret. The signature, issuer, exact app
    audience, expiry and owner email are verified on Render independently.
    """
    from jwt import decode as jwt_decode, InvalidTokenError
    secret = os.getenv("OMDA_DOC_RUNNER_TOKEN", "")
    if not header or not header.startswith("Bearer "):
        raise HTTPException(401, detail="UNAUTHORIZED")
    credential = header[7:]
    if len(secret) >= 32 and hmac.compare_digest(credential, secret):
        return "LEGACY_SHARED_SECRET"
    issuer = os.getenv("OMDA_ACCESS_ISS", "").rstrip("/")
    audience = os.getenv("OMDA_ACCESS_AUD", "")
    owner = os.getenv("OMDA_OWNER_EMAIL", "").strip().lower()
    if (not issuer.startswith("https://") or
        not issuer.endswith(".cloudflareaccess.com") or
        not re.fullmatch(r"[a-f0-9]{64}", audience) or
        not owner or len(credential) > 8192 or credential.count(".") != 2):
        raise HTTPException(401, detail="UNAUTHORIZED")
    try:
        jwk = _cloudflare_jwk_client(issuer).get_signing_key_from_jwt(credential)
        claims = jwt_decode(
            credential, jwk.key, algorithms=["RS256"], audience=audience,
            issuer=issuer, leeway=30,
            options={"require": ["exp", "iat", "iss", "aud", "email"]})
        now = int(time.time())
        if (not isinstance(claims.get("email"), str) or
            claims["email"].strip().lower() != owner or
            not isinstance(claims.get("exp"), (float,int)) or
            claims["exp"] > now + 86400 or
            not isinstance(claims.get("iat"), (float,int)) or
            claims["iat"] > now + 60):
            raise HTTPException(401, detail="UNAUTHORIZED")
        return "CLOUDFLARE_ACCESS_JWT"
    except HTTPException:
        raise
    except Exception:
        # This includes stale keys, JWT errors and temporary network outages.
        # Never expose token or key retrieval details to callers.
        raise HTTPException(401, detail="UNAUTHORIZED") from None

@app.get("/v1/auth/check")
def auth_check(authorization: str | None = Header(default=None)):
    method = ensure_auth(authorization)
    return {"authenticated": True, "method": method,
            "publishing": False, "paid_generation": False,
            "created_job": False}

def media_ref(ref: dict) -> dict:
    if not isinstance(ref,dict):raise DocumentaryBlocked("DRIVE_ASSET_REFERENCE_MISSING")
    ident=ref.get("drive_file_id","")
    sha=ref.get("drive_sha256","")
    if not isinstance(ident,str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,150}",ident):
        raise DocumentaryBlocked("DRIVE_ASSET_ID_INVALID")
    if not isinstance(sha,str) or not re.fullmatch(r"[a-f0-9]{64}",sha):
        raise DocumentaryBlocked("DRIVE_ASSET_HASH_INVALID")
    return {"drive_file_id":ident,"drive_sha256":sha}

def validate_job(d: dict) -> dict:
    """Check the request before any Drive download or rendering."""
    if not isinstance(d,dict):raise DocumentaryBlocked("JOB_NOT_OBJECT")
    if len(json.dumps(d,ensure_ascii=False))>40000:raise DocumentaryBlocked("JOB_TOO_LARGE")
    safe_id(d.get("job_id"))
    if d.get("provider_policy")!="FREE_ONLY" or d.get("publish_intent") is not False:
        raise DocumentaryBlocked("PAID_OR_PUBLISH_DENIED")
    if not isinstance(d.get("folder_id"),str) or not re.fullmatch(r"[A-Za-z0-9_-]{10,150}",d["folder_id"]):
        raise DocumentaryBlocked("FOLDER_ID_INVALID")
    if d.get("language")!="ar":raise DocumentaryBlocked("ARABIC_NARRATION_REQUIRED")
    duration=d.get("duration_seconds")
    if type(duration) not in (float,int) or not 2<=duration<=120:
        raise DocumentaryBlocked("PILOT_DURATION_INVALID")
    if not isinstance(d.get("title"),str) or not 3<=len(d["title"].strip())<=120:
        raise DocumentaryBlocked("TITLE_INVALID")
    if not isinstance(d.get("country"),str) or not 2<=len(d["country"].strip())<=80:
        raise DocumentaryBlocked("COUNTRY_INVALID")
    scenes=d.get("scenes")
    if not isinstance(scenes,list) or not 2<=len(scenes)<=24:
        raise DocumentaryBlocked("SCENE_COUNT_INVALID")
    total=0.0
    for s in scenes:
        if not isinstance(s,dict):raise DocumentaryBlocked("SCENE_INVALID")
        media_ref(s)
        span=s.get("duration_seconds")
        if type(span) not in (float,int) or not 1<=span<=60:
            raise DocumentaryBlocked("SCENE_DURATION_INVALID")
        total+=span
        if s.get("license") not in ALLOWED_LICENSES:
            raise DocumentaryBlocked("SCENE_LICENSE_MISSING")
        if not isinstance(s.get("place_name"),str) or len(s["place_name"].strip())<2:
            raise DocumentaryBlocked("PLACE_UNVERIFIED")
        if not isinstance(s.get("narration_text"),str) or not 5<=len(s["narration_text"])<=1200:
            raise DocumentaryBlocked("SCRIPT_MISSING")
        if any(not https_url(s.get(k)) for k in
               ("source_url","license_evidence_url","location_verification_url")):
            raise DocumentaryBlocked("SCENE_EVIDENCE_MISSING")
    if abs(total-duration)>.04:raise DocumentaryBlocked("SCENE_TOTAL_MISMATCH")
    if d.get("narration") is not None:media_ref(d["narration"])
    if d.get("music") is not None:
        m=d["music"]
        media_ref(m)
        if m.get("license") not in ALLOWED_LICENSES or not https_url(m.get("source_url")) or \
           not https_url(m.get("license_evidence_url")):
            raise DocumentaryBlocked("MUSIC_EVIDENCE_MISSING")
    if d.get("narration") is None and not os.getenv("OMDA_PIPER_MODEL"):
        raise DocumentaryBlocked("NARRATION_ASSET_OR_OFFLINE_VOICE_REQUIRED")
    return d

def update(job_id: str, state: str, **detail):
    with LOCK:
        if job_id not in JOBS:return
        JOBS[job_id].update({"state":state,"updated_at":int(time.time()),**detail})

def stage(ref: dict, *, kind: str, job_id: str, folder: str, assets: Path) -> str:
    data=download_verified(ref["drive_file_id"],folder_id=folder,
                           job_id=job_id,kind=kind,workspace=assets,
                           expected_sha256=ref["drive_sha256"])
    return Path(data["path"]).name

def local_piper(project: dict, assets: Path, job_id: str) -> str:
    model=os.getenv("OMDA_PIPER_MODEL","")
    if not Path(model).is_file():raise DocumentaryBlocked("APPROVED_PIPER_MODEL_NOT_CONFIGURED")
    if not shutil.which("piper"):raise DocumentaryBlocked("PIPER_BINARY_MISSING")
    target=assets / (job_id+"_narration.wav")
    text=" ".join(s["narration_text"] for s in project["scenes"])
    cmd=["piper","--model",model,"--output_file",str(target)]
    result=subprocess.run(cmd,input=text,encoding="utf-8",capture_output=True,timeout=180)
    if result.returncode or not target.is_file() or target.stat().st_size<4096:
        raise DocumentaryBlocked("PIPER_VOICE_FAILED")
    return target.name

def run_job(job_id: str, data: dict):
    try:
        update(job_id,"FETCHING_ASSETS")
        job_dir=WORK_ROOT/job_id
        job_dir.mkdir(mode=0o700,exist_ok=False)
        assets=job_dir/"assets";assets.mkdir(mode=0o700)
        dest=job_dir/"output";dest.mkdir(mode=0o700)
        folder=data["folder_id"]
        clean={k:data[k] for k in ("job_id","provider_policy","publish_intent",
                                      "country","title","language","duration_seconds")}
        clean["scenes"]=[]
        for idx,s in enumerate(data["scenes"]):
            suffix=f"{job_id}scene{idx:03d}"
            filename=stage(s,kind="video",job_id=suffix,folder=folder,assets=assets)
            row={k:s[k] for k in ("duration_seconds","place_name","source_url",
                                  "license","license_evidence_url",
                                  "location_verification_url","narration_text")}
            clean["scenes"].append({**row,"file":filename})
        if data.get("narration"):
            clean["narration_file"]=stage(data["narration"],kind="narration",
                                         job_id=job_id,folder=folder,assets=assets)
        else:
            clean["narration_file"]=local_piper(clean,assets,job_id)
        if data.get("music"):
            m=data["music"]
            clean["music"]={k:m[k] for k in ("source_url","license","license_evidence_url")}
            clean["music"]["file"]=stage(m,kind="music",job_id=job_id,
                                         folder=folder,assets=assets)
        update(job_id,"RENDERING")
        result=compose(clean,assets,dest)
        update(job_id,"ARCHIVING")
        video=upload_verified(dest/"documentary_review.mp4",folder_id=folder,
                              job_id=job_id,kind="video")
        manifest=upload_verified(dest/"review_manifest.json",folder_id=folder,
                                 job_id=job_id,kind="manifest")
        update(job_id,"READY_FOR_OWNER_REVIEW",
               result={"video_file_id":video["file_id"],
                       "manifest_file_id":manifest["file_id"],
                       "sha256":result["sha256"],"duration_seconds":result["duration_seconds"],
                       "published":False,"approved":False,"google_flow_credits_used":0})
    except (StorageBlocked,DocumentaryBlocked) as e:
        update(job_id,"BLOCKED",error_code=str(e)[:90])
    except Exception as e:
        # Deliberately never leak paths, request data, OAuth credentials or errors.
        update(job_id,"FAILED",error_code="RENDER_OR_INFRA_ERROR")

@app.get("/health")
def health():
    return {"status":"AVAILABLE" if shutil.which("ffmpeg") and shutil.which("ffprobe") else "FFMPEG_UNAVAILABLE",
            "mode":"DOCUMENTARY_STAGING","storage":"DRIVE_OAUTH_CONFIGURED" if all(os.getenv(k) for k in ("OMDA_DRIVE_CLIENT_ID","OMDA_DRIVE_CLIENT_SECRET","OMDA_DRIVE_REFRESH_TOKEN")) else "DRIVE_OAUTH_REQUIRED",
            "auth_mode":"CLOUDFLARE_ACCESS_JWT_ENABLED" if (
                os.getenv("OMDA_ACCESS_ISS","").startswith("https://") and
                re.fullmatch(r"[a-f0-9]{64}",os.getenv("OMDA_ACCESS_AUD","")) and
                bool(os.getenv("OMDA_OWNER_EMAIL",""))) else "AUTH_CONFIG_REQUIRED",
            "ephemeral_queue":True,"youtube_publishing":False,"paid_generation":False,
            "piper_model_configured":bool(os.getenv("OMDA_PIPER_MODEL") and Path(os.getenv("OMDA_PIPER_MODEL")).is_file())}

@app.post("/v1/documentaries",status_code=202)
def create_documentary(body: dict,authorization: str | None=Header(default=None)):
    ensure_auth(authorization)
    try:validate_job(body)
    except DocumentaryBlocked as e:raise HTTPException(400,detail=str(e)) from None
    job_id=body["job_id"]
    key=body.get("idempotency_key",job_id)
    if not isinstance(key,str) or not re.fullmatch(r"[A-Za-z0-9_.-]{6,128}",key):
        raise HTTPException(400,detail="IDEMPOTENCY_KEY_INVALID")
    fingerprint=hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    with LOCK:
        existing=KEYS.get(key)
        if existing:
            if JOBS[existing]["fingerprint"]!=fingerprint:
                raise HTTPException(409,detail="IDEMPOTENCY_CONFLICT")
            return {"job_id":existing,"state":JOBS[existing]["state"]}
        if job_id in JOBS:raise HTTPException(409,detail="JOB_ID_ALREADY_EXISTS")
        if len(JOBS)>=LIMIT_JOBS:raise HTTPException(429,detail="EPHEMERAL_QUEUE_LIMIT")
        JOBS[job_id]={"state":"QUEUED","fingerprint":fingerprint,
                      "created_at":int(time.time()),"updated_at":int(time.time())}
        KEYS[key]=job_id
    POOL.submit(run_job,job_id,body)
    return {"job_id":job_id,"state":"QUEUED","published":False}

@app.get("/v1/documentaries/{job_id}")
def get_documentary(job_id: str,authorization: str | None=Header(default=None)):
    ensure_auth(authorization)
    safe_id(job_id)
    with LOCK:
        x=JOBS.get(job_id)
        if not x:raise HTTPException(404,detail="JOB_NOT_FOUND")
        return {"job_id":job_id,**{k:v for k,v in x.items() if k!="fingerprint"}}
