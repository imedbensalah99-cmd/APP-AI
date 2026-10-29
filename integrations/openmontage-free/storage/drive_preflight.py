"""OMDA Google Drive staging storage preflight (read-only, zero-media).

Requires separately consented server OAuth settings, never ChatGPT's connector
tokens. Only Google Drive folder metadata is retrieved. No files are created,
modified, deleted or published by this module.
"""
from __future__ import annotations
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from drive_storage import StorageBlocked, access_token, _folder, _request, _read_json, FILE_ROOT

OAUTH_KEYS = ("OMDA_DRIVE_CLIENT_ID", "OMDA_DRIVE_CLIENT_SECRET",
              "OMDA_DRIVE_REFRESH_TOKEN")
FOLDER_MIME = "application/vnd.google-apps.folder"

def storage_preflight(*, env=None, opener=urlopen) -> dict:
    env = os.environ if env is None else env
    if not all(isinstance(env.get(k), str) and env[k] for k in OAUTH_KEYS):
        return {"drive_oauth_configured": False, "folder_verified": False,
                "can_write": False, "storage_ready": False,
                "reason": "DRIVE_OAUTH_REQUIRED"}
    folder_id = env.get("OMDA_DRIVE_QA_FOLDER_ID", "")
    try:
        _folder(folder_id)
    except StorageBlocked:
        return {"drive_oauth_configured": True, "folder_verified": False,
                "can_write": False, "storage_ready": False,
                "reason": "DRIVE_QA_FOLDER_REQUIRED"}
    try:
        token = access_token(opener=opener, env=env)
        url = FILE_ROOT + "/" + folder_id + "?" + urlencode({
            "fields": "id,name,mimeType,trashed,capabilities(canAddChildren)",
            "supportsAllDrives": "true"})
        metadata = _read_json(_request(opener, Request(
            url, headers={"Authorization": "Bearer " + token},
            method="GET")))
        if (metadata.get("id") != folder_id or
            metadata.get("mimeType") != FOLDER_MIME or
            metadata.get("trashed") is not False):
            return {"drive_oauth_configured": True, "folder_verified": False,
                    "can_write": False, "storage_ready": False,
                    "reason": "DRIVE_FOLDER_METADATA_INVALID"}
        can_write = metadata.get("capabilities", {}).get("canAddChildren") is True
        return {"drive_oauth_configured": True, "folder_verified": True,
                "can_write": can_write, "storage_ready": can_write,
                "reason": "READY_FOR_SAFE_STORAGE_TEST" if can_write
                          else "DRIVE_FOLDER_NOT_WRITABLE"}
    except StorageBlocked:
        return {"drive_oauth_configured": True, "folder_verified": False,
                "can_write": False, "storage_ready": False,
                "reason": "DRIVE_OAUTH_OR_FOLDER_UNAVAILABLE"}
    except Exception:
        return {"drive_oauth_configured": True, "folder_verified": False,
                "can_write": False, "storage_ready": False,
                "reason": "DRIVE_PREFLIGHT_UNAVAILABLE"}
