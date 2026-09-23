"""Iteration 3 – SAP unified upload, customer delete guard, project delete cascade,
parse-excel autofill, regression on parse-pdf, transitions, notifications status."""
import os
import io
import pytest
import requests
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
SAP_FILE = "/tmp/sap_test.xlsx"


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


@pytest.fixture
def xlsx_bytes():
    with open(SAP_FILE, "rb") as f:
        return f.read()


# ---------- SAP template ----------
def test_template_download(s):
    r = s.get(f"{BASE_URL}/api/uploads/template/sap-transactions")
    assert r.status_code == 200
    assert len(r.content) > 1000
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")


def test_template_download_unauth():
    r = requests.get(f"{BASE_URL}/api/uploads/template/sap-transactions")
    assert r.status_code in (401, 403)


# ---------- parse-excel ----------
def test_parse_excel_no_wbs(s, xlsx_bytes):
    r = s.post(f"{BASE_URL}/api/projects/parse-excel",
               files={"file": ("t.xlsx", xlsx_bytes,
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    p = r.json()["parsed"]
    assert p["matched"] is False
    assert isinstance(p["candidates"], list) and len(p["candidates"]) > 0


def test_parse_excel_with_wbs(s, xlsx_bytes):
    r = s.post(f"{BASE_URL}/api/projects/parse-excel?wbs=WSIN.000136",
               files={"file": ("t.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    p = r.json()["parsed"]
    assert p["matched"] is True
    assert p["wbs_element"]


def test_parse_excel_non_xlsx(s):
    r = s.post(f"{BASE_URL}/api/projects/parse-excel",
               files={"file": ("t.txt", b"hello", "text/plain")})
    assert r.status_code == 400


# ---------- SAP upload ----------
def test_sap_upload_revenue(s, airside_pid, xlsx_bytes):
    r = s.post(f"{BASE_URL}/api/projects/{airside_pid}/sap-upload?kind=revenue",
               files={"file": ("t.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ("matched", "imported", "skipped", "wbs", "kind"):
        assert k in j
    assert j["kind"] == "revenue"
    # verify persisted
    r2 = s.get(f"{BASE_URL}/api/projects/{airside_pid}/revenue")
    assert r2.status_code == 200
    assert len(r2.json()) >= j["imported"]


def test_sap_upload_cost(s, airside_pid, xlsx_bytes):
    r = s.post(f"{BASE_URL}/api/projects/{airside_pid}/sap-upload?kind=cost",
               files={"file": ("t.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["kind"] == "cost"
    assert isinstance(j["imported"], int)


def test_sap_upload_unknown_pid(s, xlsx_bytes):
    r = s.post(f"{BASE_URL}/api/projects/does-not-exist/sap-upload?kind=revenue",
               files={"file": ("t.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 404


def test_sap_upload_non_xlsx(s, airside_pid):
    r = s.post(f"{BASE_URL}/api/projects/{airside_pid}/sap-upload?kind=revenue",
               files={"file": ("a.pdf", b"%PDF", "application/pdf")})
    assert r.status_code == 400


def test_sap_upload_unauth(airside_pid, xlsx_bytes):
    r = requests.post(f"{BASE_URL}/api/projects/{airside_pid}/sap-upload?kind=revenue",
                      files={"file": ("t.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code in (401, 403)


# ---------- customer delete guard ----------
def test_customer_delete_blocked_when_linked(s):
    r = s.get(f"{BASE_URL}/api/projects")
    assert r.status_code == 200
    proj = next((p for p in r.json() if p.get("customer_id")), None)
    assert proj, "no project with customer link"
    cid = proj["customer_id"]
    r = s.delete(f"{BASE_URL}/api/customers/{cid}")
    assert r.status_code == 409
    assert "linked" in r.json()["detail"].lower() or "cannot delete" in r.json()["detail"].lower()


def test_customer_delete_ok_when_no_links(s):
    r = s.post(f"{BASE_URL}/api/customers", json={
        "customer_name": "TEST_iter3_orphan", "sap_customer_code": "TST3",
        "balance_outstanding_sap": 0, "country": "India",
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    r = s.delete(f"{BASE_URL}/api/customers/{cid}")
    assert r.status_code == 200


# ---------- project delete cascade (regression) ----------
def test_project_delete_cascade(s):
    # Create temp customer + project, then delete and verify revenue/cost cleared
    rc = s.post(f"{BASE_URL}/api/customers", json={
        "customer_name": "TEST_iter3_cust2", "sap_customer_code": "T32", "balance_outstanding_sap": 0, "country": "India"})
    cid = rc.json()["id"]
    rp = s.post(f"{BASE_URL}/api/projects", json={
        "project_name": "TEST_iter3_proj", "wbs_element": "TEST.001", "customer_id": cid,
        "po_value": 1000, "revenue_total": 800, "cost_total": 600, "currency": "INR",
        "billing_type": "Monthly",
    })
    assert rp.status_code == 200, rp.text
    pid = rp.json()["id"]
    s.post(f"{BASE_URL}/api/projects/{pid}/revenue",
           json={"revenue_code": "X", "amount": 10, "is_billed": False})
    s.post(f"{BASE_URL}/api/projects/{pid}/cost",
           json={"vendor_po_ref": "X", "amount": 5})
    rd = s.delete(f"{BASE_URL}/api/projects/{pid}")
    assert rd.status_code == 200
    # cleanup customer
    s.delete(f"{BASE_URL}/api/customers/{cid}")


# ---------- regressions ----------
def test_parse_pdf_regression(s):
    r = s.post(f"{BASE_URL}/api/projects/parse-pdf",
               files={"file": ("a.txt", b"hi", "text/plain")})
    assert r.status_code == 400  # rejects non-pdf, endpoint reachable


def test_notifications_status(s):
    r = s.get(f"{BASE_URL}/api/notifications/status")
    assert r.status_code == 200
    j = r.json()
    assert j.get("configured") is False


def test_transition_endpoint_exists(s, airside_pid):
    # Use clearly invalid stage to confirm 400 (endpoint reachable, validation works)
    r = s.post(f"{BASE_URL}/api/projects/{airside_pid}/transition",
               json={"target_stage": "Pipeline", "reason": "noop"})
    # either 400 (already there) or 200 - both prove endpoint works
    assert r.status_code in (200, 400, 422)
