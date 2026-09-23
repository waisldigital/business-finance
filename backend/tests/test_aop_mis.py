"""MIS report formats: segment split, revenue performance and regional P&L on synthetic data."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aop import mis  # noqa: E402
from aop.periods import fy_months  # noqa: E402
from aop.pnl import Filters  # noqa: E402

CFG = {"base_fy": "FY26", "plan_fy": "FY27", "draft_fy": "FY28", "cutoffs": {"default": "2025-12"}, "tax_rate": 0.25}


def _b(v):
    return {f"B27__{p}": v for p in fy_months("FY27")}


DATA = {
    "rev_cute": [{"airport": "DIAL", "tag": "DIAL", **_b(100.0)}],
    "rev_noncute": [{"stream": "Non-CUTE", "location": "DIAL", "tag": "DIAL", "geo": "India", **_b(10.0)},
                    {"stream": "Non-CUTE", "location": "Kuwait", "tag": "Kuwait", "geo": "India", **_b(5.0)}],
    "rev_projects": [{"category": "Projects", "geo": "India", "region": "India", "tag": "Other GMR Projects", **_b(40.0)},
                     {"category": "Projects", "geo": "International", "region": "EU & UK", "tag": "X", **_b(30.0)},
                     {"category": "Projects", "geo": "International", "region": "SEA", "tag": "Y", **_b(10.0)}],
    "payroll_lines": [{"category": "Overheads", "tag": "Front-End Sales", "geo": "International", "location": "EU & UK", **_b(8.0)},
                      {"category": "Overheads", "tag": "HR", "geo": "India", "location": "India", **_b(6.0)}],
    "overhead_lines": [{"pl_tag": "Admin", "geo": "India", **_b(4.0)}],
}


def _pnl_payload():
    e0, e1 = mis.engines(DATA, [], CFG)
    runs = [e0.compute(Filters()), e1.compute(Filters())]
    blocks, rows = [], []
    for key, eng, part in [("a_base", 0, "base"), ("b_plan", 0, "plan"), ("af_plan", 1, "base"), ("b_draft", 1, "plan")]:
        fy = runs[eng]["meta"]["base_fy" if part == "base" else "plan_fy"]
        cols = [{"key": f"{key}:{c['key']}", "month": True, "src": (eng, c["key"])} for c in runs[eng]["columns"] if c.get("fy") == fy]
        cols.append({"key": f"{key}:total", "src": (eng, "af_base" if part == "base" else "b_plan")})
        blocks.append({"key": key, "columns": cols})
    second = {x["id"]: x for x in runs[1]["rows"]}
    for r0 in runs[0]["rows"]:
        v0, v1 = r0["values"] or {}, second[r0["id"]]["values"] or {}
        rows.append({"id": r0["id"], "pct": r0["pct"],
                     "values": {c["key"]: (v0 if c["src"][0] == 0 else v1).get(c["src"][1]) for b in blocks for c in b["columns"]}})
    return {"blocks": blocks, "rows": rows}


def test_full_pnl_segments_add_up():
    out = mis.full_pnl(_pnl_payload(), CFG, True, mis.solutions_noncute(DATA, [], CFG, Filters()))
    by = {r["id"]: r for r in out["rows"]}
    rev = by["rev"]["values"]["b_plan"]
    assert rev["total"][12] == 12 * (100 + 10 + 5 + 40 + 30 + 10)
    assert rev["sol"][12] == 12 * (40 + 30 + 10 + 5)            # projects + Kuwait non-CUTE
    assert rev["cacr"][12] == 12 * 110
    ind = by["emp_indirect"]["values"]["b_plan"]
    assert ind["sol"][0] == 8.0 + 6.0 * (85 / 195)              # sales → Solutions, HR common by revenue
    for rid in ("gm", "ebitda", "pat"):
        v = by[rid]["values"]["b_plan"]
        assert abs(v["cacr"][12] + v["sol"][12] - v["total"][12]) < 1e-6


def test_masking_hides_resource_lines():
    out = mis.full_pnl(_pnl_payload(), CFG, False)
    by = {r["id"]: r for r in out["rows"]}
    assert by["emp_indirect"]["masked"] and by["emp_indirect"]["values"] is None
    assert by["ebitda"]["values"] is not None


def test_regional_split_ties_to_total():
    out = mis.regional_pnl(DATA, [], CFG, True)
    by = {r["id"]: r for r in out["rows"]}
    rev = by["rev"]["values"]["b_plan"]
    assert rev["india"][0] == 40 and rev["europe"][0] == 30 and rev["sea"][0] == 10 and rev["intl"][0] == 40
    for rid in ("gm", "sales", "cm", "ebitda"):
        v = by[rid]["values"]["b_plan"]
        assert abs(v["india"][12] + v["intl"][12] - v["total"][12]) < 1e-6
        assert abs(sum(v[c][12] for c in ("me", "sea", "europe", "anz", "americas")) - v["intl"][12]) < 1e-6
    assert by["sales"]["values"]["b_plan"]["europe"][0] == 8.0   # directly attributable by payroll location


def test_revenue_performance_rows():
    out = mis.revenue_performance(DATA, [], CFG, Filters())
    by = {r["id"]: r for r in out["rows"]}
    assert by["total"]["values"]["b_plan"][12] == 12 * 195
    assert by["cute_dial"]["parent"] == "cute"
    assert by["pj_international"]["values"]["b_plan"][0] == 40
