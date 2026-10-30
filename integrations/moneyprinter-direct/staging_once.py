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

TRIAL = "omda-ar60-20261030-test01"
if os.getenv("OMDA_STAGING_EXPERIMENT_ID", "") != TRIAL:
    sys.exit(0)

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

# No credentials for any paid provider. Narration is free Edge TTS.
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
    terms=["ocean waves", "waterfall", "forest rain", "river nature", "clouds sky"],
    idempotency_key="omda-ar60-20261030-test01",
    video_source="pixabay", duration_seconds=60, language="ar",
    provider_policy="FREE_ONLY", publish_intent=False)
job_id = uuid.uuid4().hex
JOBS[job_id] = {"state": "QUEUED", "fingerprint": "internal-one-shot"}
emit("RENDER", "START")
start = time.monotonic()
execute(job_id, body)
record = JOBS[job_id]
emit("RENDER", record.get("state", "UNKNOWN"))
emit("ELAPSED_SECONDS", round(time.monotonic() - start))
if record.get("state") == "READY_FOR_STORAGE":
    result = record["result"]
    emit("DURATION_SECONDS", result.get("duration_seconds"))
    emit("RESOLUTION", result.get("resolution"))
    emit("SIZE_BYTES", result.get("size_bytes"))
    emit("SHA256", result.get("sha256"))
    emit("PUBLISHED", False)
else:
    emit("FAIL_CODE", record.get("error", "UNKNOWN"))
