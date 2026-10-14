"""FX rates fetched from the internet (mocked): the Fetch button endpoint, hand-entered rates kept, range mode."""
from aop import po_pipeline as PP


def test_fetch_fx_endpoint_saves_rates_and_keeps_manual(client, admin, monkeypatch):
    calls = []

    async def fake(cur, start, end, dates=None):
        calls.append((cur, start, end, len(dates or [])))
        if cur == "XXX":
            raise RuntimeError("offline")
        return {"2026-09-01": 100.5, "2026-09-02": 101.0}, "ECB reference (auto)"
    monkeypatch.setattr(PP, "fetch_fx_series", fake)
    # a hand-typed rate for the same day must survive
    r = client.post("/api/aop/datasets/fx_rates/rows", headers=admin,
                    json=[{"currency": "USD", "date": "2026-09-01", "rate": 84.0, "source": "Treasury"}])
    assert r.status_code == 200, r.text
    r = client.post("/api/aop/fx-rates/fetch", headers=admin,
                    json={"start": "2026-09-01", "end": "2026-09-02", "currencies": "USD, EUR"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["currencies"] == ["EUR", "USD"] and body["saved"] == 3 and body["by_currency"] == {"USD": 1, "EUR": 2}
    assert all(c[1] == "2026-09-01" and c[2] == "2026-09-02" and c[3] == 2 for c in calls)
    rows = {(x["fields"]["currency"], x["fields"]["date"]): x["fields"]
            for x in client.get("/api/aop/datasets/fx_rates/rows?limit=500", headers=admin).json()["rows"]}
    assert rows[("USD", "2026-09-01")]["rate"] == 84.0 and rows[("EUR", "2026-09-02")]["source"] == "ECB reference (auto)"
    # again: nothing new; an unreachable source for every currency → 502
    assert client.post("/api/aop/fx-rates/fetch", headers=admin,
                       json={"start": "2026-09-01", "end": "2026-09-02", "currencies": "USD,EUR"}).json()["saved"] == 0
    r = client.post("/api/aop/fx-rates/fetch", headers=admin, json={"start": "2026-09-01", "end": "2026-09-02", "currencies": "XXX"})
    assert r.status_code == 502 and "offline" in r.json()["detail"]
    assert client.post("/api/aop/fx-rates/fetch", headers=admin, json={"start": "2026-09-05", "end": "2026-09-01"}).status_code == 400


def test_fetch_series_ecb_then_daily_market_fallback(monkeypatch):
    import asyncio
    import httpx

    def handler(req):
        u = str(req.url)
        if "frankfurter" in u:
            if "from=AED" in u:
                return httpx.Response(404, json={"message": "not found"})
            return httpx.Response(200, json={"rates": {"2026-09-01": {"INR": 97.1}, "2026-09-02": {"INR": 97.4}}})
        if "jsdelivr" in u and "2026-09-02" in u:
            return httpx.Response(200, json={"aed": {"inr": 22.9}})
        return httpx.Response(404)
    real = httpx.AsyncClient
    loop = asyncio.new_event_loop()  # not asyncio.run: that clears the current loop other tests rely on
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    got, src = loop.run_until_complete(PP.fetch_fx_series("EUR", "2026-09-01", "2026-09-02"))
    assert got == {"2026-09-01": 97.1, "2026-09-02": 97.4} and src == "ECB reference (auto)"
    got, src = loop.run_until_complete(PP.fetch_fx_series("AED", "2026-09-01", "2026-09-02", ["2026-09-02"]))
    assert got == {"2026-09-02": 22.9} and src == "Daily market rate (auto)"
    loop.close()
