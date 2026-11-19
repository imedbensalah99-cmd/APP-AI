#!/usr/bin/env python3
"""OMDA synthetic/no-spend cinematic video renderer.

Offline-capable graphics and audio path. Optional Piper Arabic TTS is required for
narrated production. No web calls, remote provider interaction, or publishing.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansArabicUI-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf',
]
DEFAULT_STORY = ROOT / 'examples/sardera_elevator.json'
MAX_SCENES = 12


def run(cmd: list[str], *, capture=True) -> str:
    result = subprocess.run(cmd, text=True, stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE, check=False, timeout=240)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {cmd[0]} {" ".join(cmd[1:4])}\n{result.stderr[-1500:]}')
    return (result.stdout or '').strip()


def fontfile(path: str | None) -> str:
    candidates = [path] if path else []
    candidates += FONT_CANDIDATES
    for p in candidates:
        if p and Path(p).is_file():
            return str(Path(p))
    raise RuntimeError('Arabic font missing: provide --font NotoSansArabic-Regular.ttf')


def validate_story(data: dict) -> dict:
    if data.get('channel') not in ('SARDERA', 'NIMOLOO'):
        raise ValueError('Unsupported channel')
    scenes=data.get('scenes')
    if not isinstance(scenes,list) or not 1 <= len(scenes) <= MAX_SCENES:
        raise ValueError('Require between 1 and 12 scenes')
    duration=float(data.get('duration_seconds',0))
    if not 5 <= duration <= 60:
        raise ValueError('Duration must be between 5 and 60 seconds')
    for idx, scene in enumerate(scenes):
        if not isinstance(scene,dict) or not isinstance(scene.get('text'),str) or not (1 <= len(scene['text']) <= 250):
            raise ValueError(f'Scene {idx} is missing valid text')
    return data


def make_scene(path: Path, caption: str, i: int, count: int, font: str, seed: str):
    # Original procedural graphics. No external copyrighted images.
    w,h = 540,960
    img=Image.new('RGB',(w,h)); px=img.load()
    palette=[(8,12,25),(9,18,30),(10,15,32),(13,15,30),(9,12,23),(13,10,21)]
    base=palette[i%len(palette)]
    shift=int(hashlib.sha256(seed.encode()).hexdigest()[:4],16)%90
    for y in range(h):
        for x in range(w):
            distance=math.hypot((x-w*.55)/w,(y-h*.36)/h)
            halo=max(0,1-distance*2.1)
            z=abs(math.sin(y*.006+x*.004+shift))
            px[x,y]=tuple(int(max(0,min(255,c+halo*(12,20,38)[k]+z*2))) for k,c in enumerate(base))
    d=ImageDraw.Draw(img,'RGBA')
    # Elegant stylised corridor silhouette + parallax shapes, distinct across scenes.
    vanishing_x=w//2+int(18*math.sin(i*1.1)); vanishing_y=410+i*6
    d.polygon([(0,0),(w,0),(vanishing_x+75,vanishing_y),(vanishing_x-75,vanishing_y)],fill=(22,38,65,55))
    d.polygon([(0,h),(w,h),(vanishing_x+70,vanishing_y),(vanishing_x-70,vanishing_y)],fill=(3,7,16,125))
    for k in range(4):
        y=520+k*125
        d.line([(0,y),(vanishing_x-50,vanishing_y)],fill=(72,120,160,26),width=2)
        d.line([(w,y),(vanishing_x+50,vanishing_y)],fill=(72,120,160,26),width=2)
    door_w=104+(i%3)*15; door_h=225+(i%2)*35
    d.rounded_rectangle((vanishing_x-door_w//2,vanishing_y-door_h,vanishing_x+door_w//2,vanishing_y+11),radius=5,fill=(2,8,17,230),outline=(56,166,198,120),width=3)
    if i >= 3:
        d.polygon([(vanishing_x+door_w//3,vanishing_y-door_h),(vanishing_x+door_w//2,vanishing_y-door_h),(vanishing_x+door_w//2,vanishing_y),(vanishing_x+door_w//3,vanishing_y)],fill=(140,240,255,22+i*7))
    for k in range(7):
        xx=(33+81*k+(shift%29))%w
        yy=(127+123*k+17*i)%h
        d.ellipse((xx,yy,xx+2,yy+2),fill=(140,200,230,40))
    d.line((45,90,w-45,90),fill=(82,181,214,130),width=2)
    f_s=ImageFont.truetype(font,16); f_l=ImageFont.truetype(font,31)
    latin_font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    en=ImageFont.truetype(latin_font,19) if Path(latin_font).is_file() else f_s
    d.text((w//2,49),'SARDERA',font=en,anchor='mm',fill=(180,227,239,230))
    d.text((w//2,79),'سرديرة',font=f_s,anchor='mm',fill=(180,227,239,230),direction='rtl')
    # Fit Arabic with RAQM (text shaping & RTL). Manual split to avoid bidi mistakes.
    words=caption.split(); lines=[]; line=''
    for word in words:
        candidate=(line+' '+word).strip()
        if d.textbbox((0,0),candidate,font=f_l,direction='rtl')[2] > w-80 and line:
            lines.append(line);line=word
        else:line=candidate
    if line: lines.append(line)
    if len(lines)>4: raise ValueError('Caption exceeds 4 lines; shorten copy')
    box_y=655
    d.rounded_rectangle((35,box_y-23,w-35,box_y+len(lines)*57+32),radius=18,fill=(2,6,14,205),outline=(65,150,170,95),width=2)
    for j,line in enumerate(lines):
        d.text((w//2,box_y+j*57+16),line,font=f_l,anchor='mm',fill=(245,249,249,255),direction='rtl',stroke_width=0)
    d.text((w//2,905),f'OMDA  /  {i+1:02d} - {count:02d}',font=ImageFont.truetype(latin_font,13) if Path(latin_font).is_file() else f_s,anchor='mm',fill=(130,178,191,170))
    img.save(path)


def srt_timestamp(t: float) -> str:
    ms=int(round(t*1000)); h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'


def write_srt(path: Path, scenes: list[dict], duration: float):
    seg=duration/len(scenes)
    text='\n\n'.join(f'{i+1}\n{srt_timestamp(i*seg)} --> {srt_timestamp((i+1)*seg)}\n{scene["text"]}' for i,scene in enumerate(scenes))+'\n'
    path.write_text(text,encoding='utf-8')


def create_audio(out: Path, duration: float, narration: str, piper_model: Path | None):
    # Optional REAL voice; production rejects a missing voice unless explicitly demo.
    voice=out/'voice.wav'
    if piper_model:
        if not piper_model.is_file(): raise ValueError('Piper model not found')
        if not shutil.which('piper'): raise RuntimeError('Install piper-tts for Arabic narration')
        cmd=['piper','--model',str(piper_model),'--length_scale','0.85','--output_file',str(voice)]
        r=subprocess.run(cmd,input=narration,encoding='utf-8',stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
        if r.returncode or not voice.is_file() or voice.stat().st_size < 1000:
            raise RuntimeError('Piper Arabic narration failed; video not marked narrated')
    if voice.is_file():
        narrated_seconds=float(probe(voice)['format']['duration'])
        if narrated_seconds > duration + 0.3:
            raise RuntimeError('NARRATION_TOO_LONG: voice exceeds requested video duration; shorten narration')
    ambient=out/'ambient.wav'
    # Soundscape original/generated and not a human voice.
    run(['ffmpeg','-hide_banner','-loglevel','error','-y',
         '-f','lavfi','-i','sine=frequency=62:sample_rate=48000',
         '-f','lavfi','-i','sine=frequency=124:sample_rate=48000',
         '-filter_complex','[0:a]volume=0.08[a];[1:a]volume=0.025[b];[a][b]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.8,afade=t=out:st='+str(max(0,duration-0.6))+':d=0.6[aout]',
         '-map','[aout]','-t',str(duration),'-ar','48000',str(ambient)])
    mix=out/'sound.wav'
    narrated=bool(piper_model) and voice.exists()
    if narrated:
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(voice),'-i',str(ambient),
             '-filter_complex','[0:a]aresample=48000,apad,atrim=duration='+str(duration)+',volume=1.5[v];[1:a]volume=0.6[b];[v][b]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]',
             '-map','[a]','-t',str(duration),str(mix)])
    else:
        shutil.copyfile(ambient,mix)
    normalized=out/'sound_normalized.wav'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(mix),
         '-af',('loudnorm=I=-16:TP=-2:LRA=7' if narrated else 'loudnorm=I=-23:TP=-2:LRA=7'),'-ar','48000',str(normalized)])
    return normalized,narrated


def probe(path: Path) -> dict:
    return json.loads(run(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,r_frame_rate,sample_rate','-of','json',str(path)]))


def make_video(story: Path, dest: Path, font_arg: str | None, piper_model: Path | None):
    for required in ('ffmpeg','ffprobe'):
        if not shutil.which(required):raise RuntimeError(required+' not available')
    data=validate_story(json.loads(story.read_text(encoding='utf-8')))
    dest.mkdir(parents=True,exist_ok=True)
    font=fontfile(font_arg)
    scenes=data['scenes']; dur=float(data['duration_seconds']); n=len(scenes)
    for i,s in enumerate(scenes):make_scene(dest/f'frame_{i:02}.png',s['text'],i,n,font,data.get('id','OMDA'))
    write_srt(dest/'captions.srt',scenes,dur)
    narration=' '.join(scene['text'] for scene in scenes)
    audio,narrated=create_audio(dest,dur,narration,piper_model)
    # Each static scene is zoomed in subtly by ffmpeg. No dependence on user PC after cloud deployment.
    pieces=[]
    counts=[int(round((i+1)*dur*30/n))-int(round(i*dur*30/n)) for i in range(n)]
    for i,count in enumerate(counts):
        sceneclip=dest/f'clip_{i:02}.mp4'
        sec=count/30
        # Exactly count frames. Enlarge to 1080x1920 while preserving portrait ratio.
        filt=f'scale=1080:1920:flags=lanczos,zoompan=z=min(zoom+0.00028\\,1.07):d={count}:s=1080x1920:fps=30,format=yuv420p'
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-loop','1','-framerate','30','-i',str(dest/f'frame_{i:02}.png'),'-vf',filt,'-frames:v',str(count),'-r','30','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-an',str(sceneclip)])
        pieces.append(sceneclip)
    concat=dest/'concat.txt';concat.write_text('\n'.join("file '"+p.name+"'" for p in pieces)+'\n')
    assembled=dest/'silent.mp4'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy',str(assembled)])
    final=dest/'OMDA_SARDERA_PROOF.mp4'
    run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(assembled),'-i',str(audio),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-ar','48000','-t',str(dur),'-movflags','+faststart',str(final)])
    video=probe(final)
    assert abs(float(video['format']['duration'])-dur)<.32,video
    assert {s['codec_name'] for s in video['streams']} >= {'h264','aac'},video
    assert video['streams'][0]['width']==1080 and video['streams'][0]['height']==1920
    sha=hashlib.sha256(final.read_bytes()).hexdigest()
    shutil.copyfile(dest/'frame_00.png',dest/'thumbnail.png')
    status='NARRATED_SYNTHETIC_PROOF' if narrated else 'SYNTHETIC_DEMO_NO_NARRATION'
    manifest={'job_id':data.get('id'),'channel':data['channel'],'status':status,'synthetic_media':True,
              'ai_video_generated':False,'narration_present':narrated,'published':False,'flow_credits_used':0,
              'api_cost_usd':0,'duration_seconds':float(video['format']['duration']),
              'bytes':final.stat().st_size,'sha256':sha,'format':video,'story_source':story.name,
              'font':Path(font).name,'caption_format':'Arabic RAQM burned + SRT',
              'tts_source':'Piper local model' if narrated else 'NONE — demo soundscape only',
              'audio_source':'FFmpeg-original tones','generation_provider':'none (procedural synthetic graphics)'}
    (dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return manifest


def main():
    a=argparse.ArgumentParser();a.add_argument('--story',type=Path,default=DEFAULT_STORY)
    a.add_argument('--output',type=Path,default=ROOT/'output')
    a.add_argument('--font',default=None);a.add_argument('--piper-model',type=Path,default=None)
    args=a.parse_args()
    print(json.dumps(make_video(args.story,args.output,args.font,args.piper_model),ensure_ascii=False,indent=2))
if __name__=='__main__':main()