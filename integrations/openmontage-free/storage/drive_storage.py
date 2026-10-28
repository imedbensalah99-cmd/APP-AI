"""Google Drive storage for OMDA output assets.

The caller supplies a user-consented OAuth refresh token via secret environment
variables. No Drive scope is requested or broadened here. No network calls run
on import. This module never publishes or deletes files.
"""
from __future__ import annotations
import hashlib
import json
import mimetypes
import os
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

UPLOAD_ROOT = "https://www.googleapis.com/upload/drive/v3/files"
FILE_ROOT = "https://www.googleapis.com/drive/v3/files"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CHUNK_SIZE = 5 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
KINDS = {"video": "video/mp4", "narration": "audio/wav", "captions": "application/x-subrip",
         "manifest": "application/json", "quality_report": "application/json"}
class StorageBlocked(RuntimeError):
    """Fail closed with non-secret error codes only."""


def _folder(folder: str) -> str:
    if not folder or not 10 <= len(folder) <= 150 or not all(c.isalnum() or c in "-_" for c in folder):
        raise StorageBlocked("DRIVE_FOLDER_ID_INVALID")
    return folder


def _file(file_path: str | Path) -> Path:
    path = Path(file_path).resolve(strict=True)
    if not path.is_file() or path.stat().st_size < 1 or path.stat().st_size > MAX_FILE_BYTES:
        raise StorageBlocked("DRIVE_FILE_INVALID_SIZE")
    return path


def digest_file(file_path: str | Path) -> dict:
    path = _file(file_path)
    sha = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as fp:
        for block in iter(lambda: fp.read(CHUNK_SIZE), b""):
            sha.update(block)
            md5.update(block)
    return {"sha256": sha.hexdigest(), "md5": md5.hexdigest(), "bytes": path.stat().st_size}


def _read_json(response) -> dict:
    try:
        data = json.loads(response.read().decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeError):
        raise StorageBlocked("DRIVE_RESPONSE_INVALID") from None


def _request(opener: Callable, req: Request, timeout=45):
    try:
        return opener(req, timeout=timeout)
    except Exception as exc:
        # Never include an HTTP exception body or URL: they may contain secrets.
        code = getattr(exc, "code", "NETWORK")
        raise StorageBlocked("DRIVE_HTTP_" + str(code)) from None


def access_token(opener=urlopen, env=os.environ) -> str:
    keys = ("OMDA_DRIVE_CLIENT_ID", "OMDA_DRIVE_CLIENT_SECRET", "OMDA_DRIVE_REFRESH_TOKEN")
    if any(not env.get(k) for k in keys):
        raise StorageBlocked("DRIVE_OAUTH_NOT_CONFIGURED")
    payload = urlencode({"client_id": env[keys[0]], "client_secret": env[keys[1]],
                         "refresh_token": env[keys[2]], "grant_type": "refresh_token"}).encode("utf-8")
    response = _request(opener, Request(TOKEN_URL, data=payload, headers={
        "Content-Type": "application/x-www-form-urlencoded"}, method="POST"))
    data = _read_json(response)
    token = data.get("access_token")
    if not isinstance(token, str) or len(token) < 20:
        raise StorageBlocked("DRIVE_ACCESS_TOKEN_MISSING")
    return token


def upload_verified(path: str | Path, *, folder_id: str, job_id: str, kind: str,
                    opener=urlopen, env=os.environ) -> dict:
    """Upload binary media with resumable protocol and verify Drive MD5/size.

    Returns metadata ONLY after a readback. Fails closed if OAuth, folder
    permissions, session integrity, uploaded bytes or checksum fail.
    """
    file = _file(path)
    _folder(folder_id)
    if kind not in KINDS:
        raise StorageBlocked("DRIVE_KIND_INVALID")
    if not job_id or len(job_id) > 120 or not all(c.isalnum() or c in "-_" for c in job_id):
        raise StorageBlocked("DRIVE_JOB_ID_INVALID")
    proof = digest_file(file)
    token = access_token(opener, env)
    headers = {"Authorization": "Bearer " + token}
    meta = {"name": file.name, "parents": [folder_id],
            "mimeType": KINDS[kind],
            "appProperties": {"omda_job_id": job_id, "omda_kind": kind,
                              "omda_sha256": proof["sha256"]}}
    session_req = Request(UPLOAD_ROOT + "?uploadType=resumable&fields=id,name,size,md5Checksum,mimeType,parents",
                          data=json.dumps(meta).encode("utf-8"), method="POST",
                          headers={**headers, "Content-Type": "application/json; charset=UTF-8",
                                   "X-Upload-Content-Type": KINDS[kind],
                                   "X-Upload-Content-Length": str(proof["bytes"])})
    response = _request(opener, session_req)
    session_url = response.headers.get("Location", "")
    parsed = urlparse(session_url)
    if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com" or \
       not parsed.path.startswith("/upload/drive/v3/files") or parsed.username or parsed.password:
        raise StorageBlocked("DRIVE_SESSION_UNTRUSTED")
    # Google resumable sessions persist; each chunk commits a precise range.
    uploaded = 0
    final_data = None
    with file.open("rb") as fd:
        while uploaded < proof["bytes"]:
            chunk = fd.read(CHUNK_SIZE)
            if not chunk:
                raise StorageBlocked("DRIVE_FILE_CHANGED_DURING_UPLOAD")
            last = uploaded + len(chunk) - 1
            req = Request(session_url, method="PUT", data=chunk, headers={
                **headers, "Content-Type": KINDS[kind],
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {uploaded}-{last}/{proof['bytes']}"})
            answer = _request(opener, req, timeout=120)
            status = answer.getcode()
            uploaded += len(chunk)
            if uploaded < proof["bytes"]:
                if status != 308:
                    raise StorageBlocked("DRIVE_CHUNK_ACK_INVALID")
                received = answer.headers.get("Range", "")
                if received != f"bytes=0-{last}":
                    raise StorageBlocked("DRIVE_CHUNK_RANGE_INVALID")
            else:
                if status not in (200, 201):
                    raise StorageBlocked("DRIVE_FINAL_ACK_INVALID")
                final_data = _read_json(answer)
    remote_id = (final_data or {}).get("id")
    if not isinstance(remote_id, str) or not 8 <= len(remote_id) <= 150 or \
       not all(c.isalnum() or c in "-_" for c in remote_id):
        raise StorageBlocked("DRIVE_REMOTE_ID_INVALID")
    readback_req = Request(FILE_ROOT + "/" + remote_id +
                           "?fields=id,name,size,md5Checksum,mimeType,parents",
                           headers=headers, method="GET")
    verified = _read_json(_request(opener, readback_req))
    if verified.get("id") != remote_id or str(verified.get("size")) != str(proof["bytes"]) or \
       verified.get("md5Checksum") != proof["md5"] or folder_id not in verified.get("parents", []):
        raise StorageBlocked("DRIVE_READBACK_MISMATCH")
    return {"file_id": remote_id, "name": file.name, "kind": kind,
            "folder_id": folder_id, "bytes": proof["bytes"],
            "sha256": proof["sha256"], "drive_md5": proof["md5"],
            "verified": True, "published": False, "cost_usd": 0,
            "view_url": "https://drive.google.com/file/d/" + remote_id + "/view"}
