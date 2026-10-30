"""Fail-closed policy checks for the direct (not proxy) MPT Render runner."""
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import direct

client = TestClient(direct.app)


class TestDirectMPT(unittest.TestCase):
    def test_health_identifies_real_local_engine(self):
        data = client.get("/health").json()
        self.assertEqual(data["mode"], "DIRECT_MONEYPRINTERTURBO_ON_RENDER")
        self.assertFalse(data["publishing_enabled"])
        self.assertFalse(data["drive_connected"])

    def test_no_secret_does_not_accept_jobs(self):
        with patch.dict(os.environ, {"OMDA_MPT_DIRECT_TOKEN": ""}):
            r = client.post("/v1/jobs", json={})
        self.assertEqual(r.status_code, 503)

    def test_bad_token_is_rejected_before_parsing_body(self):
        with patch.dict(os.environ, {"OMDA_MPT_DIRECT_TOKEN": "z" * 40}):
            r = client.post("/v1/jobs", data="invalid", headers={"Authorization": "Bearer bad"})
        self.assertEqual(r.status_code, 401)

    def test_disallow_paid_and_publish(self):
        valid = dict(title="A beautiful documentary", script="a" * 120,
                     terms=["Berlin city", "German forest", "Rhine river"],
                     idempotency_key="unique-test-123",
                     duration_seconds=60, language="ar", provider_policy="FREE_ONLY",
                     publish_intent=False)
        with patch.dict(os.environ, {"OMDA_MPT_DIRECT_TOKEN": "z" * 40}):
            for wrong in ({"publish_intent": True}, {"provider_policy": "PAID"},
                          {"duration_seconds": 30}, {"video_source": "wavespeed"}):
                r = client.post("/v1/jobs", json={**valid, **wrong},
                                headers={"Authorization": "Bearer " + "z" * 40})
                self.assertEqual(r.status_code, 422)

    def test_disabled_does_not_render_or_charge(self):
        data = dict(title="A beautiful documentary", script="a" * 120,
                    terms=["Berlin city", "German forest", "Rhine river"],
                    idempotency_key="unique-test-123")
        with patch.dict(os.environ, {"OMDA_MPT_DIRECT_TOKEN": "z" * 40,
                                     "OMDA_MPT_ENABLE_JOBS": "0"}):
            r = client.post("/v1/jobs", json=data,
                            headers={"Authorization": "Bearer " + "z" * 40})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["detail"], "GENERATION_DISABLED")

    def test_english_terms_required(self):
        body = direct.VideoRequest(title="A documentary title", script="a" * 120,
                                   terms=["بحر", "forest", "desert"],
                                   idempotency_key="unique-test-123")
        with self.assertRaises(direct.HTTPException):
            direct.validate_request(body)


if __name__ == "__main__":
    unittest.main()
