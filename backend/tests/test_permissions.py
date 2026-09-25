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
