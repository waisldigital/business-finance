"""Iteration 6 — Pipeline (5-stage opportunity funnel) + Finance handoff gate
+ document-name mandatory + sidebar/dashboard BRD extras (backend).

Covers review request items: pipeline CRUD, advance, close (Won/Lost),
approve-handoff (approve/reject/non-Won/non-allowed role), project creation,
document name requirement, dashboard summary Top-10 fields.
"""
import os
import io
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://staff-directory-31.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@crackerpro.com"
ADMIN_PASS = "Admin@123"

# Shared state between tests
state = {}


# -------------------- Fixtures --------------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    assert token, "No access_token in login response"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def sales_session(admin_session):
    """Create (or reuse) a non-finance/non-admin sales user for the 403 test."""
    email = f"TEST_sales_iter6_{uuid.uuid4().hex[:6]}@example.com"
    pwd = "Sales@123"
    cr = admin_session.post(f"{API}/admin/users", json={
        "email": email, "password": pwd, "name": "Test Sales Iter6",
        "role": "sales", "location": "HQ"
    }, timeout=30)
    assert cr.status_code in (200, 201), f"User create failed: {cr.status_code} {cr.text}"
    state["sales_email"] = email
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"Sales login failed: {r.status_code} {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


# -------------------- Auth / seed --------------------
def test_login_admin(admin_session):
    r = admin_session.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == ADMIN_EMAIL
    assert body["role"] == "admin"


