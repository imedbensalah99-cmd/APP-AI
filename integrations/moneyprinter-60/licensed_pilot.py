#!/usr/bin/env python3
"""Free 60s OMDA/MoneyPrinterTurbo pilot: licensed Commons footage + Arabic male narrator.

Isolated GitHub Actions experiment; not an API, website integration, or publisher.
Every media item must have explicit machine-readable re-use terms. Fail closed.
"""
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "OMDA-DocumentaryPilot/0.1 (licensing and review experiment; github.com/imedbensalah99-cmd/APP-AI)"
TITLE = "ألمانيا: من العاصمة إلى الطبيعة"
SCENES = [
    ("Berlin city", "في برلين، عاصمة ألمانيا، تمتزج الحياة الحديثة بمعالم تحكي فصولاً من التاريخ الأوروبي."),
    ("Berlin architecture", "وفي شوارع المدينة نرى عمارة متنوعة وساحات عامة تعكس التحولات التي مرت بها البلاد."),
    ("Bavarian Alps", "جنوباً تمتد جبال الألب البافارية، حيث ترتفع القمم فوق وديان وغابات واسعة."),
    ("Germany forest", "وفي الغابات الألمانية، تتغير الألوان مع الفصول وتتنوع المناظر بين الأشجار والمرتفعات."),
    ("Rhine river Germany", "وعلى ضفاف نهر الراين، تمر المياه بجوار مدن قديمة ومناظر طبيعية وتلال خضراء."),
    ("Germany train landscape", "من المدن إلى الأنهار والجبال، تكشف الرحلة جانباً من تنوع الطبيعة الألمانية.")
]
ALLOW = re.compile(r"^(?:CC0(?:\s|$)|CC BY(?:-SA)?(?:\s|$)|PUBLIC DOMAIN(?:\s|$)|PD(?:\s|-|$))", re.I)
CODEC_EXT = {".webm", ".ogv", ".ogg", ".mp4", ".mov"}
MAX_FILE = 55 * 1024 * 1024
# Scenes are rejected if the visible source title describes the wrong subject.
TITLE_PATTERNS = (
    re.compile(r"berlin", re.I),
    re.compile(r"berlin.*(museum|architecture|building|courtyard|street|city|platz|rain)|(?:museum|building|street).*berlin", re.I),
    re.compile(r"alps|alpine|bavaria|bavarian|zugspitze|mountain", re.I),
    re.compile(r"forest|woodland|schwarzwald|trees", re.I),
    re.compile(r"rhine|rhein|river", re.I),
    re.compile(r"rail|train|bahn", re.I),
)
IRRELEVANT_TITLES = re.compile(r"wikipedia|anthem|animation|demo|protest|politic|covid|army|militar|simulation", re.I)
SEARCH_PHRASES = (
    ("Berlin street", "Berlin city", "Berlin"),
    ("Berlin museum", "Berlin architecture", "Berlin"),
    ("Bavarian Alps", "Alpine cows", "Bavaria mountain", "Alps"),
    ("Black Forest Germany", "Schwarzwald", "forest"),
    ("Rhine river Germany", "Rhein river", "Rhine"),
    ("Germany train landscape", "German railway", "Deutsche Bahn", "railway Germany"),
)


def run(*args, **kwargs):
    return subprocess.run(list(args), check=True, capture_output=True, text=True, timeout=270, **kwargs)

def probe(path):
    return json.loads(run("ffprobe", "-v", "error", "-show_entries",
                          "format=duration:stream=codec_type,width,height",
                          "-of", "json", str(path)).stdout)

