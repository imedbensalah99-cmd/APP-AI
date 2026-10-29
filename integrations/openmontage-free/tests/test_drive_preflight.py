"""Step 2 Google Drive preflight tests: no real OAuth, network or uploads."""
import importlib.util
import io
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "storage"))
from drive_preflight import storage_preflight
from drive_storage import TOKEN_URL, FILE_ROOT

FOLDER = "1h4wLxv0a5cH3_9iyN3juwOzB4yG1Wnlw"
ENV = {
    "OMDA_DRIVE_CLIENT_ID": "test-client",
    "OMDA_DRIVE_CLIENT_SECRET": "test-secret",
    "OMDA_DRIVE_REFRESH_TOKEN": "test-refresh",
    "OMDA_DRIVE_QA_FOLDER_ID": FOLDER
}
class Reply(io.BytesIO):
    def __init__(self, text):
        super().__init__(text.encode("utf-8"))

class FakeGoogle:
    def __init__(self, can_write=True, wrong_folder=False, revoked=False):
        self.calls = []
        self.can_write = can_write
        self.wrong_folder = wrong_folder
        self.revoked = revoked
    def __call__(self, req, timeout=45):
        self.calls.append((req.get_method(), req.full_url))
        if req.full_url == TOKEN_URL:
            if self.revoked:
                raise HTTPError(req.full_url, 400, "invalid_grant", {}, None)
            return Reply('{"access_token":"long-sample-token-for-test-only"}')
        if req.full_url.startswith(FILE_ROOT + "/" + FOLDER + "?"):
            import json
            return Reply(json.dumps({
                "id": "some_other_folder" if self.wrong_folder else FOLDER,
                "mimeType": "application/vnd.google-apps.folder",
                "trashed": False,
                "capabilities": {"canAddChildren": self.can_write}
            }))
        raise AssertionError("Unexpected network: " + req.full_url)

class PreflightTests(unittest.TestCase):
    def test_missing_auth_fails_before_network(self):
        fake = FakeGoogle()
        result = storage_preflight(env={}, opener=fake)
        self.assertFalse(result["storage_ready"])
        self.assertEqual(result["reason"], "DRIVE_OAUTH_REQUIRED")
        self.assertEqual(fake.calls, [])
    def test_folder_id_required_when_token_configured(self):
        fake = FakeGoogle()
        config = {k:v for k,v in ENV.items() if k!="OMDA_DRIVE_QA_FOLDER_ID"}
        result = storage_preflight(env=config, opener=fake)
        self.assertEqual(result["reason"], "DRIVE_QA_FOLDER_REQUIRED")
        self.assertEqual(fake.calls, [])
    def test_valid_authorized_folder_is_reported_ready(self):
        fake = FakeGoogle()
        result = storage_preflight(env=ENV, opener=fake)
        self.assertTrue(result["storage_ready"])
        self.assertTrue(result["folder_verified"])
        self.assertTrue(result["can_write"])
        self.assertEqual(result["reason"], "READY_FOR_SAFE_STORAGE_TEST")
        self.assertEqual([x[0] for x in fake.calls], ["POST","GET"])
        self.assertTrue(all("drive/v3/files" in x[1] or x[1] == TOKEN_URL for x in fake.calls))
    def test_not_writable_folder_fails_closed(self):
        fake = FakeGoogle(can_write=False)
        result = storage_preflight(env=ENV, opener=fake)
        self.assertTrue(result["folder_verified"])
        self.assertFalse(result["storage_ready"])
        self.assertEqual(result["reason"], "DRIVE_FOLDER_NOT_WRITABLE")
    def test_wrong_folder_fails_closed(self):
        fake = FakeGoogle(wrong_folder=True)
        result = storage_preflight(env=ENV, opener=fake)
        self.assertFalse(result["storage_ready"])
        self.assertEqual(result["reason"], "DRIVE_FOLDER_METADATA_INVALID")
    def test_revoked_oauth_fails_without_secret_exposure(self):
        fake = FakeGoogle(revoked=True)
        result = storage_preflight(env=ENV, opener=fake)
        self.assertEqual(result["reason"], "DRIVE_OAUTH_OR_FOLDER_UNAVAILABLE")
        self.assertFalse(result["storage_ready"])
        self.assertNotIn("test-refresh", repr(result))
    def test_no_upload_or_modify_requests(self):
        fake = FakeGoogle()
        storage_preflight(env=ENV, opener=fake)
        self.assertFalse(any(x[0] in ("PUT","PATCH","DELETE") for x in fake.calls))
        self.assertEqual(len(fake.calls), 2)