# -------------------- Pipeline list + summary --------------------
def test_pipeline_list_returns_seeded(admin_session):
    r = admin_session.get(f"{API}/pipeline", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    # seeded 4 opportunities per BRD
    assert len(data) >= 4, f"Expected >=4 seeded opportunities, got {len(data)}"
    # structure check
    sample = data[0]
    for k in ("id", "opportunity_title", "current_stage", "outcome", "handoff_status", "created_at"):
        assert k in sample, f"Missing key {k} in pipeline out"


def test_pipeline_summary_shape(admin_session):
    r = admin_session.get(f"{API}/pipeline/summary", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # Actual shape is flat: {funnel, total_opportunities, open_count, won_count, lost_count, pending_handoff, total_value}
    assert "funnel" in data
    for k in ("total_opportunities", "total_value"):
        assert k in data, f"Missing top-level {k}; got {list(data.keys())}"
    assert ("pending_handoff" in data) or ("pending_handoffs" in data), \
        f"Missing pending_handoff(s); got {list(data.keys())}"
    assert isinstance(data["funnel"], list) and len(data["funnel"]) == 5
    stage_names = [f["stage"] for f in data["funnel"]]
    for s in ["Prospecting", "Active Discussion", "Proposal Submitted", "Evaluation/Negotiation", "Closed"]:
        assert s in stage_names


# -------------------- Create + full BRD field persistence --------------------
def test_create_pipeline_with_all_brd_fields(admin_session):
    payload = {
        # Stage 1
        "opportunity_title": f"TEST_Opp_{uuid.uuid4().hex[:8]}",
        "customer_name": "Acme Aviation",
        "bd_owner": "bd@crackerpro.com",
        "expected_revenue": 1000000.0,
        "currency": "INR",
        "source": "RFP",
        "industry": "Aviation",
        # Stage 2
        "solution_scope": "Smart gate rollout",
        "expected_timeline": "Q2 2026",
        "competitors": "VendorX, VendorY",
        "stakeholders": ["cio@acme.com", "cfo@acme.com"],
        # Stage 3
        "proposal_value": 1200000.0,
        "proposal_submitted_on": "2026-05-01",
        "proposal_validity": "30 days",
        "proposal_notes": "Includes 2y AMC",
        # Stage 4
        "negotiated_value": 1150000.0,
        "estimated_margin_pct": 22.5,
        "expected_decision_date": "2026-06-01",
        "negotiation_notes": "Awaiting CFO nod",
        # Flags
        "business_category": "GMR",
        "priority": "High",
        "remarks": "Strategic",
    }
    r = admin_session.post(f"{API}/pipeline", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    out = r.json()
    state["opp_id"] = out["id"]
    # Persistence checks
    assert out["opportunity_title"] == payload["opportunity_title"]
    assert out["negotiated_value"] == 1150000.0
    assert out["estimated_margin_pct"] == 22.5
    assert out["business_category"] == "GMR"
    assert out["priority"] == "High"
    assert out["current_stage"] == "Prospecting"
    assert out["outcome"] == "Open"
    assert out["handoff_status"] == "Not Applicable"
    assert out["stakeholders"] == ["cio@acme.com", "cfo@acme.com"]

    # GET verifies persistence
    g = admin_session.get(f"{API}/pipeline/{out['id']}", timeout=15)
    assert g.status_code == 200
    assert g.json()["proposal_value"] == 1200000.0


def test_update_pipeline(admin_session):
    pid = state["opp_id"]
    # PUT requires the full PipelineIn payload (model_dump replaces all fields).
    # Re-send full payload with updated title/value/priority.
    r = admin_session.put(f"{API}/pipeline/{pid}",
                          json={
                              "opportunity_title": "TEST_Updated_Title",
                              "customer_name": "Acme Aviation",
                              "bd_owner": "bd@crackerpro.com",
                              "expected_revenue": 1000000.0,
                              "currency": "INR",
                              "source": "RFP",
                              "industry": "Aviation",
                              "solution_scope": "Smart gate rollout",
                              "expected_timeline": "Q2 2026",
                              "competitors": "VendorX, VendorY",
                              "stakeholders": ["cio@acme.com", "cfo@acme.com"],
                              "proposal_value": 1200000.0,
                              "proposal_submitted_on": "2026-05-01",
                              "proposal_validity": "30 days",
                              "proposal_notes": "Includes 2y AMC",
                              "negotiated_value": 1190000.0,
                              "estimated_margin_pct": 22.5,
                              "expected_decision_date": "2026-06-01",
                              "negotiation_notes": "Updated notes",
                              "business_category": "GMR",
                              "priority": "Medium",
                              "remarks": "Updated",
                          },
                          timeout=15)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["opportunity_title"] == "TEST_Updated_Title"
    assert out["negotiated_value"] == 1190000.0
    assert out["priority"] == "Medium"
    assert out["estimated_margin_pct"] == 22.5


# -------------------- Advance stages --------------------
def test_advance_pipeline_stages(admin_session):
    pid = state["opp_id"]
    for stage in ["Active Discussion", "Proposal Submitted", "Evaluation/Negotiation"]:
        r = admin_session.post(f"{API}/pipeline/{pid}/advance",
                               json={"target_stage": stage, "reason": f"move to {stage}"},
                               timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["current_stage"] == stage

    # Invalid stage -> 400
    r2 = admin_session.post(f"{API}/pipeline/{pid}/advance",
                            json={"target_stage": "BogusStage"}, timeout=15)
    # Literal validation at pydantic => 422
    assert r2.status_code in (400, 422)


# -------------------- Close Won (Pending Finance, no project yet) --------------------
def test_close_won_sets_pending_finance(admin_session):
    pid = state["opp_id"]
    r = admin_session.post(f"{API}/pipeline/{pid}/close",
                           params={"outcome": "Won", "reason": "Price accepted"},
                           timeout=15)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["outcome"] == "Won"
    assert out["current_stage"] == "Closed"
    assert out["handoff_status"] == "Pending Finance"
    assert out.get("handoff_project_id") in (None, "")


# -------------------- Approve handoff: 403 for sales role --------------------
def test_approve_handoff_forbidden_for_non_finance(sales_session):
    pid = state["opp_id"]
    r = sales_session.post(f"{API}/pipeline/{pid}/approve-handoff",
                           json={"action": "approve", "comment": "illegal"},
                           timeout=15)
    assert r.status_code == 403, f"Expected 403 for sales; got {r.status_code} {r.text}"


# -------------------- Approve handoff: creates project --------------------
def test_approve_handoff_creates_project(admin_session):
    pid = state["opp_id"]
    # capture pipeline values BEFORE approval
    g = admin_session.get(f"{API}/pipeline/{pid}", timeout=15).json()
    expected_po = g.get("negotiated_value") or g.get("proposal_value") or g.get("expected_revenue")

    r = admin_session.post(f"{API}/pipeline/{pid}/approve-handoff",
                           json={"action": "approve", "comment": "Approved by admin (acting finance)"},
                           timeout=30)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["handoff_status"] == "Approved"
    assert out.get("handoff_project_id"), "handoff_project_id must be set after approval"
    state["project_id"] = out["handoff_project_id"]

    # Verify project exists and fields mapped
    pr = admin_session.get(f"{API}/projects/{out['handoff_project_id']}", timeout=15)
    assert pr.status_code == 200, pr.text
    proj = pr.json()
    assert proj["po_value"] == expected_po
    assert proj["customer_name"] == g.get("customer_name")
    assert proj["business_category"] == g.get("business_category")
    # margin_pct mirrors estimated margin
    assert abs(proj["margin_pct"] - (g.get("estimated_margin_pct") or 0.0)) < 0.5

    # Also appears in listing
    pl = admin_session.get(f"{API}/projects", timeout=15)
    assert pl.status_code == 200
    ids = [p["id"] for p in pl.json()]
    assert out["handoff_project_id"] in ids


# -------------------- Approve twice -> 400 --------------------
def test_approve_handoff_already_processed_400(admin_session):
    pid = state["opp_id"]
    r = admin_session.post(f"{API}/pipeline/{pid}/approve-handoff",
                           json={"action": "approve"}, timeout=15)
    assert r.status_code == 400


# -------------------- Reject flow on a fresh Won opportunity --------------------
def test_reject_handoff_does_not_create_project(admin_session):
    # create + close-won a new opportunity
    create = admin_session.post(f"{API}/pipeline", json={
        "opportunity_title": f"TEST_Reject_{uuid.uuid4().hex[:6]}",
        "customer_name": "RejectCo",
        "negotiated_value": 500000, "estimated_margin_pct": 10,
        "business_category": "Non-GMR", "priority": "Low",
    }, timeout=15)
    assert create.status_code == 200, create.text
    pid = create.json()["id"]

    cl = admin_session.post(f"{API}/pipeline/{pid}/close",
                            params={"outcome": "Won", "reason": "Test"}, timeout=15)
    assert cl.status_code == 200

    proj_before = admin_session.get(f"{API}/projects", timeout=15).json()
    before_count = len(proj_before)

    r = admin_session.post(f"{API}/pipeline/{pid}/approve-handoff",
                           json={"action": "reject", "comment": "not feasible"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["handoff_status"] == "Rejected"
    assert not r.json().get("handoff_project_id")

    proj_after = admin_session.get(f"{API}/projects", timeout=15).json()
    assert len(proj_after) == before_count, "Rejected handoff must NOT create a project"

    # cleanup
    admin_session.delete(f"{API}/pipeline/{pid}", timeout=15)


# -------------------- Close Lost: handoff stays Not Applicable --------------------
def test_close_lost_no_handoff(admin_session):
    create = admin_session.post(f"{API}/pipeline", json={
        "opportunity_title": f"TEST_Lost_{uuid.uuid4().hex[:6]}",
        "customer_name": "LostCo", "negotiated_value": 100000,
    }, timeout=15).json()
    pid = create["id"]
    r = admin_session.post(f"{API}/pipeline/{pid}/close",
                           params={"outcome": "Lost", "reason": "price"}, timeout=15)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["outcome"] == "Lost"
    assert out["handoff_status"] == "Not Applicable"

    # Approve handoff on non-Won -> 400
    r2 = admin_session.post(f"{API}/pipeline/{pid}/approve-handoff",
                            json={"action": "approve"}, timeout=15)
    assert r2.status_code == 400
    admin_session.delete(f"{API}/pipeline/{pid}", timeout=15)


# -------------------- Approve-handoff on Open opportunity -> 400 --------------------
def test_approve_handoff_open_opp_400(admin_session):
    create = admin_session.post(f"{API}/pipeline", json={
        "opportunity_title": f"TEST_Open_{uuid.uuid4().hex[:6]}",
    }, timeout=15).json()
    pid = create["id"]
    r = admin_session.post(f"{API}/pipeline/{pid}/approve-handoff",
                           json={"action": "approve"}, timeout=15)
    assert r.status_code == 400
    admin_session.delete(f"{API}/pipeline/{pid}", timeout=15)


# -------------------- Document upload: name is mandatory --------------------
def test_upload_document_requires_name(admin_session):
    # pick any project (prefer the one created by handoff approval)
    pid = state.get("project_id")
    if not pid:
        pl = admin_session.get(f"{API}/projects", timeout=15).json()
        assert pl, "No projects available"
        pid = pl[0]["id"]

    file_bytes = b"%PDF-1.4\n%Test\n"
    files = {"file": ("unit_test.pdf", io.BytesIO(file_bytes), "application/pdf")}
    # No Content-Type header conflict: use a bare session
    bare = requests.Session()
    bare.headers.update({"Authorization": admin_session.headers["Authorization"]})

    # Without name -> 422 (Query required)
    r = bare.post(f"{API}/projects/{pid}/documents", files=files, timeout=30)
    assert r.status_code == 422, f"Expected 422 when name missing, got {r.status_code}"

    # With name -> 200
    files2 = {"file": ("unit_test.pdf", io.BytesIO(file_bytes), "application/pdf")}
    r2 = bare.post(f"{API}/projects/{pid}/documents",
                   params={"name": "TEST_Doc_Name"}, files=files2, timeout=30)
    assert r2.status_code == 200, r2.text
    body = r2.json()
    # Response may be either a bare doc or {"document": doc, "applied": {...}}
    doc = body.get("document", body)
    assert doc["name"] == "TEST_Doc_Name"
    state["doc_id"] = doc["id"]

    # GET documents -> name present
    g = admin_session.get(f"{API}/projects/{pid}/documents", timeout=15)
    assert g.status_code == 200
    assert any(d.get("name") == "TEST_Doc_Name" for d in g.json())


# -------------------- Dashboard summary: top_customers & vendor_exposure top-10 --------------------
def test_dashboard_summary_top10(admin_session):
    r = admin_session.get(f"{API}/dashboard/summary", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "top_customers" in data
    assert "vendor_exposure" in data
    assert len(data["top_customers"]) <= 10
    assert len(data["vendor_exposure"]) <= 10
    assert "totals" in data and "total_revenue" in data["totals"]


# -------------------- Cleanup --------------------
def test_zz_cleanup(admin_session):
    # delete TEST_ prefixed opportunities
    opps = admin_session.get(f"{API}/pipeline", timeout=15).json()
    for o in opps:
        if o.get("opportunity_title", "").startswith("TEST_"):
            admin_session.delete(f"{API}/pipeline/{o['id']}", timeout=15)
    # delete created project (auto-created via handoff) if present
    pid = state.get("project_id")
    if pid:
        admin_session.delete(f"{API}/projects/{pid}", timeout=15)
