"""Regional P&L double-click: the package rows (with their cells) and the SAP expense lines behind a cell, tied to it."""
import io
from datetime import datetime

import openpyxl

from aop.mis_drill import compress_cells
from tests.test_package_actuals import XLSX, package


def mis_working(fy):
    """A small MIS working file: SAP_Revenue (empty), SAP_Expense (one project opex line, one overhead line), Mapping."""
    y = 2000 + int(fy[2:]) - 1
    apr = datetime(y, 4, 1)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "SAP_Revenue"
    ws.append(["Company Code", "Posting Date", "Month", "Revenue Tag", "Group Currency Value", "Classification", "Project Name", "WBS Element"])
    ws = wb.create_sheet("SAP_Expense")
    head = ["Company Code", "Posting Date", "Month", "Document Number", "Supplier Name", "G/L Account", "G/L Account: Long Text",
            "WBS Element", "PO Number", "Cost Center: Long Text", "Text", "Amount_INR", "Reversal Tag", "Final Exp.Cat.",
            "Business Unit", "Department", "Sub-Function", "Nature of services"]
    ws.append(head)
    ws.append(["1000", apr, apr, "5100001", "Acme Telecom", "520100", "Third party services", "WSUK.1.2", "4500001", "UK delivery",
               "Link rental Apr", 3_00_000, None, "Opex", "Solutions", "Delivery", "IAG", "AMC & CMC"])
    ws.append(["1000", apr, apr, "5100002", "Cab Co", "530200", "Travel", None, None, "Admin CC", "Cabs", 50_000, None,
               "Overheads", "CA", "Admin", "Travel", "Travel"])
    ws = wb.create_sheet("Mapping")
    ws.append(["Project ID", "WBS Element", "Project Name", "P&L Head", "P&L Region", "Category - 1 (CR/Projects)", "For P&L Filter(Reporting Tag)"])
    ws.append(["WDP001", "WSUK.1", "IAG", "International", "EU & UK", "Projects", "IAG"])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_compress_cells():
    assert compress_cells(["Project Summary!K14", "Project Summary!L14", "Project Summary!M14"]) == "Project Summary!K14:M14"
    assert compress_cells(["S!B2", "S!D2"]) == "S!B2; S!D2"
    assert compress_cells(["S!B2", "S!B3"]) == "S!B2; S!B3"
    assert compress_cells(["Opex!F5 − F9 × 0.500"]) == "Opex!F5 − F9 × 0.500"


def seed_master():
    """The project master carries each project's P&L region (actuals resolve their region through it). Idempotent."""
    import asyncio
    import server
    rows = (("WDP001", "IAG", "International", "Europe"), ("WDP014", "SAC ICT", "India", "India"))

    async def go():
        for i, (pid, name, geo, region) in enumerate(rows):
            await server.db.aop_rows.update_one({"dataset": "project_master", "key": pid}, {"$set": {"seq": i, "fields": {
                "project_id": pid, "project_name": name, "category": "Projects", "geo": geo, "region": region, "tag": name}}}, upsert=True)
    asyncio.get_event_loop().run_until_complete(go())


