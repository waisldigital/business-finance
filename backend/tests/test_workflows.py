"""Core workflows (ported from the old root-level live scripts backend_test.py / backend_test_iter9.py)."""

CR = {"cr_name": "CR Alpha", "customer_name": "DIAL", "airport_name": "DIAL", "wbs_element": "C.NEW.TEST.0001",
      "po_received": True, "customer_po_number": "PO-1", "po_value": 10000000, "vendor_cost": 5000000,
      "resource_lines": [{"resource_count": 2, "mandays": 150, "grade": "L3", "amount": 2000000}],
      "milestones": [{"date": "30-06-2026", "billing_amount": 5000000, "notes": "M1"}]}


def test_cr_draft_numbers_and_costs(client, admin):
    cr = client.post("/api/change-requests", headers=admin, json=CR).json()
    assert cr["cr_number"].startswith("CR-") and cr["status"] == "draft"
    assert cr["estimated_resource_cost"] == 2000000 and cr["estimated_total_cost"] == 7000000
    assert round(cr["estimated_margin_pct"], 1) == 30.0


def test_low_margin_cr_needs_justification(client, admin):
    low = {**CR, "cr_name": "Low margin", "vendor_cost": 9000000}
    cr = client.post("/api/change-requests", headers=admin, json=low).json()
    assert client.post(f"/api/change-requests/{cr['id']}/submit", headers=admin).status_code == 400
    ok = client.put(f"/api/change-requests/{cr['id']}", headers=admin, json={**low, "business_justification": "Strategic account"})
    assert ok.status_code == 200
    assert client.post(f"/api/change-requests/{cr['id']}/submit", headers=admin).status_code == 200


def test_wbs_approval_flow(client, admin):
    cr = client.post("/api/change-requests", headers=admin, json={**CR, "wbs_element": "C.NEW.UNKNOWN.9"}).json()
    sub = client.post(f"/api/change-requests/{cr['id']}/submit", headers=admin).json()
    assert sub["status"] == "wbs_pending"
    ok = client.post(f"/api/change-requests/{cr['id']}/approve-wbs", headers=admin).json()
    assert ok["status"] == "wbs_approved" and ok["wbs_approved"]
    assert client.post(f"/api/change-requests/{cr['id']}/approve-wbs", headers=admin).status_code == 400


def test_employee_login_and_role_sync(client, admin):
    from conftest import login
    role = client.post("/api/roles", headers=admin, json={"name": "Sync role", "permissions": {"projects": {"can_view": True}}}).json()
    r = client.post("/api/employees", headers=admin, json={"employee_no": "S1", "employee_name": "Sync User",
                                                            "email_id": "sync@finsight-test.com", "password": "Sync!pass-123",
                                                            "workspace_role_id": role["id"]})
    assert r.status_code == 200 and r.json()["has_user_account"] and r.json()["workspace_role_name"] == "Sync role"
    h = login(client, "sync@finsight-test.com", "Sync!pass-123")
    assert client.get("/api/me/permissions", headers=h).json()["permissions"]["projects"]["can_view"]
    assert client.get("/api/employees/template", headers=admin).status_code == 200


def test_wbs_crud_and_template(client, admin):
    w = client.post("/api/wbs", headers=admin, json={"wbs_element": "WSIN-T-1", "description": "Test WBS"})
    assert w.status_code == 200, w.text
    wid = w.json()["id"]
    assert any(x["id"] == wid for x in client.get("/api/wbs", headers=admin).json())
    assert client.put(f"/api/wbs/{wid}", headers=admin, json={"wbs_element": "WSIN-T-1", "description": "Renamed"}).json()["description"] == "Renamed"
    assert client.get("/api/wbs/template", headers=admin).status_code == 200
    assert client.delete(f"/api/wbs/{wid}", headers=admin).status_code == 200
