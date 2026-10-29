"""Owner-triggered safe Google Drive upload and complete byte readback.

The test writes a small, original JSON fixture inside the dedicated OMDA QA
folder, never modifies existing files, never deletes files and never publishes.
Requires separately authorized Render OAuth and a folder with write rights.
"""
from __future__ import annotations
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

from drive_preflight import storage_preflight
from drive_storage import StorageBlocked, digest_file, download_verified, upload_verified

def storage_smoke(*, env=None, opener=None) -> dict:
    env = os.environ if env is None else env
    # Inject opener for deterministic tests; never copy/surface secrets.
    opts = {"opener": opener} if opener is not None else {}
    gate = storage_preflight(env=env, **opts)
    if not gate["storage_ready"]:
        raise StorageBlocked(gate["reason"])
    folder = env["OMDA_DRIVE_QA_FOLDER_ID"]
    job_id = "omdastorage" + uuid.uuid4().hex[:16]
    data = {
        "schema": "OMDA_DRIVE_SMOKE_V1",
        "id": job_id,
        "purpose": "Explicit owner-triggered Drive storage verification only",
        "origin": "OMDA private Render staging",
        "media_generated": False,
        "published": False,
        "paid_generation": False
    }
    with tempfile.TemporaryDirectory(prefix="omda_drive_smoke_") as root:
        src = Path(root) / "omda_storage_probe.json"
        src.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
        expected = digest_file(src)
        up = upload_verified(src, folder_id=folder, job_id=job_id,
                             kind="manifest", env=env, **opts)
        read_dir = Path(root) / "verified_readback"
        read_dir.mkdir(mode=0o700)
        downloaded = download_verified(up["file_id"], folder_id=folder,
                        job_id=job_id, kind="manifest",
                        workspace=read_dir, expected_sha256=expected["sha256"],
                        env=env, **opts)
        if Path(downloaded["path"]).read_bytes() != src.read_bytes():
            raise StorageBlocked("DRIVE_SMOKE_READBACK_MISMATCH")
        return {
            "verified": True,
            "job_id": job_id,
            "file_id": up["file_id"],
            "sha256": expected["sha256"],
            "bytes": expected["bytes"],
            "folder_id": folder,
            "published": False,
            "paid_generation": False
        }