def test_regional_drill(client, admin):
    cfg = client.get("/api/aop/config", headers=admin).json()
    fy = cfg["plan_fy"]
    seed_master()
    r = client.post("/api/aop/import/reporting-package", headers=admin, files={"file": ("pkg.xlsx", package(fy), XLSX)})
    assert r.status_code == 200, r.text
    r = client.post("/api/aop/import/mis-actuals", headers=admin, files={"file": ("mis.xlsx", mis_working(fy), XLSX)})
    assert r.status_code == 200, r.text
    q = {"measure": "af_plan", "period": "ytd", "month": 1}
    reg = client.get("/api/aop/mis/regional", headers=admin).json()
    cell = lambda rid, col: sum(next(x for x in reg["rows"] if x["id"] == rid)["values"]["af_plan"][col][:2])

    # ---- revenue: package rows with the cells they were read from, tying to the report
    d = client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "rev", "col": "europe", **q}).json()
    assert d["kind"] == "revenue" and d["col"]["label"] == "Europe"
    sec = d["sections"][0]
    iag = next(x for x in sec["rows"] if x["label"] == "IAG")
    assert iag["total"] == 1e7 and iag["cells"] == "Project Summary!J8" and "Financial Reporting Package" in iag["source"]
    assert abs(sec["total"] - d["value"]) < 1 and abs(d["value"] - cell("rev", "europe")) < 1
    assert [m["kind"] for m in d["months"]] == ["A", "A"]

    # ---- expense: the package rows and, beneath them, the SAP expense dump lines of this region
    d = client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "tp_opex", "col": "europe", **q}).json()
    pkg, sap = d["sections"]
    assert abs(pkg["total"] - cell("tp_opex", "europe")) < 1 and next(x for x in pkg["rows"] if x["label"] == "IAG")["cells"].startswith("Project Summary!")
    assert sap["kind"] == "ledger" and sap["count"] == 1
    line = sap["lines"][0]
    assert line["doc"] == "5100001" and line["vendor"] == "Acme Telecom" and line["gl"] == "520100" and line["amount"] == 3_00_000
    assert next(x for x in pkg["rows"] if x["label"] == "IAG")["sap_total"] == 3_00_000
    # another region has none of it
    d = client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "tp_opex", "col": "me", **q}).json()
    assert d["sections"][1]["count"] == 0

    # ---- total column, resource cost, and the combined "direct" line
    d = client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "direct", "col": "total", **q}).json()
    assert [p["title"] for p in d["parts"]] == ["Direct expenses — TP opex", "Direct expenses — resource cost"]
    assert abs(d["value"] - cell("direct", "total")) < 1
    assert abs(d["parts"][0]["sections"][0]["total"] - cell("tp_opex", "total")) < 1
    assert abs(d["parts"][1]["sections"][0]["total"] - cell("res_opex", "total")) < 1

    # ---- derived lines list their components
    d = client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "gm", "col": "total", **q}).json()
    assert d["kind"] == "derived" and [c["id"] for c in d["components"]] == ["rev", "direct"]
    assert abs(sum(c["sign"] * c["value"] for c in d["components"]) - d["value"]) < 1

    # ---- every drillable line answers, and the listed lines tie to the cell
    for row in ("tp_opex", "res_opex", "sales", "marketing", "tp_oh", "res_oh", "ebitda", "cm", "gm_pct"):
        for col in ("india", "intl", "total"):
            rr = client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": row, "col": col, **q})
            assert rr.status_code == 200, (row, col, rr.text)
    assert client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "nope", "col": "total", **q}).status_code == 404
    assert client.get("/api/aop/mis/regional/drill", headers=admin, params={"row": "rev", "col": "mars", **q}).status_code == 404


def test_regional_drill_respects_payroll_confidentiality(client, admin, make_user):
    fy = client.get("/api/aop/config", headers=admin).json()["plan_fy"]
    seed_master()
    client.post("/api/aop/import/reporting-package", headers=admin, files={"file": ("pkg.xlsx", package(fy), XLSX)})
    viewer = make_user({"aop_pnl": {"can_view": True}})  # may open the P&L reports, not payroll
    q = {"measure": "af_plan", "period": "ytd", "month": 1, "col": "total"}
    ok = client.get("/api/aop/mis/regional/drill", headers=viewer, params={"row": "tp_opex", **q})
    assert ok.status_code == 200 and ok.json()["kind"] == "expense"
    assert client.get("/api/aop/mis/regional/drill", headers=viewer, params={"row": "res_opex", **q}).status_code == 403
    d = client.get("/api/aop/mis/regional/drill", headers=viewer, params={"row": "direct", **q}).json()
    assert [p["title"] for p in d["parts"]] == ["Direct expenses — TP opex"]  # the resource part is left out, not leaked
    for row in ("res_oh", "sales_payroll"):
        r = client.get("/api/aop/mis/regional/drill", headers=viewer, params={"row": row, **q})
        assert r.status_code == 403 or not r.json().get("cards")
    nobody = make_user({"dashboard": {"can_view": True}})
    assert client.get("/api/aop/mis/regional/drill", headers=nobody, params={"row": "rev", **q}).status_code == 403
