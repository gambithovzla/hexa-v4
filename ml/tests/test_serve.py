"""End-to-end FastAPI smoke tests using the TestClient."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hexa_ml.config import reset_settings_for_tests
from hexa_ml.predict import reset_registry_for_tests


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Spin up the app pointed at an empty artifacts dir, no auth."""
    monkeypatch.setenv("HEXA_ML_INTERNAL_TOKEN", "")  # disable auth
    monkeypatch.chdir(tmp_path)
    (tmp_path / "artifacts").mkdir()

    reset_settings_for_tests()
    reset_registry_for_tests()

    # Import after env tweak so Settings picks up the override
    from hexa_ml.serve import app

    return TestClient(app)


def test_health_returns_ok(client: TestClient):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["models_available"] == []


def test_predict_without_artifact_returns_503(client: TestClient):
    res = client.post(
        "/predict/moneyline",
        json={"home_pitcher_xwoba": 0.300, "away_pitcher_xwoba": 0.330},
    )
    assert res.status_code == 503


def test_auth_required_when_token_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("HEXA_ML_INTERNAL_TOKEN", "secret-token-xyz")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "artifacts").mkdir()
    reset_settings_for_tests()
    reset_registry_for_tests()

    from hexa_ml.serve import app

    client = TestClient(app)

    # /health stays open
    assert client.get("/health").status_code == 200

    # /predict/* requires bearer
    no_auth = client.post(
        "/predict/moneyline",
        json={"home_pitcher_xwoba": 0.300},
    )
    assert no_auth.status_code == 401

    bad_auth = client.post(
        "/predict/moneyline",
        json={"home_pitcher_xwoba": 0.300},
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert bad_auth.status_code == 401

    # Correct token routes past auth — fails downstream with 503 (no model trained)
    with_auth = client.post(
        "/predict/moneyline",
        json={"home_pitcher_xwoba": 0.300},
        headers={"Authorization": "Bearer secret-token-xyz"},
    )
    assert with_auth.status_code == 503