def wiki_search(phrase):
    qs = urlencode({"action": "query", "generator": "search",
                    "gsrsearch": "filetype:video " + phrase,
                    "gsrnamespace": 6, "gsrlimit": 35,
                    "prop": "imageinfo",
                    "iiprop": "url|size|mime|extmetadata", "format": "json"})
    request = Request(API + "?" + qs, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as res:
        payload = json.load(res)
    return list(payload.get("query", {}).get("pages", {}).values())

def extract_license(meta):
    short = html.unescape(re.sub("<[^>]*>", "", meta.get("LicenseShortName", {}).get("value", ""))).strip()
    url = html.unescape(meta.get("LicenseUrl", {}).get("value", ""))
    return short, url

def valid_file(page, selected, scene_index):
    entry = (page.get("imageinfo") or [{}])[0]
    url = entry.get("url", "")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "upload.wikimedia.org":
        return None
    if Path(parsed.path).suffix.lower() not in CODEC_EXT:
        return None
    if entry.get("size", 0) < 100000 or entry.get("size", 0) > MAX_FILE:
        return None
    if not str(entry.get("mime", "")).startswith("video/"):
        return None
    extended = entry.get("extmetadata") or {}
    lic, lic_url = extract_license(extended)
    if not ALLOW.match(lic):
        return None
    if url in selected:
        return None
    title = page.get("title", "")
    if not title.startswith("File:"):
        return None
    if IRRELEVANT_TITLES.search(title) or not TITLE_PATTERNS[scene_index].search(title):
        return None
    artist = html.unescape(re.sub("<[^>]*>", "", extended.get("Artist", {}).get("value", ""))).strip()
    if not artist:
        return None  # CC-BY / BY-SA attribution must not be anonymous.
    return {"file_title": title, "url": url, "artist": artist,
            "page_url": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"),
            "license": lic, "license_url": lic_url,
            "size": entry["size"], "mime": entry["mime"]}

def bounded_download(url, dest):
    temp = dest.with_suffix(".part")
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        count = 0
        with urlopen(req, timeout=90) as response, temp.open("xb") as target:
            if response.geturl().split("/")[2] != "upload.wikimedia.org":
                raise RuntimeError("Untrusted Commons redirect")
            while True:
                chunk = response.read(1024*1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > MAX_FILE:
                    raise RuntimeError("Oversized Commons footage")
                target.write(chunk)
        if count < 100000:
            raise RuntimeError("Empty asset")
        temp.rename(dest)
    finally:
        temp.unlink(missing_ok=True)

def prepare(folder):
    import edge_tts
    import asyncio
    folder.mkdir(parents=True, exist_ok=True)
    directory = folder/"licensed_media"
    directory.mkdir(exist_ok=True)
    chosen, seen, reasons = [], set(), []
    rate_limited = False
    for idx, (term, _text) in enumerate(SCENES):
        if rate_limited:
            break
        candidates = []
        for phrase in SEARCH_PHRASES[idx]:
            try:
                candidates += wiki_search(phrase)
            except Exception as exc:
                reasons.append({"scene": idx+1, "query": phrase, "error": type(exc).__name__, "http_code": getattr(exc,"code",None)})
                if getattr(exc,"code",None) == 429:
                    rate_limited = True
                    break
        if rate_limited:
            break
        candidates.sort(key=lambda p: p.get("imageinfo", [{}])[0].get("size", 0))
        for page in candidates:
            meta = valid_file(page, seen, idx)
            if not meta:
                continue
            dest = directory / ("scene-%02d" % (idx+1) + Path(urlsplit(meta["url"]).path).suffix.lower())
            try:
                bounded_download(meta["url"], dest)
                info = probe(dest)
                if float(info["format"]["duration"]) < 5:
                    raise RuntimeError("Clip shorter than five seconds")
                if not any(s.get("codec_type") == "video" for s in info.get("streams", [])):
                    raise RuntimeError("No moving-picture stream")
            except Exception as exc:
                dest.unlink(missing_ok=True)
                reasons.append({"scene":idx+1, "file":meta["file_title"],"error":type(exc).__name__, "http_code":getattr(exc,"code",None)})
                if getattr(exc,"code",None) == 429:
                    rate_limited = True
                    break
                continue
            meta["scene"] = idx+1
            meta["search_term"] = term
            meta["local_path"] = str(dest.resolve())
            seen.add(meta["url"])
            chosen.append(meta)
            break
        if rate_limited:
            break
    audit = {"provider": "Wikimedia Commons", "licensed_assets": chosen,
             "search_errors": reasons[:20], "expected_scenes": len(SCENES),
             "source_rate_limited": rate_limited,
             "published": False, "reused_without_attribution": False}
    (folder/"source_audit.json").write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
    if len(chosen) != len(SCENES):
        if rate_limited:
            raise RuntimeError("COMMONS_HTTP_429_RATE_LIMIT: stop source requests and use an authorized alternative")
        raise RuntimeError("STOCK_LICENSE_OR_AVAILABILITY_GATE_FAILED: found %d/%d assets" %
                           (len(chosen), len(SCENES)))
    script = " ".join(scene for _, scene in SCENES)
    raw = folder/"narration_raw.mp3"
    async def speech():
        speak = edge_tts.Communicate(script, "ar-SA-HamedNeural", rate="+0%")
        await speak.save(str(raw))
    asyncio.run(speech())
    d = float(probe(raw)["format"]["duration"])
    if not (45 <= d <= 77):
        raise RuntimeError("ARABIC_NARRATOR_PACING_UNACCEPTABLE: %0.2f" % d)
    ratio = d/59.0
    run("ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
        "-i",str(raw),"-af","atempo=%.6f,apad,atrim=duration=60" % ratio,
        "-ar","24000","-ac","1","-c:a","pcm_s16le",str(folder/"arabic_60.wav"))
    srt = folder/"captions.srt"
    def ts(second):
        return "00:%02d:%02d,000" % (second//60, second%60)
    srt.write_text("\n\n".join(
        "%d\n%s --> %s\n%s" % (i+1,ts(i*10),ts((i+1)*10), sentence)
        for i, (_term,sentence) in enumerate(SCENES)) + "\n", encoding="utf-8")
    manifest = [{
        "video_subject": TITLE, "video_script": script,
        "video_terms": [k for k,v in SCENES],
        "video_source": "local",
        "video_materials": [{"provider":"local","url":m["local_path"],"duration":0} for m in chosen],
        "video_aspect":"9:16", "video_concat_mode":"sequential", "video_fit_mode":"cover",
        "video_clip_duration":10, "video_count":1,"image_motion":"static",
        "custom_audio_file":str((folder/"arabic_60.wav").resolve()),
        "voice_name":"no-voice", "bgm_type":"", "bgm_volume":0, "subtitle_enabled":False,
        "n_threads":2, "video_language":"ar"}]
    (folder/"manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2),encoding="utf-8")
    (folder/"agent_preflight.json").write_text(json.dumps({
        "research_agent":{"state":"SCRIPT_DRAFTED","fact_review":"HUMAN_REVIEW_REQUIRED"},
        "footage_agent":{"state":"PASS","clips":len(chosen)},
        "rights_agent":{"state":"PASS_MACHINE_LICENSE_CHECK","attribution":"source_audit.json"},
        "narration_agent":{"state":"GENERATED_NOT_HUMAN_VERIFIED","voice":"ar-SA-HamedNeural",
                           "raw_duration":d},
        "editing_agent":{"state":"AWAITING_MPT"},
        "qa_agent":{"state":"AWAITING_RENDER"},
        "storage_agent":{"state":"GITHUB_ARTIFACT_ONLY"},
        "publishing_agent":{"state":"LOCKED"}},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print("STOCK_LICENSE_AND_ARABIC_TTS_PREPARED:",len(chosen),"clips; narration",round(d,2),"seconds")

def visual_activity(path):
    p=subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-i",str(path),
        "-vf","fps=1/5,crop=iw:trunc(ih*0.65/2)*2:0:0,scale=32:32,format=gray",
        "-frames:v","12","-f","rawvideo","-"],capture_output=True,timeout=60,check=True)
    raw=p.stdout
    unit=1024
    frames=[raw[i:i+unit] for i in range(0,len(raw),unit)]
    if len(frames)<9 or any(len(f)!=unit for f in frames):
        return False
    differences=[sum(abs(a-b) for a,b in zip(x,y))/unit for x,y in zip(frames,frames[1:])]
    return sum(d>=3.0 for d in differences)>=3

def verify(folder,mpt_root):
    source=json.loads((folder/"source_audit.json").read_text(encoding="utf-8"))
    if len(source.get("licensed_assets",[])) != 6:
        raise RuntimeError("SOURCE_LICENSE_AUDIT_MISSING")
    result=json.loads((folder/"mpt_result.json").read_text(encoding="utf-8"))
    if result.get("failed")!=0 or result.get("succeeded")!=1:
        raise RuntimeError("GENUINE_MPT_RENDER_FAILED")
    tasks=result.get("tasks") or []
    item=tasks[0] if len(tasks)==1 else {}
    if item.get("status")!="succeeded":
        raise RuntimeError("MPT_RESULT_INVALID")
    candidates=(item.get("result") or {}).get("combined_videos") or (item.get("result") or {}).get("videos") or []
    if not candidates:
        raise RuntimeError("MPT_NO_VIDEO")
    src=Path(candidates[0]).resolve()
    home=Path(os.getenv("MPT_HOME",str(mpt_root))).resolve()
    if not src.is_file() or not any(src.is_relative_to(r.resolve()) for r in
                                    (home/"storage"/"tasks",mpt_root.resolve()/"storage"/"tasks")):
        raise RuntimeError("UNTRUSTED_MPT_OUTPUT_PATH")
    elapsed=float(probe(src)["format"]["duration"])
    if not 56 <= elapsed <= 62:
        raise RuntimeError("MPT_OUTPUT_DURATION_INCORRECT")
    dest=folder/"omda-licensed-60-owner-review.mp4"
    run("ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
        "-i",str(src),"-i",str(folder/"arabic_60.wav"),
        "-map","0:v:0","-map","1:a:0",
        "-vf","tpad=stop_mode=clone:stop_duration=3,scale=1080:1920,fps=24,"
              "subtitles=%s:force_style='FontName=Noto Sans Arabic,FontSize=18,Outline=2,Alignment=2,MarginV=100'" %
              str(folder/"captions.srt"),
        "-af","apad,atrim=duration=60","-t","60","-pix_fmt","yuv420p",
        "-c:v","libx264","-preset","ultrafast","-crf","27","-threads","2",
        "-c:a","aac","-b:a","96k","-movflags","+faststart",str(dest))
    info=probe(dest)
    streams=info.get("streams",[])
    duration=float(info["format"]["duration"])
    if not (59.7<=duration<=60.3 and
            any(x.get("codec_type")=="video" and x.get("width")==1080 and x.get("height")==1920 for x in streams)
            and any(x.get("codec_type")=="audio" for x in streams)):
        raise RuntimeError("FINAL_VIDEO_ENCODING_QA_FAILED")
    volume=subprocess.run(["ffmpeg","-hide_banner","-nostdin","-i",str(dest),
        "-vn","-af","volumedetect","-f","null","-"],text=True,capture_output=True,
        timeout=45,check=True).stderr
    match=re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?) dB",volume)
    if not match or float(match.group(1))<=-32:
        raise RuntimeError("NARRATOR_SILENT")
    if not visual_activity(dest):
        raise RuntimeError("STOCK_VIDEO_STATIC_OR_LOW_MOTION")
    digest=hashlib.sha256()
    with dest.open("rb") as file:
        for buf in iter(lambda:file.read(1024*1024),b""):
            digest.update(buf)
    report={"status":"AWAITING_HUMAN_QUALITY_REVIEW","engine":"genuine MoneyPrinterTurbo CLI",
      "duration_seconds":duration,"resolution":"1080x1920","voice":"ar-SA-HamedNeural",
      "measured_max_volume_db":float(match.group(1)),"moving_video_gate":True,
      "licensed_footage_items":len(source["licensed_assets"]),
      "source_licenses_recorded":True,"source_manifest":"source_audit.json",
      "video_sha256":digest.hexdigest(),"bytes":dest.stat().st_size,
      "agent_checks":{
          "research":"SCRIPT_PRESENT; FACTUAL_REVIEW_REQUIRED",
          "footage":"PASS_6_REAL_STOCK_CLIPS",
          "rights":"PASS_MACHINE_LICENSE_CHECK; ATTRIBUTION_REVIEW_REQUIRED",
          "voice":"PASS_TECHNICAL; HUMAN_ARABIC_PRONUNCIATION_REVIEW_REQUIRED",
          "editing":"PASS_REAL_MPT_AND_FFMPEG",
          "quality":"PASS_TECHNICAL; HUMAN_STORY_MATCH_REVIEW_REQUIRED",
          "storage":"GITHUB_ARTIFACT_ONLY; DRIVE_NOT_CONNECTED",
          "publishing":"LOCKED"},
      "paid_generation":False,"published":False,"flow_credits_used":0}
    (folder/"qa_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=("prepare","verify"))
    parser.add_argument("--out",required=True)
    parser.add_argument("--mpt-root",default="vendor/MoneyPrinterTurbo")
    args=parser.parse_args()
    folder=Path(args.out).resolve()
    if args.action=="prepare":
        prepare(folder)
    else:
        verify(folder,Path(args.mpt_root).resolve())

if __name__=="__main__":
    main()
