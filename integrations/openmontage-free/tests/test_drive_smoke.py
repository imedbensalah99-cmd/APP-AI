"""Mock-only Drive upload+download smoke test, no real files written to Drive."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "storage"))
import drive_smoke
from drive_storage import StorageBlocked

FOLDER = "1h4wLxv0a5cH3_9iyN3juwOzB4yG1Wnlw"
ENV = {"OMDA_DRIVE_QA_FOLDER_ID": FOLDER}

class SmokeTests(unittest.TestCase):
    def test_without_oauth_no_file_or_upload(self):
        with patch.object(drive_smoke,"upload_verified") as upload:
            with self.assertRaisesRegex(StorageBlocked,"DRIVE_OAUTH_REQUIRED"):
                drive_smoke.storage_smoke(env=ENV,
                                          opener=lambda *_a,**_k: self.fail("network"))
            upload.assert_not_called()
    def test_original_fixture_uploads_and_reads_exact_bytes(self):
        transferred = {}
        def fake_upload(path, **kwargs):
            self.assertEqual(kwargs["folder_id"],FOLDER)
            self.assertEqual(kwargs["kind"],"manifest")
            self.assertEqual(kwargs["env"],ENV)
            transferred["data"] = Path(path).read_bytes()
            transferred["upload_count"] = transferred.get("upload_count",0)+1
            return {"file_id":"safeUploadedFile123","verified":True}
        def fake_download(file_id, **kwargs):
            self.assertEqual(file_id,"safeUploadedFile123")
            self.assertEqual(kwargs["folder_id"],FOLDER)
            self.assertEqual(kwargs["kind"],"manifest")
            self.assertEqual(kwargs["env"],ENV)
            destination=Path(kwargs["workspace"])/"download.json"
            destination.write_bytes(transferred["data"])
            import hashlib
            self.assertEqual(kwargs["expected_sha256"],hashlib.sha256(transferred["data"]).hexdigest())
            transferred["download_count"] = transferred.get("download_count",0)+1
            return {"path":str(destination),"verified":True}
        with patch.object(drive_smoke,"storage_preflight",return_value={"storage_ready":True}):
            with patch.object(drive_smoke,"upload_verified",side_effect=fake_upload):
                with patch.object(drive_smoke,"download_verified",side_effect=fake_download):
                    result=drive_smoke.storage_smoke(env=ENV)
        self.assertTrue(result["verified"])
        self.assertFalse(result["paid_generation"])
        self.assertFalse(result["published"])
        self.assertEqual(transferred["upload_count"],1)
        self.assertEqual(transferred["download_count"],1)
        self.assertEqual(result["bytes"],len(transferred["data"]))
        self.assertEqual(result["file_id"],"safeUploadedFile123")
        self.assertNotIn("secret",str(result).lower())
    def test_tampered_readback_fails_closed(self):
        def up(*_args,**_kwargs):
            return {"file_id":"safeUploadedFile123","verified":True}
        def down(*_args,**kwargs):
            destination=Path(kwargs["workspace"])/"download.json"
            destination.write_bytes(b"forged readback")
            return {"path":str(destination),"verified":True}
        with patch.object(drive_smoke,"storage_preflight",return_value={"storage_ready":True}):
            with patch.object(drive_smoke,"upload_verified",side_effect=up):
                with patch.object(drive_smoke,"download_verified",side_effect=down):
                    with self.assertRaisesRegex(StorageBlocked,"DRIVE_SMOKE_READBACK_MISMATCH"):
                        drive_smoke.storage_smoke(env=ENV)
