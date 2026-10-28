"""FastAPI queue contract: mock-only, no real Drive/Render/Gemini requests."""
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException

RUNNER=Path(__file__).resolve().parents[1]/"runner"
sys.path.insert(0,str(RUNNER))
spec=importlib.util.spec_from_file_location("omda_documentary_api",RUNNER/"api.py")
api=importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

FOLDER="11GaLY8grDizEbpsHBxwieOobg5KDRvZ2"
REF={"drive_file_id":"safeDriveFile123","drive_sha256":"a"*64}
def fixture():
    scenes=[{**REF,"duration_seconds":60,"place_name":"Zugspitze, Germany",
             "source_url":"https://example.com/footage",
             "license":"CC0-1.0",
             "license_evidence_url":"https://example.com/license",
             "location_verification_url":"https://example.com/location",
             "narration_text":"في جبال الألب نرى مشهداً موثقاً"} for _ in range(2)]
    return {"job_id":"germanypilot01","folder_id":FOLDER,
            "title":"German Alpine test","country":"Germany",
            "language":"ar","duration_seconds":120,"provider_policy":"FREE_ONLY",
            "publish_intent":False,"scenes":scenes,
            "narration":dict(REF),"idempotency_key":"germany-unique-pilot-2026"}

class ApiTests(unittest.TestCase):
    def setUp(self):
        api.JOBS.clear()
        api.KEYS.clear()
    def tearDown(self):
        api.JOBS.clear()
        api.KEYS.clear()
    def test_germany_120_second_accepted_before_download(self):
        data=fixture()
        self.assertIs(api.validate_job(data),data)
    def test_no_paid_or_publishing(self):
        for k,v in [("provider_policy","FLOW"),("publish_intent",True)]:
            d=fixture();d[k]=v
            with self.assertRaisesRegex(api.DocumentaryBlocked,"PAID_OR_PUBLISH_DENIED"):
                api.validate_job(d)
    def test_refuses_unverified_location(self):
        d=fixture();d["scenes"][1]["location_verification_url"]=""
        with self.assertRaisesRegex(api.DocumentaryBlocked,"SCENE_EVIDENCE_MISSING"):
            api.validate_job(d)
    def test_refuses_bad_asset_reference(self):
        d=fixture();d["scenes"][0]["drive_sha256"]="../../"
        with self.assertRaisesRegex(api.DocumentaryBlocked,"DRIVE_ASSET_HASH_INVALID"):
            api.validate_job(d)
    def test_missing_auth_fails_closed(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(HTTPException) as context:
                api.ensure_auth("Bearer anything")
            self.assertEqual(context.exception.status_code,503)
        with patch.dict(os.environ,{"OMDA_DOC_RUNNER_TOKEN":"x"*40}):
            with self.assertRaises(HTTPException) as context:
                api.ensure_auth("Bearer wrong")
            self.assertEqual(context.exception.status_code,401)
    def test_create_queue_is_idempotent_and_never_dispatches_in_test(self):
        payload=fixture()
        with patch.dict(os.environ,{"OMDA_DOC_RUNNER_TOKEN":"x"*40}):
            with patch.object(api.POOL,"submit") as submit:
                a=api.create_documentary(payload,authorization="Bearer "+"x"*40)
                b=api.create_documentary(payload,authorization="Bearer "+"x"*40)
                self.assertEqual(a["job_id"],payload["job_id"])
                self.assertEqual(a["job_id"],b["job_id"])
                self.assertFalse(a["published"])
                submit.assert_called_once()
                row=api.get_documentary(payload["job_id"],authorization="Bearer "+"x"*40)
                self.assertEqual(row["state"],"QUEUED")
                self.assertNotIn("fingerprint",row)
                altered=fixture();altered["title"]="Different same idempotency key"
                with self.assertRaises(HTTPException) as context:
                    api.create_documentary(altered,authorization="Bearer "+"x"*40)
                self.assertEqual(context.exception.status_code,409)
    def test_no_youtube_or_paid_provider_code(self):
        source=(RUNNER/"api.py").read_text()
        self.assertNotIn("youtube.googleapis.com",source)
        self.assertNotIn("flow.google",source)
        self.assertNotIn("api.openai.com",source)

if __name__=="__main__":unittest.main()
