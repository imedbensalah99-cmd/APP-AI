"""Private, ephemeral Render-compatible OMDA render API.

Staging only: local filesystem and job state disappear when Render free instance
sleeps/restarts. No paid provider calls. Per-request bearer auth, restricted jobs.
"""
import hashlib
import hmac
import json
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from typing import Literal

from omda_render import make_video, validate_story

app=FastAPI(title='OMDA Video Runner (staging)',docs_url=None,redoc_url=None,openapi_url=None)
BASE=Path(os.getenv('OMDA_OUTPUT_DIR','/tmp/omda')).resolve()
BASE.mkdir(parents=True,exist_ok=True)
JOB_LOCK=threading.RLock()
JOBS: dict[str,dict]={}
REQUEST_KEYS: dict[str,str]={}
POOL=ThreadPoolExecutor(max_workers=1,thread_name_prefix='omda-render')
MAX_JOBS=20

class Scene(BaseModel):
    text: str=Field(min_length=1,max_length=250)

class VideoRequest(BaseModel):
    channel: Literal['SARDERA','NIMOLOO']='SARDERA'
    duration_seconds: float=Field(default=10,ge=5,le=60)
    title: str=Field(min_length=1,max_length=100)
    scenes: list[Scene]=Field(min_length=1,max_length=12)
    provider: Literal['NO_SPEND_SYNTHETIC']='NO_SPEND_SYNTHETIC'
    idempotency_key: str=Field(min_length=12,max_length=128)
    require_narration: bool=True
    @field_validator('idempotency_key')
    @classmethod
    def valid_key(cls,s):
        if not all(c.isalnum() or c in '_-.' for c in s):raise ValueError('Invalid idempotency key')
        return s


def auth(authorization: str | None):
    token=os.getenv('OMDA_RUNNER_TOKEN','')
    if len(token)<32:raise HTTPException(status_code=503,detail='Runner not securely configured')
    expect='Bearer '+token
    if not authorization or not hmac.compare_digest(authorization,expect):
        raise HTTPException(status_code=401,detail='Unauthorized')


def execute(job_id: str, request: VideoRequest):
    try:
        path=BASE/job_id
        path.mkdir(mode=0o700,exist_ok=True)
        payload=request.model_dump(exclude={'idempotency_key','require_narration','provider'})
        payload['id']=job_id
        story=path/'story.json'
        story.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
        # Production requires Arabic narration; never deliver a demo as narration.
        model=os.getenv('OMDA_PIPER_MODEL')
        model_file=Path(model) if model else None
        if request.require_narration and (not model_file or not model_file.exists()):
            raise RuntimeError('NARRATION_NOT_CONFIGURED: provide approved Piper Arabic ONNX voice and model JSON')
        result=make_video(story,path,font_arg=None,piper_model=model_file)
        with JOB_LOCK:
            JOBS[job_id]['state']='COMPLETE' if result['narration_present'] else 'DEMO_ONLY'
            JOBS[job_id]['result']={k:result[k] for k in ('status','narration_present','ai_video_generated','sha256','bytes','duration_seconds','flow_credits_used','api_cost_usd')}
            JOBS[job_id]['completed_at']=int(time.time())
    except Exception as exc:
        with JOB_LOCK:
            JOBS[job_id]['state']='BLOCKED' if str(exc).startswith('NARRATION_NOT_CONFIGURED') else 'FAILED'
            JOBS[job_id]['error_code']=str(exc).split(':')[0][:80]
            JOBS[job_id]['completed_at']=int(time.time())


@app.get('/health')
def health():
    return {'status':'RENDERER_AVAILABLE' if shutil.which('ffmpeg') and shutil.which('ffprobe') else 'BLOCKED_FFMPEG',
            'capabilities':{'synthetic_mp4':bool(shutil.which('ffmpeg')),'piper_model_ready':bool(os.getenv('OMDA_PIPER_MODEL') and Path(os.getenv('OMDA_PIPER_MODEL')).exists()),
                            'gemini_video':False,'flow_video':False,'youtube_upload':False},
            'storage':'EPHEMERAL','publishing_locked':True,'spend_enabled':False}


@app.post('/v1/render',status_code=202)
def render(request:VideoRequest, authorization: str|None=Header(default=None)):
    auth(authorization)
    body_fingerprint=hashlib.sha256(json.dumps(request.model_dump(exclude={'idempotency_key'}),sort_keys=True).encode()).hexdigest()
    with JOB_LOCK:
        existing=REQUEST_KEYS.get(request.idempotency_key)
        if existing:
            if JOBS[existing]['fingerprint']!=body_fingerprint:
                raise HTTPException(status_code=409,detail='Idempotency key reused for different request')
            return {'job_id':existing,'state':JOBS[existing]['state']}
        if len(JOBS)>=MAX_JOBS:raise HTTPException(status_code=429,detail='Staging job limit reached')
        job_id=str(uuid.uuid4());REQUEST_KEYS[request.idempotency_key]=job_id
        JOBS[job_id]={'state':'QUEUED','fingerprint':body_fingerprint,'created_at':int(time.time())}
    POOL.submit(execute,job_id,request)
    with JOB_LOCK:
        return {'job_id':job_id,'state':JOBS[job_id]['state']}


@app.get('/v1/jobs/{job_id}')
def job(job_id:str,authorization: str|None=Header(default=None)):
    auth(authorization)
    with JOB_LOCK:
        entry=JOBS.get(job_id)
        if entry is None:raise HTTPException(status_code=404,detail='Not found')
        return {'job_id':job_id,**{k:v for k,v in entry.items() if k!='fingerprint'}}


@app.get('/v1/files/{job_id}/{kind}')
def download(job_id:str,kind:Literal['video','captions','manifest'],authorization: str|None=Header(default=None)):
    auth(authorization)
    with JOB_LOCK:
        if job_id not in JOBS or JOBS[job_id]['state'] not in ('COMPLETE','DEMO_ONLY'):
            raise HTTPException(status_code=404,detail='Artifact not available')
    name={'video':'OMDA_SARDERA_PROOF.mp4','captions':'captions.srt','manifest':'manifest.json'}[kind]
    fp=BASE/job_id/name
    if not fp.is_file():raise HTTPException(status_code=410,detail='Ephemeral artifact expired')
    media={'video':'video/mp4','captions':'application/x-subrip','manifest':'application/json'}[kind]
    return FileResponse(fp,media_type=media,filename=name)