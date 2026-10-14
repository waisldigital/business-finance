"""Shared pytest fixtures.

In-process tests run the real FastAPI app against an in-memory MongoDB (mongomock-motor), so they need no
server, network or database. The older suites (``LIVE_SUITES``) call a running deployment over HTTP; they are
collected only when ``REACT_APP_BACKEND_URL`` points at one.
"""
import os
import sys

import pytest

LIVE_SUITES = ["test_core.py", "test_phase2.py", "test_phase3_settings.py", "test_pipeline_iter6.py",
               "test_pipeline_iter7.py", "test_sap_iter3.py", "test_sap_iter5.py"]
collect_ignore = [] if os.environ.get("REACT_APP_BACKEND_URL") else LIVE_SUITES

ADMIN_EMAIL = "admin@finsight-test.com"
ADMIN_PASSWORD = "Adm1n!pass-test"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="session")
def app(tmp_path_factory):
    os.environ["UPLOAD_ROOT"] = str(tmp_path_factory.mktemp("uploads"))
    os.environ.update(MONGO_URL="mongodb://localhost:27017", DB_NAME="finsight_test", JWT_SECRET="t" * 48,
                      ADMIN1_EMAIL=ADMIN_EMAIL, ADMIN1_PASSWORD=ADMIN_PASSWORD, FILE_STORAGE="local",
                      CORS_ORIGINS="http://localhost:3000", ENV="test", FX_AUTO_FETCH="false")
    import mongomock_motor
    import motor.motor_asyncio
    client = mongomock_motor.AsyncMongoMockClient()
    motor.motor_asyncio.AsyncIOMotorClient = lambda *a, **k: client
    import server
    return server.app


@pytest.fixture(scope="session")
def client(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c


def login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def make_user(client, admin):
    """Create a workspace user with a role granting the given section permissions; returns auth headers."""
    n = {"i": 0}

    def _make(permissions, **extra):
        n["i"] += 1
        i = n["i"]
        role = client.post("/api/roles", headers=admin, json={"name": f"Test role {i}", "permissions": permissions, **extra})
        assert role.status_code == 200, role.text
        email, pwd = f"user{i}@finsight-test.com", "Us3r!pass-test"
        r = client.post("/api/employees", headers=admin, json={
            "employee_no": f"T{i:03d}", "employee_name": f"Test User {i}", "email_id": email, "password": pwd,
            "workspace_role_id": role.json()["id"], "department": extra.pop("department", None) or "Finance"})
        assert r.status_code == 200, r.text
        return login(client, email, pwd)
    return _make
