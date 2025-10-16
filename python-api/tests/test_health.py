from starlette.testclient import TestClient
import sys, pathlib

# Ajout du chemin python-api pour import 'app'
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.append(str(root))
from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "time" in data
    assert data["app_version"] == "0.1.0"
