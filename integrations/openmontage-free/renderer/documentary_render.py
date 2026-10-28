#!/usr/bin/env python3
"""OMDA travel documentary offline compositor (NO generation / NO publishing).

Source material must already be lawfully obtained. This script NEVER fetches
remote URLs, never calls AI APIs and never launches paid models. It verifies
the source ledger, edits existing footage, mixes supplied narration and optional
licensed music, and creates a review-only MP4 and a verifiable manifest.

Example: python documentary_render.py --project germany.json --assets /mnt/assets --output /tmp/job
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

ALLOWED_VIDEO = {".mp4", ".mov", ".m4v", ".webm"}
ALLOWED_AUDIO = {".wav", ".flac", ".mp3", ".m4a"}
ALLOWED_LICENSES = {"CC0-1.0", "CC-BY-4.0", "PEXELS", "PIXABAY", "OWNER"}
WIDTH = 1920
HEIGHT = 1080
FRAME_RATE = 24
MIN_SCENES = 2
MAX_SCENES = 24

class DocumentaryBlocked(ValueError): pass

def fail(code: str):
    raise DocumentaryBlocked(code)

def safe_id(value: str):
    if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9_-]{6,100}",value):
        fail("JOB_ID_INVALID")
    return value

def https_url(value: str) -> bool:
    try:
        p=urlparse(value)
        return p.scheme=="https" and bool(p.hostname) and p.username is None and p.password is None
    except (ValueError,TypeError):return False

def asset(root: Path, name: str, extensions: set[str]) -> Path:
    if not isinstance(name,str) or not name or "\\" in name:
        fail("ASSET_PATH_INVALID")
    try:
        file=(root/name).resolve(strict=True)
        file.relative_to(root)
    except (ValueError,OSError,RuntimeError):
        fail("ASSET_PATH_ESCAPE_OR_MISSING")
    if not file.is_file() or file.suffix.lower() not in extensions:
        fail("ASSET_FORMAT_INVALID")
    if not 100 <= file.stat().st_size <= 2*1024**3:
        fail("ASSET_SIZE_INVALID")
    return file

def validate(project: dict, root: Path) -> dict:
    """Validate the complete rights/identity/timing ledger before touching FFmpeg."""
    root=root.resolve(strict=True)
    if not isinstance(project,dict):fail("PROJECT_INVALID")
    job_id=safe_id(project.get("job_id"))
    if project.get("provider_policy") != "FREE_ONLY" or project.get("publish_intent") is not False:
        fail("ZERO_SPEND_AND_PUBLISH_LOCK_REQUIRED")
    if not isinstance(project.get("country"),str) or not 2 <= len(project["country"].strip()) <= 80:
        fail("COUNTRY_INVALID")
    if not isinstance(project.get("title"),str) or not 3 <= len(project["title"].strip()) <= 120:
        fail("TITLE_INVALID")
    if project.get("language") != "ar":
        fail("ARABIC_NARRATION_REQUIRED")
    duration=project.get("duration_seconds")
    if type(duration) not in (int,float) or not 5<=duration<=120:
        fail("PILOT_DURATION_OUT_OF_RANGE")
    scenes=project.get("scenes")
    if not isinstance(scenes,list) or not MIN_SCENES<=len(scenes)<=MAX_SCENES:
        fail("SCENE_COUNT_INVALID")
    safe_scenes=[]
    for i,scene in enumerate(scenes):
        if not isinstance(scene,dict):fail("SCENE_INVALID")
        clip=asset(root,scene.get("file"),ALLOWED_VIDEO)
        length=scene.get("duration_seconds")
        if type(length) not in (int,float) or not 1<=length<=60:
            fail("SCENE_DURATION_INVALID")
        for field in ("source_url","license_evidence_url","location_verification_url"):
            if not https_url(scene.get(field)):fail("SCENE_EVIDENCE_MISSING")
        if scene.get("license") not in ALLOWED_LICENSES:fail("SCENE_LICENSE_NOT_APPROVED")
        if not isinstance(scene.get("place_name"),str) or len(scene["place_name"].strip())<2:
            fail("SCENE_PLACE_NOT_IDENTIFIED")
        if not isinstance(scene.get("narration_text"),str) or not 5<=len(scene["narration_text"].strip())<=1200:
            fail("SCENE_SCRIPT_MISSING")
        safe_scenes.append({**scene, "_file": clip, "duration_seconds":float(length)})
    if abs(sum(s["duration_seconds"] for s in safe_scenes)-duration)>.04:
        fail("SCENE_TOTAL_DURATION_MISMATCH")
    narration=asset(root,project.get("narration_file"),ALLOWED_AUDIO)
    optional_music=None
    music=project.get("music")
    if music is not None:
        if not isinstance(music,dict) or music.get("license") not in ALLOWED_LICENSES or \
           not https_url(music.get("license_evidence_url")) or not https_url(music.get("source_url")):
            fail("MUSIC_RIGHTS_MISSING")
        optional_music=asset(root,music.get("file"),ALLOWED_AUDIO)
    return {"job_id":job_id,"title":project["title"].strip(),"country":project["country"].strip(),
            "duration":float(duration),"scenes":safe_scenes,"narration":narration,
            "music":optional_music,"language":"ar","input":project}

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open("rb") as fp:
        for block in iter(lambda:fp.read(1024*1024),b""):h.update(block)
    return h.hexdigest()

def run(cmd: list[str], timeout=300) -> str:
    p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
                     timeout=timeout,check=False)
    if p.returncode: raise RuntimeError("FFMPEG_STEP_FAILED_"+str(p.returncode))
    return p.stdout.strip()

def probe(path: Path) -> dict:
    out=run(["ffprobe","-v","error","-show_entries",
             "format=duration,size:stream=codec_type,codec_name,width,height",
             "-of","json",str(path)],timeout=20)
    data=json.loads(out)
    if not data.get("streams"):fail("INVALID_AV_MEDIA")
    return data

def compose(project: dict, root: Path, output: Path) -> dict:
    p=validate(project,root)
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        fail("FFMPEG_NOT_INSTALLED")
    out=output.resolve()
    if out.exists() and any(out.iterdir()):
        fail("OUTPUT_NOT_EMPTY")
    out.mkdir(parents=True,exist_ok=True)
    # Validate all real input streams before any heavy transcodes.
    voice_info=probe(p["narration"])
    voice_duration=float(voice_info.get("format",{}).get("duration",0))
    if not any(x.get("codec_type")=="audio" for x in voice_info["streams"]):
        fail("NARRATION_AUDIO_TRACK_MISSING")
    if not (p["duration"]*.55<=voice_duration<=p["duration"]+.2):
        fail("NARRATION_DURATION_MISMATCH")
    for s in p["scenes"]:
        details=probe(s["_file"])
        if not any(x.get("codec_type")=="video" for x in details["streams"]):
            fail("SCENE_VIDEO_TRACK_MISSING")
        if float(details.get("format",{}).get("duration",0))+.05<s["duration_seconds"]:
            fail("SCENE_FOOTAGE_TOO_SHORT")
    if p["music"]:
        details=probe(p["music"])
        if not any(x.get("codec_type")=="audio" for x in details["streams"]):
            fail("MUSIC_AUDIO_TRACK_MISSING")
    clips=[]
    for i,s in enumerate(p["scenes"]):
        target=out/f"part_{i:03d}.mp4"
        # Letterbox landscape inputs without distortion, crop none, 24fps, 1080p.
        vf=f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"+\
           f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FRAME_RATE},format=yuv420p"
        run(["ffmpeg","-hide_banner","-loglevel","error","-y","-protocol_whitelist","file,pipe",
             "-i",str(s["_file"]),"-t",str(s["duration_seconds"]),"-vf",vf,
             "-an","-c:v","libx264","-preset","veryfast","-crf","24",
             "-pix_fmt","yuv420p","-movflags","+faststart",str(target)],timeout=300)
        clips.append(target)
    concat=out/"concat.txt"
    concat.write_text("".join(f"file '{f.name}'\n" for f in clips),encoding="utf-8")
    silent=out/"silent.mp4"
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0",
         "-i",str(concat),"-c","copy",str(silent)])
    final=out/"documentary_review.mp4"
    command=["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(silent),
             "-i",str(p["narration"])]
    if p["music"]:
        command+=["-stream_loop","-1","-i",str(p["music"])]
        filters=("[1:a]aresample=48000,apad,atrim=duration="+str(p["duration"])+
                ",loudnorm=I=-16:TP=-2:LRA=7[voice];[2:a]aresample=48000,"+
                "volume=0.08,atrim=duration="+str(p["duration"])+
                "[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0[a]")
    else:
        filters=("[1:a]aresample=48000,apad,atrim=duration="+str(p["duration"])+
                ",loudnorm=I=-16:TP=-2:LRA=7[a]")
    command+=["-filter_complex",filters,"-map","0:v:0","-map","[a]",
              "-c:v","copy","-c:a","aac","-b:a","160k","-t",str(p["duration"]),
              "-movflags","+faststart",str(final)]
    run(command,timeout=300)
    info=probe(final)
    if abs(float(info["format"]["duration"])-p["duration"])>.6:fail("FINAL_DURATION_MISMATCH")
    video=[s for s in info["streams"] if s.get("codec_type")=="video"]
    audio=[s for s in info["streams"] if s.get("codec_type")=="audio"]
    if len(video)!=1 or len(audio)!=1 or video[0].get("codec_name")!="h264" or \
       audio[0].get("codec_name")!="aac" or video[0].get("width")!=WIDTH or \
       video[0].get("height")!=HEIGHT:
        fail("FINAL_STREAMS_INVALID")
    rights=[{k:s[k] for k in ("place_name","source_url","license",
             "license_evidence_url","location_verification_url","narration_text")}
            |{"clip_sha256":sha256(s["_file"])} for s in p["scenes"]]
    manifest={"job_id":p["job_id"],"country":p["country"],"title":p["title"],
              "status":"READY_FOR_OWNER_REVIEW","media_type":"licensed_footage_documentary",
              "provider_policy":"FREE_ONLY","gemini_video_generated":False,
              "google_flow_credits_used":0,"published":False,"approval_received":False,
              "narration_track_provided":True,"narration_track_sha256":sha256(p["narration"]),
              "music_included":bool(p["music"]),"duration_seconds":float(info["format"]["duration"]),
              "width":WIDTH,"height":HEIGHT,"bytes":final.stat().st_size,
              "sha256":sha256(final),"rights_ledger":rights,
              "note":"Scene place/rights claims require independent editorial verification before approval."}
    (out/"review_manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    return manifest

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--project",type=Path,required=True)
    parser.add_argument("--assets",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    x=parser.parse_args()
    result=compose(json.loads(x.project.read_text(encoding="utf-8")),x.assets,x.output)
    print(json.dumps({"status":result["status"],"sha256":result["sha256"],
                      "bytes":result["bytes"],"published":False},ensure_ascii=False))
if __name__=="__main__":main()
