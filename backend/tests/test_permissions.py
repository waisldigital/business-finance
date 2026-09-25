"""Section permissions are enforced by the API, not only hidden in the UI."""


def test_section_permissions_enforced(client, make_user):
    dash_only = make_user({"dashboard": {"can_view": True}})
    assert client.get("/api/dashboard/summary", headers=dash_only).status_code == 200
    for url in ("/api/projects", "/api/pipeline", "/api/change-requests", "/api/wbs", "/api/customers/x/profile"):
        assert client.get(url, headers=dash_only).status_code == 403, url
    # the customer list is a lookup the dashboard's filters also use
    assert client.get("/api/customers", headers=dash_only).status_code == 200
    # admin-only areas
    assert client.get("/api/audit", headers=dash_only).status_code == 403
    assert client.get("/api/uploads/logs", headers=dash_only).status_code == 403
    assert client.get("/api/uploads/export/employee", headers=dash_only).status_code == 403


def test_view_vs_edit(client, make_user):
    viewer = make_user({"projects": {"can_view": True}})
    assert client.get("/api/projects", headers=viewer).status_code == 200
    assert client.post("/api/projects", headers=viewer, json={}).status_code == 403
    assert client.post("/api/pipeline", headers=viewer, json={}).status_code == 403
    # a project's own audit history is visible to project viewers; the full trail is not
    assert client.get("/api/audit", params={"entity_type": "project", "entity_id": "p1"}, headers=viewer).status_code == 200
    assert client.get("/api/audit", headers=viewer).status_code == 403
    editor = make_user({"projects": {"can_view": True, "can_edit": True}})
    assert client.post("/api/projects", headers=editor, json={}).status_code == 422  # passes the gate, fails validation


def test_no_role_sees_dashboard_only(client, admin):
    r = client.get("/api/me/permissions", headers=admin).json()
    assert r["is_admin"] and r["permissions"]["projects"]["can_delete"]


def test_approval_requests_scoped_to_approver_or_requester(client, admin, make_user, app):
    import asyncio
    import server
    reqs = [{"id": "r1", "status": "Pending", "approver_emails": ["user90@finsight-test.com"], "requested_by": "x@y.com",
             "project_id": "p", "target_stage": "S2", "requested_at": "2026-01-01"},
            {"id": "r2", "status": "Pending", "approver_emails": ["someone@else.com"], "requested_by": "x@y.com",
             "project_id": "p", "target_stage": "S2", "requested_at": "2026-01-02"}]
    asyncio.get_event_loop().run_until_complete(server.db.approval_requests.insert_many(reqs))
    assert {r["id"] for r in client.get("/api/approvals/requests", headers=admin).json()} >= {"r1", "r2"}
    other = make_user({"dashboard": {"can_view": True}})
    assert client.get("/api/approvals/requests", headers=other).json() == []
    assert client.get("/api/approvals/inbox", headers=other).json()["count"] == 0


def test_cr_notification_links_point_at_the_workspace():
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "server.py").read_text()
    assert 'link=f"/change-requests/' not in src and src.count('link=f"/app/change-requests/{cid}"') == 4


def test_cr_approver_inbox_open_and_decide(client, make_user):
    import asyncio
    import server
    approver = make_user({"dashboard": {"can_view": True}})  # no Change Requests section
    email = client.get("/api/auth/me", headers=approver).json()["email"]
    cr = {"id": "cr-inbox-1", "cr_number": "CR-T-1", "cr_name": "Kiosks", "wbs_element": "WSIN-1", "status": "wbs_approved",
          "wbs_approved": True, "approver_emails": [email], "po_value": 100.0, "estimated_margin_pct": 30.0,
          "created_at": "2026-01-01T00:00:00"}
    asyncio.get_event_loop().run_until_complete(server.db.change_requests.insert_one(cr))
    inbox = client.get("/api/approvals/inbox", headers=approver).json()
    assert [c["id"] for c in inbox["change_requests"]] == ["cr-inbox-1"] and inbox["count"] == 1
    assert client.get("/api/change-requests/cr-inbox-1", headers=approver).status_code == 200
    assert client.get("/api/change-requests", headers=approver).status_code == 403  # the list stays section-gated
    r = client.post("/api/change-requests/cr-inbox-1/approve", headers=approver, json={"comment": "ok for FY27"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert client.get("/api/approvals/inbox", headers=approver).json()["count"] == 0
