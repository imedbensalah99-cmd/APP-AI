#!/usr/bin/env python3
"""Original 60s documentary-proof materials; no paid services or publishing.

The MPT engine is invoked separately by GitHub Actions, not mocked here.
All generated artwork is synthetic and original. Narration is offline eSpeak NG.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path

SCENES = [
    "في ليلة شتوية، وجد نادر ظرفاً قديماً تحت باب منزله. لم يحمل اسم مرسل، لكن الختم يعود إلى عشرين عاماً.",
    "فتح الظرف ببطء، فقرأ: لا تذهب إلى المحطة بعد منتصف الليل. كان الخط يشبه خط أخيه الذي اختفى منذ سنوات.",
    "لم يصدق نادر الرسالة، حتى رن الهاتف القديم في الغرفة المهجورة. من الطرف الآخر، سمع صفير قطار بعيد.",
    "قال صوت خافت: انظر خلف الساعة. وجد هناك صورة يظهر فيها واقفاً في المحطة، لكن تاريخها كان تاريخ الغد.",
    "خرج إلى الشرفة، وكانت المدينة ساكنة. اختار أن يبقى في البيت، ووضع الرسالة أمام النافذة، وانتظر حتى منتصف الليل.",
    "عند دقة الساعة، ظهرت كلمات جديدة على الورقة: لقد غيرت النهاية. وفي الصباح، عاد أخوه وطرق الباب للمرة الأولى."
]
TITLE = "الرسالة التي غيرت النهاية"
EXPECTED = 60.0

def call(cmd, **kwargs):
    return subprocess.run(cmd, check=True, timeout=300, **kwargs)

def probe(path: Path):
    output = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height",
         "-of", "json", str(path)], timeout=25)
    return json.loads(output)

def make_artwork(directory: Path):
    from PIL import Image, ImageDraw, ImageFont
    assets = directory / "scenes"
    assets.mkdir(parents=True, exist_ok=True)
    palettes = [
        ((7, 14, 38), (31, 66, 104)),
        ((9, 33, 54), (51, 94, 112)),
        ((31, 20, 48), (94, 54, 82)),
        ((12, 29, 50), (57, 86, 112)),
        ((28, 27, 57), (92, 68, 112)),
        ((15, 38, 53), (58, 94, 101)),
    ]
    result = []
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    for idx, (start, finish) in enumerate(palettes):
        im = Image.new("RGB", (720, 1280))
        draw = ImageDraw.Draw(im)
        for y in range(1280):
            p = y / 1279.0
            rgb = tuple(round(start[k] * (1-p) + finish[k]*p) for k in range(3))
            draw.line((0, y, 719, y), fill=rgb, width=1)
        draw.ellipse((80+idx*15, 210+idx*16, 625, 755), outline=(202, 182, 140), width=4)
        draw.ellipse((150, 280, 560, 690), outline=(101, 160, 175), width=2)
        draw.rectangle((120, 848, 600, 1075), outline=(200, 179, 142), width=3)
        font = ImageFont.truetype(font_path, 40)
        small = ImageFont.truetype(font_path, 24)
        draw.text((175, 880), "SARDERA", font=font, fill=(244, 226, 189))
        draw.text((175, 951), f"ORIGINAL STORY - {idx+1:02d}", font=small, fill=(210, 218, 224))
        output = assets / f"scene-{idx+1:02d}.png"
        im.save(output, optimize=True)
        result.append(str(output.resolve()))
    return result

def prepare(base: Path):
    base.mkdir(parents=True, exist_ok=True)
    scenes = make_artwork(base)
    script = " ".join(SCENES)
    source = base / "arabic_raw.wav"
    model_path = os.environ.get("OMDA_PIPER_MODEL", "").strip()
    voice_source = "OFFLINE_ESPEAK_NG"
    if model_path:
        model = Path(model_path).resolve()
        expected = "1578a9b27d01a0626227225b148179628b770607dd61bdbbc41865bd399106b1"
        if not model.is_file() or not Path(str(model) + ".json").is_file():
            raise RuntimeError("Required pinned Arabic Piper voice files missing")
        digest = hashlib.sha256()
        with model.open("rb") as fd:
            for chunk in iter(lambda: fd.read(1024*1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise RuntimeError("Pinned Arabic Piper model checksum mismatch")
        call(["piper", "--model", str(model), "--output_file", str(source)],
             input=script, encoding="utf-8", capture_output=True)
        voice_source = "OFFLINE_PINNED_PIPER_AR_EMIRATI_FEMALE"
    else:
        call(["espeak-ng", "-v", "ar", "-s", "155", "-w", str(source), "--stdin"],
             input=script, encoding="utf-8", capture_output=True)
    measured = float(probe(source)["format"]["duration"])
    if not (20 < measured < 180):
        raise RuntimeError(f"Invalid offline voice duration: {measured}")
    # Change tempo before padding; preserve the entire script whenever possible.
    tempo = min(1.9, max(0.65, measured/58.5))
    processed = base / "arabic_60.wav"
    call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
          "-i", str(source), "-af",
          f"atempo={tempo:.5f},apad,atrim=duration=60,asetpts=PTS-STARTPTS",
          "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(processed)])
    actual = float(probe(processed)["format"]["duration"])
    if abs(actual-60) > .05:
        raise RuntimeError("60s narration preparation failed")
    srt = base / "captions.srt"
    with srt.open("w", encoding="utf-8") as fd:
        for i, scene in enumerate(SCENES):
            start, end = i*10, (i+1)*10
            fd.write(f"{i+1}\n00:00:{start:02},000 --> 00:01:00,000\n" if end == 60 else
                     f"{i+1}\n00:00:{start:02},000 --> 00:00:{end:02},000\n")
            # Short original subtitle headline avoids overflowing mobile screens.
            fd.write(scene[:95].rstrip() + "\n\n")
    task = [{
        "video_subject": TITLE,
        "video_script": script,
        "video_terms": ["letter", "clock", "mystery", "train", "night", "family"],
        "video_source": "local",
        "video_materials": [{"provider": "local", "url": p, "duration": 0} for p in scenes],
        "video_aspect": "9:16",
        "video_concat_mode": "sequential",
        "image_motion": "static",
        "video_clip_duration": 10,
        "video_count": 1,
        "custom_audio_file": str(processed.resolve()),
        "voice_name": "no-voice",
        "bgm_type": "",
        "bgm_volume": 0,
        "subtitle_enabled": False,
        "n_threads": 2,
        "video_language": "ar"
    }]
    (base/"manifest.json").write_text(json.dumps(task, ensure_ascii=False, indent=2),encoding="utf-8")
    (base/"pilot_source.json").write_text(json.dumps({
        "title":TITLE, "source_materials":"ORIGINAL_SYNTHETIC",
        "narration":voice_source, "raw_voice_duration":measured,
        "normalized_voice_duration":actual, "target_duration":60,
        "moneyprinter_required":True, "published":False,
        "paid_generation":False
    },ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"prepared": True, "scenes":len(scenes),
                      "audio_seconds":actual, "material_source":"ORIGINAL_SYNTHETIC"}))

def verify(base: Path, mpt_root: Path):
    data = json.loads((base/"mpt_result.json").read_text(encoding="utf-8"))
    if data.get("failed") != 0 or data.get("succeeded") != 1:
        raise RuntimeError("MoneyPrinterTurbo did not finish successfully")
    items = data.get("tasks", [])
    task = items[0] if len(items) == 1 else {}
    if task.get("status") != "succeeded":
        raise RuntimeError("MPT task failed")
    result = task.get("result") or {}
    candidates = result.get("combined_videos") or result.get("videos") or []
    if not isinstance(candidates, list) or not candidates:
        raise RuntimeError("MoneyPrinterTurbo returned no MP4")
    src = Path(candidates[0]).resolve()
    if not src.is_file() or src.suffix.lower() != ".mp4":
        raise RuntimeError("MoneyPrinterTurbo output is not a real MP4 file")
    # Only generated MPT files under its own storage folder may be ingested.
    home = Path(os.environ.get("MPT_HOME", str(mpt_root))).resolve()
    valid_roots = [home/"storage"/"tasks", mpt_root/"storage"/"tasks"]
    if not any(src.is_relative_to(p.resolve()) for p in valid_roots):
        raise RuntimeError("Unexpected MPT output location")
    original_duration = float(probe(src)["format"]["duration"])
    if not (56 <= original_duration <= 62):
        raise RuntimeError(f"MPT render duration outside acceptance band: {original_duration}")
    target = base/"omda-moneyprinter60-review.mp4"
    # Adapt codec frame timing to exact 60 seconds and add original timed captions.
    call(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
          "-i", str(src), "-i", str(base/"arabic_60.wav"),
          "-map", "0:v:0", "-map", "1:a:0", "-vf",
          f"tpad=stop_mode=clone:stop_duration=3,scale=1080:1920,fps=24,"
          f"subtitles={base/'captions.srt'}:force_style='FontName=Noto Sans Arabic,FontSize=18,"
          "Outline=2,Alignment=2,MarginV=100'",
          "-af", "apad,atrim=duration=60",
          "-t", "60", "-pix_fmt", "yuv420p",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "27",
          "-threads", "2", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
          str(target)])
    info = probe(target)
    duration = float(info["format"]["duration"])
    streams = info.get("streams", [])
    if not (59.7 <= duration <= 60.3):
        raise RuntimeError(f"Final MP4 duration wrong: {duration}")
    if not any(x.get("codec_type")=="video" and x.get("width")==1080 and
               x.get("height")==1920 for x in streams):
        raise RuntimeError("Final MP4 not 1080x1920 portrait")
    if not any(x.get("codec_type")=="audio" for x in streams):
        raise RuntimeError("Narration track missing")
    sha = hashlib.sha256()
    with target.open("rb") as fd:
        for chunk in iter(lambda: fd.read(1024*1024), b""):
            sha.update(chunk)
    verification = {
        "status":"READY_FOR_OWNER_REVIEW", "engine":"MoneyPrinterTurbo CLI",
        "duration_seconds":duration,"resolution":"1080x1920",
        "audio_present":True,"captions_burned_in":True,
        "file_bytes":target.stat().st_size,"sha256":sha.hexdigest(),
        "published":False,"paid_generation":False,"flow_credits_used":0,
        "original_synthetic_visuals":True,"narration":json.loads((base/"pilot_source.json").read_text(encoding="utf-8"))["narration"],
        "quality_note":"Infrastructure proof only; synthetic visuals and robotic voice are not a polished channel video"
    }
    (base/"verification.json").write_text(
        json.dumps(verification,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(verification,ensure_ascii=False))

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("operation",choices=("prepare","verify"))
    ap.add_argument("--out",default="pilot-output")
    ap.add_argument("--mpt-root",default="MoneyPrinterTurbo")
    args=ap.parse_args()
    if args.operation=="prepare": prepare(Path(args.out).resolve())
    else: verify(Path(args.out).resolve(), Path(args.mpt_root).resolve())
