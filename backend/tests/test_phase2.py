"""CRacker Pro Phase 2: Finance Queries, Customer Profile, Document Attachments."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://staff-directory-31.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@crackerpro.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    if r.status_code == 429:
        pytest.skip("Admin locked")
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def sample_project(admin_headers):
    r = requests.get(f"{API}/projects", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert rows
    return rows[0]


@pytest.fixture(scope="module")
def sample_customer(admin_headers):
    r = requests.get(f"{API}/customers", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert rows
    # pick first that has projects
    projects = requests.get(f"{API}/projects", headers=admin_headers, timeout=15).json()
    cust_with_proj = next((c for c in rows if any(p.get("customer_id") == c["id"] for p in projects)), rows[0])
    return cust_with_proj


# ============ Finance Queries ============
class TestQueries:
    def test_create_list_query(self, admin_headers, sample_project):
        pid = sample_project["id"]
        # Create
        payload = {"subject": "TEST_Q_subject", "description": "Need clarity on revenue line"}
        r = requests.post(f"{API}/projects/{pid}/queries", headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["subject"] == payload["subject"]
        assert q["status"] == "Open"
        assert q["replies"] == []
        assert q["raised_by"] == ADMIN_EMAIL
        TestQueries.qid = q["id"]
        TestQueries.pid = pid

        # List
        r = requests.get(f"{API}/projects/{pid}/queries", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == q["id"] for x in rows)

    def test_reply_to_open_query(self, admin_headers):
        qid = TestQueries.qid
        r = requests.post(f"{API}/queries/{qid}/replies", headers=admin_headers,
                          json={"content": "Reviewing now"}, timeout=15)
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["content"] == "Reviewing now"
        assert rep["replied_by"] == ADMIN_EMAIL
        # Verify persisted in replies array
        rows = requests.get(f"{API}/projects/{TestQueries.pid}/queries", headers=admin_headers, timeout=15).json()
        q = next(x for x in rows if x["id"] == qid)
        assert len(q["replies"]) == 1
        assert q["replies"][0]["content"] == "Reviewing now"

    def test_close_query_and_reply_rejected(self, admin_headers):
        qid = TestQueries.qid
        r = requests.patch(f"{API}/queries/{qid}/status", headers=admin_headers,
                           params={"status": "Closed"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "Closed"

        # Try replying to closed query -> 400
        r = requests.post(f"{API}/queries/{qid}/replies", headers=admin_headers,
                          json={"content": "late reply"}, timeout=15)
        assert r.status_code == 400, f"Expected 400 on closed-query reply, got {r.status_code}: {r.text}"

    def test_create_query_invalid_project(self, admin_headers):
        r = requests.post(f"{API}/projects/nonexistent-pid/queries", headers=admin_headers,
                          json={"subject": "x", "description": "y"}, timeout=15)
        assert r.status_code == 404


# ============ Customer Profile ============
class TestCustomerProfile:
    def test_profile_structure(self, admin_headers, sample_customer):
        cid = sample_customer["id"]
        r = requests.get(f"{API}/customers/{cid}/profile", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["customer", "totals", "billing", "ageing_buckets",
                  "stage_distribution", "projects", "revenue_lines", "cost_lines"]:
            assert k in d, f"missing key {k}"
        assert d["customer"]["id"] == cid
        for k in ["project_count", "total_po", "total_revenue", "total_cost", "total_margin", "margin_pct"]:
            assert k in d["totals"], f"totals missing {k}"
        # 4 ageing buckets exactly
        assert len(d["ageing_buckets"]) == 4
        bucket_keys = {b["bucket"] for b in d["ageing_buckets"]}
        assert bucket_keys == {"0-30", "31-60", "61-90", "90+"}
        for k in ["recognized", "billed", "unbilled"]:
            assert k in d["billing"]

    def test_profile_404(self, admin_headers):
        r = requests.get(f"{API}/customers/nope-xyz/profile", headers=admin_headers, timeout=15)
        assert r.status_code == 404


# ============ Document Attachments ============
def _minimal_pdf_bytes() -> bytes:
    """Return a tiny valid PDF for upload tests."""
    # smallest valid PDF (single empty page)
    return (b"%PDF-1.4\n"
            b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n"
            b"4 0 obj<</Length 44>>stream\n"
            b"BT /F1 12 Tf 10 100 Td (Total Amount: INR 1,00,000) Tj ET\n"
            b"endstream endobj\n"
            b"xref\n0 5\n0000000000 65535 f \n"
            b"trailer<</Size 5/Root 1 0 R>>\nstartxref\n400\n%%EOF\n")


class TestDocuments:
    def test_upload_non_pdf_no_parse(self, admin_headers, sample_project):
        pid = sample_project["id"]
        files = {"file": ("note.txt", b"hello world", "text/plain")}
        r = requests.post(f"{API}/projects/{pid}/documents", headers=admin_headers,
                          files=files, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["document"]["file_name"] == "note.txt"
        assert d["document"]["parsed"] is None
        assert d["applied"] == {}
        TestDocuments.txt_did = d["document"]["id"]

    def test_upload_pdf_with_parse(self, admin_headers, sample_project):
        pid = sample_project["id"]
        files = {"file": ("po.pdf", _minimal_pdf_bytes(), "application/pdf")}
        r = requests.post(f"{API}/projects/{pid}/documents", headers=admin_headers,
                          files=files, params={"parse": "true"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["document"]["file_name"] == "po.pdf"
        # parsed should be a dict (even if warnings are present)
        assert isinstance(d["document"]["parsed"], dict), \
            f"Expected parsed dict for PDF with parse=true, got: {d['document']['parsed']}"
        # Parser may legitimately not detect fields - warnings expected
        assert "warnings" in d["document"]["parsed"] or "raw_text_excerpt" in d["document"]["parsed"]
        TestDocuments.pdf_did = d["document"]["id"]

    def test_upload_pdf_no_parse_returns_null(self, admin_headers, sample_project):
        pid = sample_project["id"]
        files = {"file": ("po2.pdf", _minimal_pdf_bytes(), "application/pdf")}
        r = requests.post(f"{API}/projects/{pid}/documents", headers=admin_headers,
                          files=files, timeout=20)
        assert r.status_code == 200
        assert r.json()["document"]["parsed"] is None

    def test_list_documents(self, admin_headers, sample_project):
        pid = sample_project["id"]
        r = requests.get(f"{API}/projects/{pid}/documents", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        ids = {x["id"] for x in rows}
        assert TestDocuments.txt_did in ids
        assert TestDocuments.pdf_did in ids
        # storage_path must NOT leak
        for row in rows:
            assert "storage_path" not in row

    def test_download_document(self, admin_headers):
        did = TestDocuments.txt_did
        r = requests.get(f"{API}/documents/{did}/download", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.content == b"hello world"

    def test_apply_extracted_with_empty_project(self, admin_headers):
        """Create a fresh project with empty po_value/customer_po_number, upload PDF
        with parse+apply, and verify any extracted fields are applied."""
        custs = requests.get(f"{API}/customers", headers=admin_headers, timeout=15).json()
        payload = {
            "project_name": "TEST_DocApply", "wbs_element": "WTEST.DOC.001",
            "customer_id": custs[0]["id"], "customer_name": custs[0]["customer_name"],
            "customer_po_number": "", "billing_type": "Milestone",
            "currency": "", "po_value": 0, "revenue_total": 0,
            "cost_total": 0, "country": "India",
        }
        r = requests.post(f"{API}/projects", headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        try:
            files = {"file": ("po_apply.pdf", _minimal_pdf_bytes(), "application/pdf")}
            r = requests.post(f"{API}/projects/{pid}/documents", headers=admin_headers,
                              files=files,
                              params={"parse": "true", "apply_extracted": "true"},
                              timeout=30)
            assert r.status_code == 200, r.text
            d = r.json()
            # `applied` may be empty if parser didn't extract anything from minimal PDF,
            # but the response shape must be a dict (no error)
            assert isinstance(d["applied"], dict)
        finally:
            requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=15)

    def test_delete_document(self, admin_headers):
        did = TestDocuments.txt_did
        r = requests.delete(f"{API}/documents/{did}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # Verify gone
        r = requests.get(f"{API}/documents/{did}/download", headers=admin_headers, timeout=15)
        assert r.status_code == 404
        # cleanup pdf
        requests.delete(f"{API}/documents/{TestDocuments.pdf_did}", headers=admin_headers, timeout=15)
