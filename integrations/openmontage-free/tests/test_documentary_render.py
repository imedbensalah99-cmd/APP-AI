"""OMDA documentary contract + tiny media integration test (no network/paid API)."""
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

MOD=Path(__file__).resolve().parents[1]/"renderer"/"documentary_render.py"
spec=importlib.util.spec_from_file_location("omda_documentary",MOD)
doc=importlib.util.module_from_spec(spec)
spec.loader.exec_module(doc)

def sample():
    def s(file):
        return {"file":file,"duration_seconds":1,"place_name":"Fixture location",
                "source_url":"https://example.org/source",
                "license":"CC0-1.0",
                "license_evidence_url":"https://example.org/license",
                "location_verification_url":"https://example.org/location",
                "narration_text":"هذا اختبار مصطنع للمونتاج فقط"}
    return {"job_id":"germanypilot01","provider_policy":"FREE_ONLY",
            "publish_intent":False,"title":"Germany test only",
            "country":"Germany","language":"ar","duration_seconds":2,
            "narration_file":"voice.wav","scenes":[s("scene1.mp4"),s("scene2.mp4")]}

class Contract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        for name in ("scene1.mp4","scene2.mp4","voice.wav"):
            (self.root/name).write_bytes(b"x"*128)
    def tearDown(self):self.temp.cleanup()
    def test_validation_accepts_rights_ledger(self):
        self.assertEqual(doc.validate(sample(),self.root)["job_id"],"germanypilot01")
    def test_refuses_paid_and_publishing(self):
        for key,value in (("publish_intent",True),("provider_policy","GOOGLE_FLOW")):
            p=sample();p[key]=value
            with self.assertRaisesRegex(doc.DocumentaryBlocked,"ZERO_SPEND_AND_PUBLISH_LOCK_REQUIRED"):
                doc.validate(p,self.root)
    def test_refuses_missing_rights(self):
        p=sample();p["scenes"][0].pop("license_evidence_url")
        with self.assertRaisesRegex(doc.DocumentaryBlocked,"SCENE_EVIDENCE_MISSING"):
            doc.validate(p,self.root)
    def test_refuses_unverified_place(self):
        p=sample();p["scenes"][0]["location_verification_url"]=""
        with self.assertRaises(doc.DocumentaryBlocked):doc.validate(p,self.root)
    def test_refuses_mismatched_total(self):
        p=sample();p["duration_seconds"]=10
        with self.assertRaisesRegex(doc.DocumentaryBlocked,"SCENE_TOTAL_DURATION_MISMATCH"):
            doc.validate(p,self.root)
    def test_refuses_path_escape(self):
        p=sample();p["scenes"][0]["file"]="../../etc/passwd"
        with self.assertRaises(doc.DocumentaryBlocked):doc.validate(p,self.root)
    def test_refuses_unlicensed_music(self):
        p=sample();p["music"]={"file":"music.wav","license":"UNKNOWN"}
        with self.assertRaisesRegex(doc.DocumentaryBlocked,"MUSIC_RIGHTS_MISSING"):
            doc.validate(p,self.root)

@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),"FFmpeg unavailable")
class OfflineMediaSmoke(unittest.TestCase):
    def test_real_h264_aac_proof_without_external_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for idx,color in ((1,"navy"),(2,"teal")):
                subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
                    "-f","lavfi","-i",f"color=c={color}:s=320x180:r=12:d=1.1",
                    "-c:v","libx264","-pix_fmt","yuv420p",
                    str(root/f"scene{idx}.mp4")],check=True,timeout=35)
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
                "-f","lavfi","-i","sine=frequency=280:duration=1.7",
                "-ac","1","-ar","48000",str(root/"voice.wav")],check=True,timeout=35)
            # Fast low-resolution CI proof. Production defaults 1920x1080.
            doc.WIDTH=640
            doc.HEIGHT=360
            doc.FRAME_RATE=12
            result=doc.compose(sample(),root,root/"out")
            self.assertEqual(result["status"],"READY_FOR_OWNER_REVIEW")
            self.assertFalse(result["published"])
            self.assertEqual(result["google_flow_credits_used"],0)
            self.assertEqual(result["width"],640)
            self.assertTrue((root/"out"/"documentary_review.mp4").exists())
            self.assertEqual(len(result["rights_ledger"]),2)
            self.assertEqual(len(result["sha256"]),64)

if __name__=="__main__":unittest.main()
