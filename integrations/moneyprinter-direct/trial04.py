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

TRIAL = "omda-ar60-20261030-test04"
if os.getenv("OMDA_STAGING_EXPERIMENT_ID", "") != TRIAL:
    sys.exit(0)

import direct
HOME = Path(os.getenv("MPT_HOME","/tmp/omda-mpt-direct")).resolve()
JOBS_ROOT = HOME / "omda-jobs"
ENGINE = Path("/opt/MoneyPrinterTurbo")
def source_key(provider):
    return os.getenv("PIXABAY_API_KEY","").strip() if provider=="pixabay" else ""

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


# Lightweight alternative: uses the Pixabay video API, Edge TTS, and FFmpeg.
# Unlike the heavy MoviePy stage, it fits a 512 MiB free Render container.
import asyncio, hashlib, secrets, subprocess
from urllib.parse import urlsplit
import edge_tts
body = dict(
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
    idempotency_key="omda-ar60-20261030-test04",
    video_source="pixabay", duration_seconds=60, language="ar",
    provider_policy="FREE_ONLY", publish_intent=False)

work=JOBS_ROOT/"trial04"
work.mkdir(mode=0o700,parents=True,exist_ok=True)
audio=work/"narration.mp3"
emit("TTS","START")
async def make_voice():
    await edge_tts.Communicate(text=body["script"],voice="ar-SA-HamedNeural",rate="+0%").save(str(audio))
try:
    asyncio.run(make_voice())
    if not audio.is_file() or audio.stat().st_size<10000:
        raise ValueError("VOICE_EMPTY")
except Exception:
    emit("STOP","ARABIC_VOICE_FAILED")
    sys.exit(2)
def inspect_media(p):
    r=subprocess.run(["ffprobe","-v","error","-show_entries",
      "format=duration:stream=codec_type,width,height","-of","json",str(p)],
      capture_output=True,text=True,timeout=18,check=True)
    return json.loads(r.stdout)
duration=float(inspect_media(audio)["format"]["duration"])
emit("TTS_SECONDS",round(duration,1))
if not 20<=duration<=120:
    emit("STOP","VOICE_DURATION_INVALID")
    sys.exit(2)

# Pixabay API provided the video metadata earlier in this exact test.
emit("STOCK_DOWNLOAD","START")
candidates=[]
for clip in parsed.get("hits",[]):
    if not isinstance(clip,dict):
        continue
    variants=clip.get("videos") or {}
    selected=next((variants[k] for k in ("small","tiny","medium")
                   if isinstance(variants.get(k),dict) and variants[k].get("url")),None)
    if selected:
        candidates.append((clip.get("id"),clip.get("user"),selected["url"]))
material=[]
for clip_id,creator,uri in candidates[:9]:
    if len(material)>=3:
        break
    uri_parts=urlsplit(uri)
    if uri_parts.scheme!="https" or not (uri_parts.hostname and
           (uri_parts.hostname=="pixabay.com" or uri_parts.hostname.endswith(".pixabay.com"))):
        continue
    dest=work/("source"+str(len(material))+".mp4")
    try:
        req=Request(uri,headers={"User-Agent":"OMDA-Owner-Video-Test/1"})
        with urlopen(req,timeout=35) as response, dest.open("wb") as out:
            total=0
            while True:
                piece=response.read(256*1024)
                if not piece:
                    break
                total+=len(piece)
                if total>22*1024*1024:
                    raise ValueError("STOCK_TOO_LARGE")
                out.write(piece)
        info=inspect_media(dest)
        if not any(s.get("codec_type")=="video" for s in info.get("streams",[])):
            raise ValueError("STOCK_NOT_VIDEO")
        if float(info["format"]["duration"])<2:
            raise ValueError("STOCK_TOO_SHORT")
        material.append(dest)
        emit("CLIP_DOWNLOAD_OK",len(material))
    except (Exception,ValueError):
        dest.unlink(missing_ok=True)
        continue
if not material:
    emit("STOP","NO_DOWNLOADABLE_STOCK")
    sys.exit(2)
# Per-asset credits remain in temporary private file, never exposed in logs.
(work/"stock_credits.json").write_text(json.dumps([{"id":str(v[0]),"creator":str(v[1])} for v in candidates[:9]]),encoding="utf-8")
emit("COMPOSE","START")
segments=[]
for j in range(3):
    src=material[j%len(material)]
    part=work/("part"+str(j)+".mp4")
    args=["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
          "-threads","1","-stream_loop","-1","-i",str(src),"-t","20",
          "-vf","scale=540:960:force_original_aspect_ratio=increase,crop=540:960,fps=24,format=yuv420p",
          "-an","-c:v","libx264","-preset","ultrafast","-crf","30",
          "-threads","1","-movflags","+faststart",str(part)]
    try:
        subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=300)
        if part.stat().st_size<10000:
            raise ValueError("EMPTY_SEGMENT")
    except Exception:
        emit("STOP","SEGMENT_"+str(j)+"_FAILED")
        sys.exit(2)
    segments.append(part)
    emit("SEGMENT_OK",j+1)
list_file=work/"list.txt"
list_file.write_text("".join("file '"+str(p)+"'\n" for p in segments),encoding="utf-8")
joined=work/"joined.mp4"
output=work/"review.mp4"
try:
    subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
        "-f","concat","-safe","0","-i",str(list_file),"-c","copy",str(joined)],
        check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=110)
    tempo=max(0.5,min(2.0,duration/60.0))
    subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
       "-i",str(joined),"-i",str(audio),"-map","0:v:0","-map","1:a:0",
       "-c:v","copy","-af","atempo="+str(round(tempo,5))+",apad,atrim=duration=60",
       "-t","60","-c:a","aac","-b:a","128k","-movflags","+faststart",str(output)],
       check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=110)
    final=inspect_media(output)
    final_seconds=float(final["format"]["duration"])
    assert 59.5<=final_seconds<=60.4
    assert any(s.get("codec_type")=="audio" for s in final["streams"])
    assert any(s.get("codec_type")=="video" and s.get("width")==540 and s.get("height")==960 for s in final["streams"])
    assert output.stat().st_size>50000
except Exception:
    emit("STOP","FINAL_VALIDATION_FAILED")
    sys.exit(2)
token=secrets.token_urlsafe(32)
marker=work/"review.token"
with marker.open("x",encoding="utf-8") as f:
    os.chmod(marker,0o600)
    f.write(token)
emit("FINAL_SECONDS",round(final_seconds,2))
emit("FINAL_SIZE_BYTES",output.stat().st_size)
emit("FINAL_SHA256",hashlib.sha256(output.read_bytes()).hexdigest())
emit("PUBLISHED",False)
emit("ENGINE_MODE","PIXABAY_EDGE_TTS_FFMPEG_LOW_RAM")
emit("REVIEW_URL","https://omda-moneyprinter-real-staging.onrender.com/v1/staging-review/"+token+"/video.mp4")
