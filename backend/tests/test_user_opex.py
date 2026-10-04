"""What a user sees in Opex: only the tabs an admin enables (Opex lines by default) with the latest / old PO from the
tracker; edits stay the user's drafts until submitted as one batch that the admin approves at once; views are kept
per user on the server."""
import io

import openpyxl

from test_opex_schema import refined_rows

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _book(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "opex_lines"
    for r in rows:
        ws.append(list(r))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_user_opex_tabs_drafts_batches_and_views(client, admin, make_user):
    r = client.post("/api/aop/datasets/opex_lines/upload?mode=upsert", headers=admin,
                    files={"file": ("opex.xlsx", _book(refined_rows()), XLSX)})
    assert r.status_code == 200, r.text
    # let users edit the FY'27 budget, with approval
    cols = client.get("/api/aop/datasets/opex_lines/columns", headers=admin).json()
    for c in cols:
        if c["key"] == "B27__annual":
            c["user_editable"] = True
    assert client.put("/api/aop/datasets/opex_lines/columns", headers=admin, json=cols).status_code == 200
    user = make_user({"aop_opex": {"can_view": True, "can_edit": True}})

    # ---- only Opex lines in the Opex section for users; the other datasets are closed to them
    tabs = [d["key"] for d in client.get("/api/aop/datasets", headers=user).json() if d["section"] == "aop_opex"]
    assert tabs == ["opex_lines"]
    assert client.get("/api/aop/datasets/opex_tracker/rows", headers=user).status_code == 403
    rows = client.get("/api/aop/datasets/opex_lines/rows?q=OPA60", headers=user).json()["rows"]
    line = next(x for x in rows if x["fields"].get("aop_code") == "OPA60")
    key = line["key"]
    assert line["fields"]["latest_po"] == "4200000001"            # no tracker mapping yet → its own PO

    # ---- edit → draft: the user sees the new number, the admin still sees the approved one
    e = client.patch("/api/aop/datasets/opex_lines/rows", headers=user, json=[{"key": key, "field": "B27__annual", "value": 99}])
    assert e.json()["queued"] == 1
    mine = client.get(f"/api/aop/datasets/opex_lines/rows?keys={key}", headers=user).json()["rows"][0]
    assert mine["fields"]["B27__annual"] == 99 and mine["pending"]["B27__annual"]["status"] == "draft"
    adm = client.get(f"/api/aop/datasets/opex_lines/rows?keys={key}", headers=admin).json()["rows"][0]
    assert adm["fields"]["B27__annual"] == 12e7 and "pending" not in adm          # drafts are the user's own
    assert client.get("/api/aop/changes/drafts", headers=user).json()["drafts"] == 1
    assert client.get("/api/aop/change-batches", headers=admin).json() == []

    # ---- submit → one batch for the admin
    b = client.post("/api/aop/changes/submit", headers=user, json={"note": "FY27 budget"}).json()
    assert b["count"] == 1 and b["status"] == "pending"
    assert client.post("/api/aop/changes/submit", headers=user, json={}).status_code == 400
    adm = client.get(f"/api/aop/datasets/opex_lines/rows?keys={key}", headers=admin).json()["rows"][0]
    assert adm["pending"]["B27__annual"]["status"] == "pending" and adm["fields"]["B27__annual"] == 12e7
    batches = client.get("/api/aop/change-batches", headers=admin).json()
    assert [x["id"] for x in batches] == [b["id"]]
    detail = client.get(f"/api/aop/change-batches/{b['id']}", headers=admin).json()
    assert detail["changes"][0]["field_label"] == "Budgeted FY'27" and detail["changes"][0]["line"]["aop_code"] == "OPA60"
    x = client.get(f"/api/aop/change-batches/{b['id']}/export", headers=admin)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    assert client.post(f"/api/aop/change-batches/{b['id']}/decide", headers=user, json={"approve": True}).status_code == 403

    # ---- approve the whole batch at once
    d = client.post(f"/api/aop/change-batches/{b['id']}/decide", headers=admin, json={"approve": True}).json()
    assert d["decided"] == 1 and d["batch"]["status"] == "approved"
    adm = client.get(f"/api/aop/datasets/opex_lines/rows?keys={key}", headers=admin).json()["rows"][0]
    assert adm["fields"]["B27__annual"] == 99 and adm["fields"]["B27__2026-04"] == round(99 / 12, 2)

    # ---- discard drafts
    client.patch("/api/aop/datasets/opex_lines/rows", headers=user, json=[{"key": key, "field": "B27__annual", "value": 5}])
    assert client.post("/api/aop/changes/discard", headers=user, json={}).json()["discarded"] == 1

    # ---- admin decides which tabs users see
    cfg = client.put("/api/aop/config", headers=admin, json={"user_tabs": {"aop_opex": ["opex_lines", "opex_tracker"]}}).json()
    assert cfg["user_tabs"]["aop_opex"] == ["opex_lines", "opex_tracker"]
    tabs = [d["key"] for d in client.get("/api/aop/datasets", headers=user).json() if d["section"] == "aop_opex"]
    assert set(tabs) == {"opex_lines", "opex_tracker"}
    client.put("/api/aop/config", headers=admin, json={"user_tabs": {"aop_opex": ["opex_lines"]}})

    # ---- a user's own view is kept on the server
    view = {"order": ["aop_code", "po"], "hidden": ["wbs"], "sort": {"key": "aop_code", "dir": "asc"}, "filters": {"tag": ["DIAL"]}}
    assert client.put("/api/aop/my-views/aop_grid_opex_lines_v1", headers=user, json=view).status_code == 200
    assert client.get("/api/aop/my-views", headers=user).json()["aop_grid_opex_lines_v1"] == view
    assert client.get("/api/aop/my-views", headers=admin).json().get("aop_grid_opex_lines_v1") is None
