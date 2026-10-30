"""Owner-authorized, one-attempt Pixabay -> Arabic 60s staging test.
Never accepts public triggers, never touches production or publishing.
Remove the explicit trial ID after measuring the result.
"""
import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TRIAL = "omda-ar60-20261030-test03"
if os.getenv("OMDA_STAGING_EXPERIMENT_ID", "") != TRIAL:
    sys.exit(0)

import direct
from direct import ENGINE, HOME, JOBS, VideoRequest, execute, source_key

HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
marker = HOME / ("trial-" + TRIAL + ".lock")
try:
    with marker.open("x", encoding="utf-8") as f:
        f.write("ONE_ATTEMPT_ONLY\n")
except FileExistsError:
    print("OMDA_TRIAL RESULT=ALREADY_ATTEMPTED", flush=True)
    sys.exit(0)

def emit(step, value):
    # Only predefined tokens and numeric results, no API key/response URL/script.
    print("OMDA_TRIAL STEP=" + step + " VALUE=" + str(value), flush=True)

emit("START", TRIAL)
if not (ENGINE / "cli.py").is_file():
    emit("STOP", "ENGINE_MISSING")
    sys.exit(1)
key = source_key("pixabay")
if not key:
    emit("STOP", "PIXABAY_KEY_MISSING")
    sys.exit(1)

# Exactly one metadata-only request before attempting any video.
try:
    query = urlencode({"key": key, "q": "nature", "per_page": 3})
    req = Request("https://pixabay.com/api/videos/?" + query,
                  headers={"User-Agent": "OMDA-60s-Owner-Approved-Preflight/1"})
    with urlopen(req, timeout=18) as response:
        if response.status != 200:
            raise RuntimeError("PIXABAY_NON_200")
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise RuntimeError("PIXABAY_RESPONSE_TOO_LARGE")
    parsed = json.loads(raw)
    hits = parsed.get("hits") if isinstance(parsed, dict) else None
    if not isinstance(hits, list):
        raise RuntimeError("PIXABAY_SCHEMA_INVALID")
    clips = [item for item in hits if isinstance(item, dict) and
             any(isinstance(variant, dict) and variant.get("url")
                 for variant in (item.get("videos") or {}).values())]
    emit("PIXABAY_AUTH", "OK")
    emit("CLIPS_IN_SAMPLE", len(clips))
    if not clips:
        emit("STOP", "NO_USABLE_VIDEO_IN_SAMPLE")
        sys.exit(1)
except HTTPError as exc:
    emit("STOP", "PIXABAY_HTTP_" + str(exc.code))
    sys.exit(1)
except (URLError, TimeoutError, OSError):
    emit("STOP", "PIXABAY_CONNECTION_ERROR")
    sys.exit(1)
except (ValueError, RuntimeError) as exc:
    emit("STOP", str(exc))
    sys.exit(1)

# Low-memory FFmpeg compositor: MoneyPrinterTurbo still runs its genuine
# script/terms/audio/materials pipeline, never its memory-heavy MoviePy stage.
# MPT engine is kept unmodified and pinned; all source URLs remain private.
import hashlib, secrets, subprocess
from direct import configure_engine, manifest, probe, JOBS_ROOT
body = VideoRequest(
    title="رحلة قطرة ماء في الطبيعة",
    script=("تبدأ رحلة الماء من البحر الواسع. تسخن أشعة الشمس سطح المحيط، "
            "فتتبخر قطرات صغيرة وتصعد إلى السماء. هناك، يبرد بخار الماء "
            "ويتجمع في سحب بيضاء تتحرك مع الرياح. وعندما تصبح السحب ثقيلة، "
            "تهطل الأمطار على الجبال والغابات. تتسرب بعض القطرات إلى التربة، "
            "بينما تنساب أخرى في جداول صغيرة. تتحد الجداول لتصنع أنهاراً "
            "تعبر الوديان، وتمنح الأشجار والحيوانات والناس الحياة. وفي الطريق، "
            "تتشكل الشلالات، وتتجدد البحيرات، وتستمر الطبيعة في دورة دقيقة "
            "لا تتوقف. يعود الماء في النهاية إلى البحر، لتبدأ الرحلة من جديد. "
            "هذه الدورة البسيطة هي أحد أسرار استمرار الحياة على كوكب الأرض. "
            "لذلك، فإن حماية المياه من التلوث، وترشيد استخدامها، مسؤولية "
            "مشتركة بين الجميع."),
    terms=["ocean waves", "waterfall", "forest rain"],
    idempotency_key="omda-ar60-20261030-test02",
    video_source="pixabay", duration_seconds=60, language="ar",
    provider_policy="FREE_ONLY", publish_intent=False)
