"""In-process smoke test: the app starts, the admin logs in and the core screens' endpoints answer."""


def test_health_and_admin_endpoints(client, admin):
    assert client.get("/api/health").status_code == 200
    for url in ("/api/auth/me", "/api/projects", "/api/pipeline", "/api/change-requests", "/api/wbs", "/api/customers",
                "/api/dashboard/summary", "/api/me/permissions", "/api/approvals/requests", "/api/settings",
                "/api/notifications/in-app/count", "/api/aop/config"):
        r = client.get(url, headers=admin)
        assert r.status_code == 200, (url, r.status_code, r.text[:200])
