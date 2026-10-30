#!/usr/bin/env python3
"""Record a genuine Arabic male TTS sample in isolation. Never publish."""
import asyncio
import json
import subprocess
from pathlib import Path
from licensed_pilot import SCENES

async def main():
    import edge_tts
    output=Path(__import__("sys").argv[1]).resolve()
    output.mkdir(parents=True,exist_ok=True)
    voice="ar-SA-HamedNeural"
    script=" ".join(scene for term,scene in SCENES)
    file=output/"omda-arabic-hamed-voice-preview.mp3"
    await edge_tts.Communicate(script,voice,rate="+0%").save(str(file))
    parsed=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
                           "-of","json",str(file)],check=True,capture_output=True,text=True,timeout=25)
    seconds=float(json.loads(parsed.stdout)["format"]["duration"])
    loud=subprocess.run(["ffmpeg","-hide_banner","-nostdin","-i",str(file),
                         "-af","volumedetect","-f","null","-"],capture_output=True,
                        text=True,check=True,timeout=30)
    if not 20 <= seconds <= 90 or "max_volume: -inf" in loud.stderr:
        raise RuntimeError("VOICE_PREVIEW_AUDIO_FAILED")
    (output/"voice-proof.json").write_text(json.dumps({
       "voice":voice,"language":"ar","sex":"male","duration_seconds":seconds,
       "file_bytes":file.stat().st_size,"published":False,
       "human_pronunciation_review_required":True},ensure_ascii=False,indent=2),encoding="utf-8")
    print("REAL_ARABIC_MALE_TTS_RENDERED; duration:",seconds)

if __name__=="__main__":
    asyncio.run(main())