manifest_data = manifest(body)
manifest_data[0]["subtitle_enabled"] = False
manifest_data[0]["video_clip_duration"] = 10
manifest_data[0]["n_threads"] = 1
job_dir = JOBS_ROOT / "trial03"
job_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
configure_engine("pixabay")
batch = job_dir/"mpt-request.json"
batch.write_text(json.dumps(manifest_data,ensure_ascii=False),encoding="utf-8")
os.chmod(batch,0o600)
emit("MPT_PIPELINE","START")
start=time.monotonic()
with (job_dir/"mpt-out.json").open("w",encoding="utf-8") as stdout, (job_dir/"mpt-err.log").open("w",encoding="utf-8") as stderr:
    proc=subprocess.run([sys.executable,str(ENGINE/"cli.py"),"--batch-file",str(batch),"--stop-at","materials"],
        cwd=str(ENGINE),env={**os.environ,"MPT_HOME":str(HOME),"OMP_NUM_THREADS":"1",
        "OPENBLAS_NUM_THREADS":"1","MALLOC_ARENA_MAX":"2"},stdout=stdout,stderr=stderr,timeout=520,check=False)
emit("MPT_EXIT",proc.returncode)
if proc.returncode != 0:
    emit("STOP","MPT_MATERIALS_FAILED")
    sys.exit(2)
try:
    completed=json.loads((job_dir/"mpt-out.json").read_text(encoding="utf-8"))
    item=completed["tasks"][0]
    assert completed["succeeded"]==1 and item["status"]=="succeeded"
    videos=item["result"]["materials"]
    task_id=item["task_id"]
    assert isinstance(videos,list) and videos
    clips=[]
    for item in videos:
        p=Path(item).resolve()
        if p.is_file() and p.is_relative_to(HOME) and p.suffix.lower() in (".mp4",".mov",".webm"):
            clips.append(p)
    assert clips
    audio=HOME/"storage"/"tasks"/task_id/"audio.mp3"
    assert audio.is_file() and audio.stat().st_size>1000
    audio_seconds=float(probe(audio)["format"]["duration"])
    assert audio_seconds>10
except (Exception,AssertionError):
    emit("STOP","MPT_RESULT_INCOMPLETE")
    sys.exit(2)
emit("MPT_AUDIO_SECONDS",round(audio_seconds,1))
emit("MPT_CLIPS",len(clips))
emit("LOW_RAM_COMPOSITOR","START")
# Sequentially transcode at most 3 clips. Never decode 3 HD files concurrently.
segments=[]
for index in range(3):
    clip=clips[index%len(clips)]
    segment=job_dir/("seg"+str(index)+".mp4")
    command=["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
       "-threads","1","-stream_loop","-1","-i",str(clip),"-t","20",
       "-vf","scale=540:960:force_original_aspect_ratio=increase,crop=540:960,fps=24,format=yuv420p",
       "-an","-c:v","libx264","-preset","ultrafast","-crf","30",
       "-threads","1","-movflags","+faststart",str(segment)]
    try:
        subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=190)
    except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
        emit("STOP","FFMPEG_SEGMENT_"+str(index)+"_FAILED")
        sys.exit(2)
    if not segment.is_file() or segment.stat().st_size<10000:
        emit("STOP","SEGMENT_EMPTY")
        sys.exit(2)
    segments.append(segment)
    emit("SEGMENT_OK",index+1)
concat_file=job_dir/"segments.txt"
concat_file.write_text("".join("file '"+str(p)+"'\\n" for p in segments),encoding="utf-8")
visual=job_dir/"visual.mp4"
try:
    subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
        "-f","concat","-safe","0","-i",str(concat_file),"-c","copy",str(visual)],
        check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=80)
    output=job_dir/"review.mp4"
    subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
        "-i",str(visual),"-i",str(audio),"-map","0:v:0","-map","1:a:0",
        "-c:v","copy","-af","apad,atrim=duration=60","-t","60",
        "-c:a","aac","-b:a","128k","-movflags","+faststart",str(output)],
        check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=100)
    meta=probe(output)
    seconds=float(meta["format"]["duration"])
    streams=meta.get("streams",[])
    assert 59.5<=seconds<=60.4
    assert any(s.get("codec_type")=="audio" for s in streams)
    assert any(s.get("codec_type")=="video" and s.get("width")==540 and s.get("height")==960 for s in streams)
    assert output.stat().st_size>50000
except (Exception,AssertionError):
    emit("STOP","FINAL_VALIDATION_FAILED")
    sys.exit(2)
sha=hashlib.sha256(output.read_bytes()).hexdigest()
access=secrets.token_urlsafe(32)
token_path=job_dir/"review.token"
with token_path.open("x",encoding="utf-8") as f:
    os.chmod(token_path,0o600)
    f.write(access)
emit("SUCCESS_SECONDS",round(seconds,2))
emit("SUCCESS_BYTES",output.stat().st_size)
emit("SUCCESS_SHA256",sha)
emit("RENDER_SECONDS",round(time.monotonic()-start))
emit("PUBLISHED",False)
emit("REVIEW_URL","https://omda-moneyprinter-real-staging.onrender.com/v1/staging-review/"+access+"/video.mp4")
