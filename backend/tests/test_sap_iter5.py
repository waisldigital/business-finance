"""Iteration 5 – SAP import batch_id + Undo last import endpoints.
Tests cover:
- POST /api/projects/{pid}/sap-upload returns batch_id, rows persist with import_batch_id+import_source.
- GET  /api/projects/{pid}/sap-last-import?kind=revenue|cost (has_batch toggling).
- POST /api/projects/{pid}/sap-undo-last?kind=... deletes only that batch and is idempotent (404 second time).
- Regression: parse-pdf, parse-excel, customer delete-guard, sap template download.
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SAP_FILE = "/tmp/sap_test.xlsx"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    r = sess.post(f"{BASE_URL}/api/auth/login",
                  json={"email": "admin@crackerpro.com", "password": "Admin@123"})
    assert r.status_code == 200, r.text
    sess.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return sess


@pytest.fixture(scope="session")
def airside_pid(s):
    r = s.get(f"{BASE_URL}/api/projects?search=Smart Airside")
    assert r.status_code == 200
    rows = r.json()
    assert rows, "Seed project Smart Airside Gate Solution missing"
    return rows[0]["id"]


@pytest.fixture(scope="session")
def xlsx_bytes():
    with open(SAP_FILE, "rb") as f:
        return f.read()


def _upload(s, pid, kind, xlsx):
    return s.post(f"{BASE_URL}/api/projects/{pid}/sap-upload?kind={kind}",
                  files={"file": ("t.xlsx", xlsx, XLSX_MIME)})


def _last(s, pid, kind):
    return s.get(f"{BASE_URL}/api/projects/{pid}/sap-last-import?kind={kind}")


def _undo(s, pid, kind):
    return s.post(f"{BASE_URL}/api/projects/{pid}/sap-undo-last?kind={kind}")


# ---------- ensure clean state for both kinds ----------
@pytest.fixture(scope="session", autouse=True)
def _drain_existing(s, airside_pid):
    """Drain any pre-existing un-undone batches before tests run so counts are deterministic."""
    for kind in ("revenue", "cost"):
        for _ in range(20):
            r = _last(s, airside_pid, kind)
            if r.status_code == 200 and r.json().get("has_batch"):
                _undo(s, airside_pid, kind)
            else:
                break
    yield


# ---------- new endpoints: revenue ----------
class TestSapUndoRevenue:
    def test_initial_no_batch(self, s, airside_pid):
        r = _last(s, airside_pid, "revenue")
        assert r.status_code == 200
        assert r.json() == {"has_batch": False}

    def test_undo_when_no_batch_returns_404(self, s, airside_pid):
        r = _undo(s, airside_pid, "revenue")
        assert r.status_code == 404
        assert "no sap" in r.json()["detail"].lower()

    def test_upload_returns_batch_id_and_persists(self, s, airside_pid, xlsx_bytes):
        r = _upload(s, airside_pid, "revenue", xlsx_bytes)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("matched", "imported", "skipped", "wbs", "kind", "batch_id"):
            assert k in j, f"missing {k} in {j}"
        assert j["kind"] == "revenue"
        assert isinstance(j["batch_id"], str) and len(j["batch_id"]) > 0
        assert j["imported"] >= 1, "Expected at least one revenue row matched for WSIN.000136"
        # rows should carry the batch_id and import_source via the GET endpoint
        last = _last(s, airside_pid, "revenue").json()
        assert last["has_batch"] is True
        assert last["batch_id"] == j["batch_id"]
        assert last["rows"] == j["imported"]
        for k in ("uploaded_at", "uploaded_by", "file_name"):
            assert k in last and last[k]

    def test_undo_deletes_only_that_batch(self, s, airside_pid):
        last = _last(s, airside_pid, "revenue").json()
        assert last["has_batch"] is True
        bid = last["batch_id"]
        rows_before = s.get(f"{BASE_URL}/api/projects/{airside_pid}/revenue").json()
        before_count = len(rows_before)
        batch_rows = last["rows"]

        r = _undo(s, airside_pid, "revenue")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["kind"] == "revenue"
        assert j["batch_id"] == bid
        assert j["deleted"] == batch_rows

        rows_after = s.get(f"{BASE_URL}/api/projects/{airside_pid}/revenue").json()
        # Only the batch's rows are deleted; pre-existing manual rows preserved.
        assert len(rows_after) == before_count - batch_rows
        # GET returns has_batch:false now
        assert _last(s, airside_pid, "revenue").json() == {"has_batch": False}

    def test_undo_idempotent_404(self, s, airside_pid):
        r = _undo(s, airside_pid, "revenue")
        assert r.status_code == 404


# ---------- new endpoints: cost ----------
class TestSapUndoCost:
    def test_initial_no_batch(self, s, airside_pid):
        r = _last(s, airside_pid, "cost")
        assert r.status_code == 200
        assert r.json() == {"has_batch": False}

    def test_upload_then_undo_round_trip(self, s, airside_pid, xlsx_bytes):
        up = _upload(s, airside_pid, "cost", xlsx_bytes)
        assert up.status_code == 200, up.text
        j = up.json()
        assert j["kind"] == "cost"
        assert "batch_id" in j and j["batch_id"]
        bid = j["batch_id"]

        last = _last(s, airside_pid, "cost").json()
        assert last["has_batch"] is True
        assert last["batch_id"] == bid
        assert last["rows"] == j["imported"]

        # undo
        un = _undo(s, airside_pid, "cost")
        assert un.status_code == 200, un.text
        assert un.json()["batch_id"] == bid
        assert un.json()["kind"] == "cost"
        assert un.json()["deleted"] == j["imported"]
        assert _last(s, airside_pid, "cost").json() == {"has_batch": False}

        # second undo -> 404
        again = _undo(s, airside_pid, "cost")
        assert again.status_code == 404


# ---------- multi-batch isolation ----------
class TestMultiBatchIsolation:
    def test_two_batches_only_latest_undone(self, s, airside_pid, xlsx_bytes):
        # batch A
        a = _upload(s, airside_pid, "revenue", xlsx_bytes).json()
        a_id = a["batch_id"]
        # batch B
        b = _upload(s, airside_pid, "revenue", xlsx_bytes).json()
        b_id = b["batch_id"]
        assert a_id != b_id

        # Last should report batch B
        last = _last(s, airside_pid, "revenue").json()
        assert last["batch_id"] == b_id

        # undo -> should remove only batch B rows
        un = _undo(s, airside_pid, "revenue")
        assert un.status_code == 200
        assert un.json()["batch_id"] == b_id

        # Now A should be the latest active
        last2 = _last(s, airside_pid, "revenue").json()
        assert last2["has_batch"] is True
        assert last2["batch_id"] == a_id

        # cleanup A so env is clean
        _undo(s, airside_pid, "revenue")
        assert _last(s, airside_pid, "revenue").json() == {"has_batch": False}


# ---------- input validation ----------
class TestSapUndoValidation:
    def test_invalid_kind_rejected(self, s, airside_pid):
        r = _last(s, airside_pid, "bogus")
        assert r.status_code == 422
        r2 = _undo(s, airside_pid, "bogus")
        assert r2.status_code == 422

    def test_unknown_project_undo_404(self, s):
        r = _undo(s, "does-not-exist", "revenue")
        assert r.status_code == 404

    def test_unauth_blocked(self, airside_pid):
        r = requests.get(f"{BASE_URL}/api/projects/{airside_pid}/sap-last-import?kind=revenue")
        assert r.status_code in (401, 403)
        r2 = requests.post(f"{BASE_URL}/api/projects/{airside_pid}/sap-undo-last?kind=revenue")
        assert r2.status_code in (401, 403)


# ---------- regressions from iter4 ----------
class TestRegression:
    def test_template_download(self, s):
        r = s.get(f"{BASE_URL}/api/uploads/template/sap-transactions")
        assert r.status_code == 200
        assert len(r.content) > 1000

    def test_parse_excel_with_wbs(self, s, xlsx_bytes):
        r = s.post(f"{BASE_URL}/api/projects/parse-excel?wbs=WSIN.000136",
                   files={"file": ("t.xlsx", xlsx_bytes, XLSX_MIME)})
        assert r.status_code == 200
        assert r.json()["parsed"]["matched"] is True

    def test_parse_pdf_rejects_non_pdf(self, s):
        r = s.post(f"{BASE_URL}/api/projects/parse-pdf",
                   files={"file": ("a.txt", b"hi", "text/plain")})
        assert r.status_code == 400

    def test_customer_delete_blocked_when_linked(self, s):
        r = s.get(f"{BASE_URL}/api/projects")
        proj = next((p for p in r.json() if p.get("customer_id")), None)
        assert proj
        d = s.delete(f"{BASE_URL}/api/customers/{proj['customer_id']}")
        assert d.status_code == 409
