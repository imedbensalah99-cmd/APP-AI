"""Contract regressions: zero paid calls, no publishing, no SSRF, no unauth jobs."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from api import app, JobRequest, make_payload, safe_file_url

client = TestClient(app)

def sample(**changes):
    raw = dict(title="رسالة مجهولة من الماضي",
               script="هذه قصة غامضة عن رسالة وصلت بعد عشرين عاما. " * 10,
               terms=["letter", "old house", "mystery"],
               idempotency_key="omda-probe-000001", duration_seconds=60,
               language="ar", publish_intent=False, provider_policy="FREE_ONLY")
    raw.update(changes)
    return raw

def test_health_no_paid_no_publish():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["target_seconds"] == 60
    assert data["publishing"] is False
    assert data["paid_generation"] is False

def test_authentication_required(monkeypatch):
    monkeypatch.setenv("OMDA_MPT_BRIDGE_TOKEN", "x" * 40)
    response = client.post("/v1/mpt/jobs", json=sample())
    assert response.status_code == 401
    assert client.get("/v1/mpt/auth/check").status_code == 401

def test_generation_off_by_default(monkeypatch):
    monkeypatch.setenv("OMDA_MPT_BRIDGE_TOKEN", "x" * 40)
    monkeypatch.delenv("OMDA_MPT_ENABLE_JOBS", raising=False)
    response = client.post("/v1/mpt/jobs", json=sample(),
                           headers={"Authorization": "Bearer " + "x" * 40})
    assert response.status_code == 503
    assert response.json()["detail"] == "GENERATION_DISABLED"

@pytest.mark.parametrize("change", [
    {"publish_intent": True}, {"provider_policy": "PAID"},
    {"duration_seconds": 30}, {"language": "en"}])
def test_reject_policy_change(change):
    with pytest.raises(HTTPException) as exc:
        make_payload(JobRequest(**sample(**change)))
    assert exc.value.status_code == 400

def test_upstream_is_real_moneyprinter_request():
    body = make_payload(JobRequest(**sample()))
    assert body["video_source"] == "pexels"
    assert body["video_aspect"] == "9:16"
    assert body["video_count"] == 1
    assert body["video_script"]
    assert body["voice_name"].startswith("ar-")
    assert "publish" not in body

@pytest.mark.parametrize("url", [
    "https://other.example/tasks/a.mp4",
    "http://engine.example/tasks/a.mp4",
    "https://engine.example@other.example/tasks/a.mp4",
    "https://engine.example/admin/a.mp4",
    "https://engine.example/tasks/a.mp4#fragment"])
def test_reject_dangerous_output_urls(url):
    with pytest.raises(ValueError):
        safe_file_url(url, "https://engine.example")

def test_relative_artifact_path():
    assert safe_file_url("/tasks/a.mp4", "https://engine.example") == "https://engine.example/tasks/a.mp4"
