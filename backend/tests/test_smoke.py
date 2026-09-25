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
