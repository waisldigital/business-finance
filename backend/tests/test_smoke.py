"""In-process smoke test: the app starts, the admin logs in and the core screens' endpoints answer."""


def test_health_and_admin_endpoints(client, admin):
    assert client.get("/api/health").status_code == 200
    for url in ("/api/auth/me", "/api/projects", "/api/pipeline", "/api/change-requests", "/api/wbs", "/api/customers",
                "/api/dashboard/summary", "/api/me/permissions", "/api/approvals/requests", "/api/settings",
                "/api/notifications/in-app/count", "/api/aop/config"):
        r = client.get(url, headers=admin)
        assert r.status_code == 200, (url, r.status_code, r.text[:200])


def test_local_storage_roundtrip(tmp_path):
    import asyncio
    from storage import LocalStorage
    s = LocalStorage(tmp_path)

    async def go():
        await s.save("cr/1/a.txt", b"hi", "text/plain")
        assert (await s.open("cr/1/a.txt"))[0] == b"hi"
        await s.delete("cr/1/a.txt")
        assert await s.open("cr/1/a.txt") is None
        try:
            await s.save("../escape.txt", b"x")
            raise AssertionError("path escape allowed")
        except ValueError:
            pass
    asyncio.run(go())


def test_project_document_upload_download_delete(client, admin):
    pid = client.post("/api/projects", headers=admin, json={"project_name": "Doc test"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/documents", headers=admin, params={"name": "PO"},
                    files={"file": ("po.txt", b"purchase order", "text/plain")})
    assert r.status_code == 200, r.text
    did = r.json()["document"]["id"]
    assert "storage_key" not in r.json()["document"]
    got = client.get(f"/api/documents/{did}/download", headers=admin)
    assert got.status_code == 200 and got.content == b"purchase order"
    assert client.delete(f"/api/documents/{did}", headers=admin).status_code == 200


def test_cors_is_explicit(app):
    import re
    import server
    o, rx = server.cors_settings({"RENDER": "true"})
    assert o == server.PROD_ORIGINS  # never "*" in production, even when unset
    assert re.fullmatch(rx, "https://business-finance-abc123-waisldigital-5107.vercel.app")
    assert not re.fullmatch(rx, "https://evil-app.vercel.app")
    o, rx = server.cors_settings({"CORS_ORIGINS": "*,https://a.example", "CORS_ORIGIN_REGEX": r"https://.*\.vercel\.app"})
    assert o == ["https://a.example"] and rx == server.PREVIEW_REGEX


def test_refresh_returns_new_tokens(client):
    from conftest import ADMIN_EMAIL, ADMIN_PASSWORD
    r = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
    assert r["refresh_token"]
    client.cookies.clear()
    fresh = client.post("/api/auth/refresh", json={"refresh_token": r["refresh_token"]})
    assert fresh.status_code == 200 and fresh.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {fresh.json()['access_token']}"})
    assert me.status_code == 200
    # an access token is not accepted as a refresh token, and vice versa
    assert client.post("/api/auth/refresh", json={"refresh_token": r["access_token"]}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r['refresh_token']}"}).status_code == 401
    assert client.post("/api/auth/refresh", json={}).status_code == 401


def test_list_paging_and_total_header(client, admin):
    for i in range(3):
        client.post("/api/customers", headers=admin, json={"customer_name": f"Paging Co {i}"})
    r = client.get("/api/customers", headers=admin, params={"limit": 2})
    total = int(r.headers["X-Total-Count"])
    assert len(r.json()) == 2 and total >= 3
    assert len(client.get("/api/customers", headers=admin, params={"skip": total - 1}).json()) == 1


def test_dashboard_empty_scope_sums_nothing(client, admin):
    pid = client.post("/api/projects", headers=admin, json={"project_name": "Dash P"}).json()["id"]
    client.post(f"/api/projects/{pid}/revenue", headers=admin, json={"amount": 500, "recognition_date": "2026-05-01"})
    d = client.get("/api/dashboard/summary", headers=admin, params={"customer_ids": "no-such-customer"}).json()
    assert d["totals"]["total_projects"] == 0 and d["recognized_unbilled"]["recognized"] == 0
    assert client.get("/api/dashboard/summary", headers=admin, params={"section": "projects"}).status_code == 200


def test_frontend_and_backend_sections_match():
    import pathlib
    import re
    from sections import SECTIONS
    js = (pathlib.Path(__file__).parents[2] / "frontend/src/config/sections.js").read_text()
    assert re.findall(r'\{ key: "([a-z_]+)"', js) == SECTIONS
