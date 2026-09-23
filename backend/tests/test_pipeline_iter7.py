"""Iteration 7 — Phase 3 & 4 backend regression tests.

Covers BRD additions:
- Pipeline opportunity_id auto-generation (OPP-YYYY-NNNNNN)
- Full PipelineIn payload persistence (Stages 1-5 fields)
- Mgmt flags (md/cfo/ceo/strategic) round-trip on Pipeline & Project
- close_pipeline outcome=Deferred
- approve-handoff: po_value priority, mgmt flag copy, finance_spoc, pipeline_id
- Change Request routing (category1='Change Request')
- Dashboard: filter_options, delayed_milestones, section/customer/project/business_category/date filters
- Customer Master enriched fields (parent_group, addresses, additional_contacts, ...)
- Project payload accepts new mgmt flags + finance_spoc_email + pipeline_id
- POST /api/projects/{pid}/documents still requires `name`
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@crackerpro.com"
ADMIN_PASSWORD = "Admin@123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def created_ids():
    return {"pipelines": [], "projects": [], "customers": []}


# ---------- 1. Pipeline list returns BRD fields & opportunity_id format ----------
def test_pipeline_list_has_brd_fields_and_opportunity_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/pipeline", timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list) and len(rows) >= 1
    sample = rows[0]
    # New BRD fields exist
    for k in ("opportunity_id", "opportunity_category", "opportunity_type",
              "solution_line", "business_need", "lead_source",
              "md_review_required", "cfo_review_required", "ceo_visibility",
              "strategic_deal", "currency"):
        assert k in sample, f"Missing field {k} on pipeline row"
    # opportunity_id format
    assert re.match(r"^OPP-\d{4}-\d{6}$", sample["opportunity_id"]), \
        f"Bad opportunity_id format: {sample['opportunity_id']}"


# ---------- 2. POST auto-generates opportunity_id ----------
def test_create_pipeline_autogen_opportunity_id(admin_session, created_ids):
    payload = {"opportunity_title": f"TEST_iter7_autogen_{uuid.uuid4().hex[:6]}"}
    r = admin_session.post(f"{BASE_URL}/api/pipeline", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("opportunity_id"), "opportunity_id not auto-generated"
    assert re.match(r"^OPP-\d{4}-\d{6}$", body["opportunity_id"])
    created_ids["pipelines"].append(body["id"])


# ---------- 3. Full BRD payload persistence + mgmt flags ----------
def test_create_pipeline_full_brd_payload_with_mgmt_flags(admin_session, created_ids):
    payload = {
        "opportunity_title": f"TEST_iter7_full_{uuid.uuid4().hex[:6]}",
        "opportunity_category": "Project",
        "opportunity_type": "New Business",
        "solution_line": "Airport IT",
        "business_need": "Modernise airside ops",
        "nature_of_work": "Hybrid",
        "lead_source": "RFP",
        "opportunity_source_type": "Inbound",
        "strategic_relevance": "High",
        "relationship_strength": "Strong",
        "currency": "USD",
        "expected_revenue": 1000000,
        "decision_maker_name": "Jane Doe",
        "is_rfp_available": True,
        "rfp_number": "RFP-2026-9999",
        "proposal_value": 950000,
        "acv": 320000, "tcv": 950000,
        "expected_gross_margin_pct": 22.5,
        "negotiated_value": 900000, "estimated_margin_pct": 20,
        "poc_required": True, "poc_status": "Completed",
        "md_review_required": True, "cfo_review_required": True,
        "ceo_visibility": True, "strategic_deal": True,
        "business_category": "GMR", "priority": "High",
        "finance_contact": "fin@example.com",
    }
    r = admin_session.post(f"{BASE_URL}/api/pipeline", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    pid = body["id"]
    created_ids["pipelines"].append(pid)

    # Verify via GET
    g = admin_session.get(f"{BASE_URL}/api/pipeline/{pid}", timeout=15)
    assert g.status_code == 200
    saved = g.json()
    assert saved["opportunity_type"] == "New Business"
    assert saved["solution_line"] == "Airport IT"
    assert saved["lead_source"] == "RFP"
    assert saved["md_review_required"] is True
    assert saved["cfo_review_required"] is True
    assert saved["ceo_visibility"] is True
    assert saved["strategic_deal"] is True
    assert saved["acv"] == 320000
    assert saved["currency"] == "USD"
    assert saved["finance_contact"] == "fin@example.com"


# ---------- 4. close pipeline outcome=Deferred ----------
def test_close_pipeline_deferred(admin_session, created_ids):
    cr = admin_session.post(f"{BASE_URL}/api/pipeline",
                            json={"opportunity_title": f"TEST_iter7_def_{uuid.uuid4().hex[:6]}"})
    assert cr.status_code == 200
    pid = cr.json()["id"]
    created_ids["pipelines"].append(pid)

    r = admin_session.post(f"{BASE_URL}/api/pipeline/{pid}/close",
                           params={"outcome": "Deferred", "reason": "Budget pause"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "Deferred"
    assert body["current_stage"] == "Closed"
    assert body["closure_date"]


# ---------- 5. Won + approve-handoff creates project with mgmt flags & po_value priority ----------
def test_won_approve_handoff_project_creation(admin_session, created_ids):
    payload = {
        "opportunity_title": f"TEST_iter7_won_{uuid.uuid4().hex[:6]}",
        "opportunity_category": "Project",
        "solution_line": "Cybersecurity",
        "lead_source": "Direct",
        "expected_revenue": 100000,
        "proposal_value": 200000,
        "negotiated_value": 300000,
        "final_commercial_value": 400000,    # should win priority
        "estimated_margin_pct": 25,
        "currency": "USD",
        "business_category": "GMR",
        "md_review_required": True,
        "cfo_review_required": False,
        "ceo_visibility": True,
        "strategic_deal": True,
        "finance_contact": "spoc@example.com",
        "bd_owner": "bd@example.com",
    }
    cr = admin_session.post(f"{BASE_URL}/api/pipeline", json=payload, timeout=15)
    assert cr.status_code == 200
    pid = cr.json()["id"]
    created_ids["pipelines"].append(pid)

    # Close as Won
    cw = admin_session.post(f"{BASE_URL}/api/pipeline/{pid}/close",
                            params={"outcome": "Won", "reason": "Selected vendor"})
    assert cw.status_code == 200
    assert cw.json()["handoff_status"] == "Pending Finance"

    # Approve handoff
    ah = admin_session.post(f"{BASE_URL}/api/pipeline/{pid}/approve-handoff",
                            json={"action": "approve", "comment": "ok"})
    assert ah.status_code == 200, ah.text
    body = ah.json()
    project_id = body["handoff_project_id"]
    assert project_id, "handoff_project_id missing"
    created_ids["projects"].append(project_id)

    # Fetch project and verify
    pr = admin_session.get(f"{BASE_URL}/api/projects/{project_id}", timeout=15)
    assert pr.status_code == 200
    proj = pr.json()
    assert proj["pipeline_id"] == pid
    assert proj["po_value"] == 400000, f"po_value should pick final_commercial_value, got {proj['po_value']}"
    assert proj["md_review_required"] is True
    assert proj["cfo_review_required"] is False
    assert proj["ceo_visibility"] is True
    assert proj["strategic_deal"] is True
    assert proj["finance_spoc_email"] == "spoc@example.com"
    assert proj["category1"] == "Project"  # not Change Request


# ---------- 6. Change Request routing ----------
def test_change_request_routing(admin_session, created_ids):
    payload = {
        "opportunity_title": f"TEST_iter7_cr_{uuid.uuid4().hex[:6]}",
        "opportunity_category": "Change Request",
        "expected_revenue": 50000,
        "negotiated_value": 60000,
        "estimated_margin_pct": 18,
        "currency": "USD",
    }
    cr = admin_session.post(f"{BASE_URL}/api/pipeline", json=payload, timeout=15)
    assert cr.status_code == 200
    pid = cr.json()["id"]
    created_ids["pipelines"].append(pid)

    admin_session.post(f"{BASE_URL}/api/pipeline/{pid}/close", params={"outcome": "Won"})
    ah = admin_session.post(f"{BASE_URL}/api/pipeline/{pid}/approve-handoff",
                            json={"action": "approve"})
    assert ah.status_code == 200
    project_id = ah.json()["handoff_project_id"]
    created_ids["projects"].append(project_id)

    pr = admin_session.get(f"{BASE_URL}/api/projects/{project_id}").json()
    assert pr["category1"] == "Change Request"


# ---------- 7. Dashboard summary - new query params + structure ----------
def test_dashboard_summary_filter_options_and_milestones(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/dashboard/summary", timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert "filter_options" in body
    assert "customers" in body["filter_options"]
    assert "projects" in body["filter_options"]
    assert "delayed_milestones" in body
    assert isinstance(body["delayed_milestones"], list)
    assert "top_customers" in body and len(body["top_customers"]) <= 10
    assert "vendor_exposure" in body and len(body["vendor_exposure"]) <= 10
    # delayed_milestone item structure (if any present)
    if body["delayed_milestones"]:
        m = body["delayed_milestones"][0]
        for k in ("project_id", "milestone_name", "due_date", "days_overdue", "value"):
            assert k in m


def test_dashboard_section_change_requests(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/dashboard/summary",
                          params={"section": "change_requests"}, timeout=20)
    assert r.status_code == 200
    body = r.json()
    # All projects in filter_options must have Change Request/Order/Amendment in category1
    for p in body["filter_options"]["projects"]:
        cat = (p.get("category1") or "").lower()
        assert "change request" in cat or "change order" in cat or "amendment" in cat, \
            f"Non-CR project leaked: {p}"


def test_dashboard_cascading_customer_filter(admin_session):
    # Get any customer with projects
    summary = admin_session.get(f"{BASE_URL}/api/dashboard/summary").json()
    if not summary["filter_options"]["customers"]:
        pytest.skip("No customers with projects")
    cust = summary["filter_options"]["customers"][0]
    r = admin_session.get(f"{BASE_URL}/api/dashboard/summary",
                          params={"customer_ids": cust["id"]}, timeout=20)
    assert r.status_code == 200
    body = r.json()
    for p in body["filter_options"]["projects"]:
        assert p["customer_id"] == cust["id"]


def test_dashboard_business_category_filter(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/dashboard/summary",
                          params={"business_category": "GMR"}, timeout=20)
    assert r.status_code == 200
    assert r.json()["filters_applied"]["business_category"] == "GMR"


# ---------- 8. Customer Master enriched fields ----------
def test_customer_create_with_enriched_fields(admin_session, created_ids):
    payload = {
        "customer_name": f"TEST_iter7_cust_{uuid.uuid4().hex[:6]}",
        "sap_customer_code": f"CT{uuid.uuid4().hex[:6].upper()}",
        "parent_group": "Acme Holdings",
        "state": "Karnataka",
        "region": "South",
        "domestic_international": "Domestic",
        "business_category": "GMR",
        "primary_designation": "CIO",
        "primary_department": "IT",
        "addresses": [
            {"address_type": "Billing", "line1": "Plot 1", "city": "BLR", "country": "India"},
        ],
        "additional_contacts": [
            {"name": "Alt Person", "email": "alt@example.com", "designation": "PM"},
        ],
    }
    r = admin_session.post(f"{BASE_URL}/api/customers", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    cid = body["id"]
    created_ids["customers"].append(cid)
    # GET back and confirm persistence
    rows = admin_session.get(f"{BASE_URL}/api/customers").json()
    found = next((c for c in rows if c["id"] == cid), None)
    assert found, "customer not found after create"
    assert found["parent_group"] == "Acme Holdings"
    assert found["state"] == "Karnataka"
    assert found["business_category"] == "GMR"
    assert isinstance(found.get("addresses"), list) and len(found["addresses"]) == 1
    assert isinstance(found.get("additional_contacts"), list) and len(found["additional_contacts"]) == 1


# ---------- 9. Project payload accepts mgmt flags + finance_spoc + pipeline_id ----------
def test_project_create_with_mgmt_flags(admin_session, created_ids):
    payload = {
        "project_name": f"TEST_iter7_proj_{uuid.uuid4().hex[:6]}",
        "wbs_element": f"WTEST.{uuid.uuid4().hex[:6]}",
        "po_value": 500000, "revenue_total": 480000, "cost_total": 380000,
        "currency": "USD",
        "md_review_required": True,
        "cfo_review_required": True,
        "ceo_visibility": False,
        "strategic_deal": True,
        "finance_spoc_email": "spoc2@example.com",
        "pipeline_id": "fake-pipe-id",
    }
    r = admin_session.post(f"{BASE_URL}/api/projects", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    pid = body["id"]
    created_ids["projects"].append(pid)
    g = admin_session.get(f"{BASE_URL}/api/projects/{pid}").json()
    assert g["md_review_required"] is True
    assert g["cfo_review_required"] is True
    assert g["ceo_visibility"] is False
    assert g["strategic_deal"] is True
    assert g["finance_spoc_email"] == "spoc2@example.com"
    assert g["pipeline_id"] == "fake-pipe-id"


# ---------- 10. Project documents endpoint regression - name required ----------
def test_project_documents_name_required(admin_session, created_ids):
    # need a project; reuse created or create one
    if not created_ids["projects"]:
        pytest.skip("no project to test against")
    pid = created_ids["projects"][0]
    files = {"file": ("hello.txt", b"hello world", "text/plain")}
    # missing name → 422
    r = admin_session.post(f"{BASE_URL}/api/projects/{pid}/documents", files=files)
    assert r.status_code == 422, f"Expected 422 when name missing, got {r.status_code}"
    # with name → 200
    r2 = admin_session.post(f"{BASE_URL}/api/projects/{pid}/documents",
                            params={"name": "iter7-doc"},
                            files={"file": ("hello.txt", b"hello", "text/plain")})
    assert r2.status_code == 200, r2.text


# ---------- 99. Cleanup ----------
def test_zz_cleanup(admin_session, created_ids):
    for pid in created_ids["projects"]:
        admin_session.delete(f"{BASE_URL}/api/projects/{pid}")
    for pid in created_ids["pipelines"]:
        admin_session.delete(f"{BASE_URL}/api/pipeline/{pid}")
    for cid in created_ids["customers"]:
        admin_session.delete(f"{BASE_URL}/api/customers/{cid}")
