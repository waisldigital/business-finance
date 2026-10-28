"""AOP / package projects in the Projects section: sync, AOP-vs-actual tab, document slots."""
from tests.test_package_actuals import XLSX, package
from tests.test_regional_drill import mis_working, seed_master


def _projects(client, admin):
    return {p["aop_project_id"]: p for p in client.get("/api/projects", headers=admin).json() if p.get("aop_project_id")}


def test_projects_from_aop_and_package(client, admin):
    fy = client.get("/api/aop/config", headers=admin).json()["plan_fy"]
    seed_master()
    r = client.post("/api/aop/import/reporting-package", headers=admin, files={"file": ("pkg.xlsx", package(fy), XLSX)})
    assert r.status_code == 200, r.text
    assert r.json()["projects"]["candidates"] >= 2  # the import brought the projects into the Projects section
    assert {"WDP001", "WDP014"} <= set(_projects(client, admin))
    client.post("/api/aop/import/mis-actuals", headers=admin, files={"file": ("mis.xlsx", mis_working(fy), XLSX)})

    got = _projects(client, admin)
    iag = got["WDP001"]
    assert iag["project_name"] == "IAG" and iag["source"] == "aop" and iag["pnl_region"] in ("Europe", "EU & UK") and iag["current_stage"] == "Operations"
    assert iag["country"] == "International" and iag["category1"] == "Projects"
    assert iag["wbs_element"] == "WSUK.1"  # from the package's Project Summary

    # a user fills in what AOP does not have; a later sync keeps it and does not duplicate the project
    body = {k: v for k, v in iag.items() if k not in ("id", "margin_total", "margin_pct", "created_at", "updated_at", "created_by", "current_stage", "approval_status")}
    body.update(customer_po_number="PO-778", agreement_number="AGR-1", agreement_date="2026-03-01", agreement_value=5e7, customer_name="IAG plc")
    assert client.put(f"/api/projects/{iag['id']}", headers=admin, json=body).status_code == 200
    s = client.post("/api/aop/projects/sync", headers=admin).json()
    assert s["created"] == 0
    again = _projects(client, admin)["WDP001"]
    assert again["id"] == iag["id"] and again["customer_po_number"] == "PO-778" and again["agreement_number"] == "AGR-1"
    assert again["aop_project_id"] == "WDP001" and again["source"] == "aop"  # the form cannot detach the AOP link

    # AOP vs actual: the same numbers the reports show
    f = client.get(f"/api/aop/projects/{iag['id']}/financials", headers=admin).json()
    by = {l["key"]: l for l in f["lines"]}
    assert f["linked"] and f["actual_months"] >= 2 and f["months"][0]["actual"]
    assert by["revenue"]["actual"][0] == 1e7 and by["tp_opex"]["actual"][:2] == [5e6, 5e6] and by["resource"]["actual"][1] == 2e6
    assert by["gm"]["actual"][0] == 1e7 - 5e6 - 0 and by["revenue"]["af"][12] >= 1e7
    assert by["revenue"]["actual"][11] is None  # no actual after the cut-off

    # the Projects list gets every linked project's figures in one call
    sm = client.get("/api/aop/projects/summary", headers=admin).json()
    assert sm["plan_fy"] == fy and sm["projects"][iag["id"]]["rev_act_ytd"] == 1e7 and sm["projects"][iag["id"]]["linked"]
    assert abs(sm["projects"][iag["id"]]["gm_pct_ytd"] - (-0.2)) < 1e-9  # revenue 1.0 Cr, opex 1.0 Cr + resources 0.2 Cr to the cut-off

    # a project with no AOP link answers with zeros, not an error
    mine = client.post("/api/projects", headers=admin, json={"project_name": "Manual deal"}).json()
    f2 = client.get(f"/api/aop/projects/{mine['id']}/financials", headers=admin).json()
    assert f2["linked"] is False and all(not any(l["aop"]) for l in f2["lines"])
    assert client.get("/api/aop/projects/nope/financials", headers=admin).status_code == 404


def test_project_document_slots(client, admin):
    types = client.get("/api/projects/document-types", headers=admin).json()
    assert [t["key"] for t in types][:2] == ["agreement", "customer_po"] and types[-1]["key"] == "other"
    pid = client.post("/api/projects", headers=admin, json={"project_name": "Docs deal"}).json()["id"]
    up = client.post(f"/api/projects/{pid}/documents", headers=admin, params={"name": "Signed agreement", "doc_type": "agreement"},
                     files={"file": ("agreement.pdf", b"%PDF-1.4 test", "application/pdf")})
    assert up.status_code == 200 and up.json()["document"]["doc_type"] == "agreement"
    docs = client.get(f"/api/projects/{pid}/documents", headers=admin).json()
    assert [d["doc_type"] for d in docs] == ["agreement"]
    bad = client.post(f"/api/projects/{pid}/documents", headers=admin, params={"name": "x", "doc_type": "nonsense"},
                      files={"file": ("a.txt", b"x", "text/plain")})
    assert bad.status_code == 400
