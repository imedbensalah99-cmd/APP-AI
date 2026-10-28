"""No-network storage contract tests. No OAuth or billable API calls."""
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

MOD = Path(__file__).resolve().parents[1] / "storage" / "drive_storage.py"
spec = importlib.util.spec_from_file_location("omda_drive_storage", MOD)
drive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drive)

FOLDER = "11GaLY8grDizEbpsHBxwieOobg5KDRvZ2"
ENV = {"OMDA_DRIVE_CLIENT_ID": "unit-test",
       "OMDA_DRIVE_CLIENT_SECRET": "not-a-real-secret",
       "OMDA_DRIVE_REFRESH_TOKEN": "unit-test-only"}


class Reply(io.BytesIO):
    def __init__(self, status=200, body=b"{}", headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {}
    def getcode(self): return self.status


class FakeGoogle:
    def __init__(self, filename, md5_ok=True, trusted=True):
        self.seq = []
        self.filename = filename
        self.md5_ok = md5_ok
        self.trusted = trusted
    def __call__(self, request, timeout=45):
        url = request.full_url
        self.seq.append((request.get_method(), url))
        if url == drive.TOKEN_URL:
            return Reply(body=b'{"access_token":"unit-test-access-token-long-value"}')
        if url.startswith(drive.UPLOAD_ROOT+"?"):
            base = "https://www.googleapis.com" if self.trusted else "https://attacker.test"
            return Reply(headers={"Location": base+"/upload/drive/v3/files?upload_id=unit"})
        if "upload_id=unit" in url:
            assert request.get_method() == "PUT"
            assert request.get_header("Content-range") == f"bytes 0-{self.filename.stat().st_size-1}/{self.filename.stat().st_size}"
            return Reply(200, b'{"id":"safeDriveFile123"}')
        if url.startswith(drive.FILE_ROOT+"/safeDriveFile123?"):
            md5 = drive.digest_file(self.filename)["md5"] if self.md5_ok else "0000"
            data = ('{"id":"safeDriveFile123","size":"%s","md5Checksum":"%s","parents":["%s"]}' %
                    (self.filename.stat().st_size, md5, FOLDER)).encode()
            return Reply(200, data)
        raise AssertionError("Unexpected endpoint: "+url)


class DriveStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name)/"germany_manifest.json"
        self.file.write_text('{"scenes":[]}', encoding="utf-8")
    def tearDown(self): self.tmp.cleanup()
    def test_unconfigured_fails_before_network(self):
        with self.assertRaisesRegex(drive.StorageBlocked, "DRIVE_OAUTH_NOT_CONFIGURED"):
            drive.upload_verified(self.file, folder_id=FOLDER, job_id="germany-001",
                                 kind="manifest", env={}, opener=lambda *_a, **_k: 1)
    def test_success_requires_readback_and_hash(self):
        fake = FakeGoogle(self.file)
        result = drive.upload_verified(self.file, folder_id=FOLDER, job_id="germany-001",
                                       kind="manifest", env=ENV, opener=fake)
        self.assertTrue(result["verified"])
        self.assertEqual(result["sha256"], drive.digest_file(self.file)["sha256"])
        self.assertFalse(result["published"])
        self.assertEqual([x[0] for x in fake.seq], ["POST", "POST", "PUT", "GET"])
    def test_refuses_untrusted_session_domain(self):
        fake = FakeGoogle(self.file, trusted=False)
        with self.assertRaisesRegex(drive.StorageBlocked, "DRIVE_SESSION_UNTRUSTED"):
            drive.upload_verified(self.file, folder_id=FOLDER, job_id="germany-001",
                                 kind="manifest", env=ENV, opener=fake)
        self.assertEqual(len(fake.seq), 2)
    def test_checksum_failure_is_not_success(self):
        fake = FakeGoogle(self.file, md5_ok=False)
        with self.assertRaisesRegex(drive.StorageBlocked, "DRIVE_READBACK_MISMATCH"):
            drive.upload_verified(self.file, folder_id=FOLDER, job_id="germany-001",
                                 kind="manifest", env=ENV, opener=fake)
    def test_bad_kind_and_folder_rejected_early(self):
        for key, folder in [("paid_video", FOLDER), ("video", "../escaped")]:
            with self.assertRaises(drive.StorageBlocked):
                drive.upload_verified(self.file, folder_id=folder, job_id="germany-001",
                                     kind=key, env=ENV)
    def test_invalid_job_id_rejected(self):
        with self.assertRaisesRegex(drive.StorageBlocked, "DRIVE_JOB_ID_INVALID"):
            drive.upload_verified(self.file, folder_id=FOLDER, job_id="../../file",
                                 kind="manifest", env=ENV)
    def test_no_delete_or_publish_paths(self):
        source = MOD.read_text()
        self.assertNotIn('method="DELETE"', source)
        self.assertNotIn('"youtube.googleapis.com"', source)


if __name__ == "__main__": unittest.main()
