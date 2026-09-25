"""Drill-down report formats of the MIS pack (slides 10, 12, 13, 20–26), on the same datasets and actual source.

Values are 13-slot vectors (12 fiscal months + full year) per measure, so the screen can show FY / YTD / MTD
for any month without another round trip:

* ``a_base``  — prior year actual (PY)
* ``b_plan``  — current year AOP
* ``af_plan`` — current year actual to the cut-off, forecast after it
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

from .datasets import norm, version_months, vkey
from .mis import MEASURES, N, OH_BLOCKS, Vec, engines, measure_labels, measures_of, months_meta, vsum, zero
from .actuals_import import OPEX_CATEGORIES, opex_category
from .periods import fy_months
from .pnl import Filters, Series

AIRPORTS = ["DIAL", "GHIAL", "GGIAL", "GVIAL"]


def _n(v) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _vec_from(values_by_period: Dict[str, float], months: List[str]) -> Vec:
    v = [float(values_by_period.get(p, 0.0)) for p in months]
    return Vec(v + [sum(v)])


def _plain(d: Dict[str, Vec]) -> Dict[str, List[float]]:
    return {k: list(v) for k, v in d.items()}


def _meta(cfg):
    return {"measures": [m for m in measure_labels(cfg) if m["key"] in ("a_base", "b_plan", "af_plan")],
            "months": months_meta(cfg), "plan_fy": cfg["plan_fy"], "base_fy": cfg["base_fy"]}


def _act_months(cfg, domain: str) -> List[str]:
    cut = (cfg.get("cutoffs") or {}).get(domain) or (cfg.get("cutoffs") or {}).get("default") or ""
    return [p for p in fy_months(cfg["plan_fy"]) if p <= cut]


# ---------------------------------------------------------------------------------------------- slide 10
def airport_gm(data, actuals, cfg, payroll_visible: bool) -> Dict[str, Any]:
    """Airport-wise gross margin (CA + CR): revenue, revenue share, TP opex (shared services allocated with the
    Assumptions split), direct employee cost, gross margin — PY / AOP / Act per airport."""
    e0, e1 = engines(data, actuals, cfg)
    cols = AIRPORTS + ["total"]
    lines = {  # id → engine row ids summed
        "cute": ["cute"], "non_cute": ["non_cute"], "cr": ["change_request"], "rev_share": ["revenue_share"],
        "opex": ["tp_opex_ca", "tp_opex_cr"], "emp": ["resource_cost_ca", "resource_cost_cr"],
    }
    vals: Dict[str, Dict[str, Dict[str, Vec]]] = {k: {} for k in lines}
    for a in AIRPORTS:
        r0 = {r["id"]: r["values"] for r in e0.compute(Filters(tag=a))["rows"]}
        r1 = {r["id"]: r["values"] for r in e1.compute(Filters(tag=a))["rows"]}
        for lid, ids in lines.items():
            vals[lid][a] = {
                "a_base": vsum(_vec_from(r0[i], e0.base_m) for i in ids),
                "b_plan": vsum(_vec_from(r0[i], e0.plan_m) for i in ids),
                "af_plan": vsum(_vec_from(r1[i], e1.base_m) for i in ids),
            }
    for lid in lines:
        vals[lid]["total"] = {m: vsum(vals[lid][a][m] for a in AIRPORTS) for m in ("a_base", "b_plan", "af_plan")}

    def comb(parts, signs):
        return {c: {m: vsum(vals[p][c][m] * s for p, s in zip(parts, signs)) for m in ("a_base", "b_plan", "af_plan")} for c in cols}

    vals["rev"] = comb(["cute", "non_cute", "cr"], [1, 1, 1])
    vals["gm"] = comb(["rev", "rev_share", "opex", "emp"], [1, -1, -1, -1])
    rows = [
        ("cute", "CUTE Revenue", 1, "line", False, "cute_analysis"), ("non_cute", "Non-CUTE Revenue", 1, "line", False, None),
        ("cr", "Change Request", 1, "line", False, None), ("rev", "Total Revenue", 1, "total", False, "revenue_performance"),
        ("rev_share", "Revenue Share", -1, "line", False, None), ("opex", "Operating Expenses (TP)", -1, "line", False, "opex_analysis"),
        ("emp", "Employee Cost — Direct", -1, "line", True, "resources"), ("gm", "Gross Margin", 1, "total", False, None),
    ]
    out = []
    for rid, label, sign, kind, sens, drill in rows:
        masked = sens and not payroll_visible
        out.append({"id": rid, "label": label, "sign": sign, "kind": kind, "drill": drill, "masked": masked,
                    "values": None if masked else {c: _plain(vals[rid][c]) for c in cols}})
    out.append({"id": "gm_pct", "label": "GM %", "kind": "pct", "ratio": ["gm", "rev"], "sign": 1})
    return {**_meta(cfg), "columns": [{"key": c, "label": "Total CA" if c == "total" else c} for c in cols], "rows": out}


# ---------------------------------------------------------------------------------------------- slide 12
def project_health(data, actuals, cfg, payroll_visible: bool) -> Dict[str, Any]:
    """Solutions projects: TCV, deal margin, YTD revenue / cost / gross margin, AOP vs actual."""
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    B = "B" + plan[2:]
    master = {r.get("project_id"): r for r in data.get("project_master", []) if r.get("project_id")}
    key = lambda v: re.sub(r"[^0-9a-z]+", "", str(v or "").lower())  # "SAC - ICT" ≈ "SAC ICT"
    by_name = {key(r.get("project_name")): pid for pid, r in master.items() if r.get("project_name")}
    sap_name: Dict[str, str] = {}
    rev_aop: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in data.get("rev_projects", []):
        if norm(r.get("category")) != "projects" or not r.get("project_id"):
            continue
        for p in pm_:
            rev_aop[r["project_id"]][p] += _n(r.get(vkey(B, p)))
        if r.get("project_name"):
            by_name.setdefault(key(r["project_name"]), r["project_id"])
    # actuals carry the SAP project name; learn name → id from bookings that also carry the id
    for a in actuals:
        d = a.get("dims") or {}
        if d.get("project") and d.get("project_id"):
            by_name.setdefault(key(d["project"]), d["project_id"])
            sap_name.setdefault(d["project_id"], d["project"])

    def pid_of(d) -> Optional[str]:
        name = d.get("project") or d.get("tag") or d.get("department")
        pid = d.get("project_id") or by_name.get(key(name))
        if not pid and name:  # a project the master doesn't know yet: its own row under the SAP name
            pid = f"name:{name}"
            sap_name.setdefault(pid, name)
        return pid

    act_m = set(_act_months(cfg, "default"))
    rev_act: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cost_act: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    unmatched: Dict[str, float] = defaultdict(float)
    for a in actuals:
        if a["period"] not in pm_:
            continue
        d = a.get("dims") or {}
        if a["domain"] == "rev_projects" and norm(d.get("stream")) == "projects":
            pid = pid_of(d)
            (rev_act[pid] if pid else unmatched)[a["period"] if pid else "rev"] += a["amount"]
        elif (a["domain"] == "opex" and norm(d.get("category")) == "projects") or \
                (a["domain"] == "payroll" and norm(d.get("category")) == "projects"):
            pid = pid_of(d)
            if pid:
                cost_act[pid][a["period"]] += a["amount"]
            else:
                unmatched["cost"] += a["amount"]
    ids = sorted(set(rev_aop) | set(rev_act) | set(cost_act) |
                 {pid for pid, r in master.items() if norm(r.get("category")) == "projects" and _n(r.get("revenue_b_fy_27"))})
    rows = []
    for pid in ids:
        m = master.get(pid, {})
        annual_cost = _n(m.get("tp_cost_b_plan")) + _n(m.get("resource_b_fy_27"))
        cost_aop = {p: annual_cost / 12 for p in pm_}
        # actual/forecast: bookings to the cut-off, AOP phasing after it
        ra = {p: (rev_act[pid].get(p, 0.0) if p in act_m else rev_aop[pid].get(p, 0.0)) for p in pm_}
        ca = {p: (cost_act[pid].get(p, 0.0) if p in act_m else cost_aop[p]) for p in pm_}
        rows.append({"id": pid, "label": m.get("project_name") or sap_name.get(pid) or pid, "region": m.get("region") or m.get("geo"),
                     "tcv": _n(m.get("tcv")) or _n(m.get("inr_po_value")) or None,
                     "deal_margin": m.get("b_fy_27gm") if isinstance(m.get("b_fy_27gm"), (int, float)) else m.get("project_gm"),
                     "customer": m.get("customer"), "owner": m.get("sales_owner"),
                     "rev": {"b_plan": list(_vec_from(rev_aop[pid], pm_)), "af_plan": list(_vec_from(ra, pm_))},
                     "cost": {"b_plan": list(_vec_from(cost_aop, pm_)), "af_plan": list(_vec_from(ca, pm_))}})
    rows = [r for r in rows if any(r["rev"]["b_plan"]) or any(r["rev"]["af_plan"]) or any(r["cost"]["af_plan"])]
    return {**_meta(cfg), "rows": rows, "unmatched": {k: round(v, 2) for k, v in unmatched.items()},
            "note": "Cost = TP opex + project resource cost. Actual months use bookings; later months the AOP phasing."}


# ---------------------------------------------------------------------------------------------- slide 13
CAPEX_ORDER = ["DIAL", "GVIAL", "GHIAL", "GGIAL", "Digital", "Product/Projects*", "Product", "COE", "Corporate", "International"]


def capex_tracker(data, actuals, cfg) -> Dict[str, Any]:
    """Location → category (level 2) → AOP capex lines (level 3). Tracker rows (initial budget, capex till last
    year, monthly actuals, open PO / PR) come from the capex tracker dataset; categories without tracker rows
    fall back to the capex lines budget and the capex postings of the year."""
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    A = "A" + plan[2:]
    tracker = data.get("capex_tracker", [])
    lines = data.get("capex_lines", [])
    hist = {norm(h.get("location")): h for h in data.get("capex_history", [])}
    loc_alias = {"ebabling capex": "Corporate", "enabling capex": "Corporate", "product": "Product/Projects*",
                 "product/projects": "Product/Projects*", "others": "Corporate"}

    def loc_of(v):
        s = str(v or "").strip()
        return loc_alias.get(norm(s), s) or "Unmapped"

    # postings of the year by location (capex GRNs / SAP capex) — used where the tracker has no monthly actuals
    posted: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for a in actuals:
        if a["domain"] in ("capex", "capex_sap") and a["period"] in pm_:
            posted[loc_of((a.get("dims") or {}).get("tag"))][a["period"]] += a["amount"]

    tree: Dict[str, Dict[str, Any]] = {}

    def node(loc):
        return tree.setdefault(loc, {"cats": {}, "tracked": False})

    for t in tracker:
        loc = loc_of(t.get("location"))
        cat = t.get("category") or t.get("project") or "Total"
        n = node(loc)
        n["tracked"] = True
        n["cats"][cat] = {"initial_budget": _n(t.get("initial_budget")) or None, "capex_till_base": _n(t.get("capex_till_base")) or None,
                          "budget": _n(t.get("budget_plan")), "open_po": _n(t.get("open_po")), "open_pr": _n(t.get("open_pr")),
                          "actual": [_n(t.get(vkey(A, p))) for p in pm_], "lines": []}
    # AOP capex lines: level 3 under their category (L2); categories only become level-2 rows where the tracker
    # doesn't already split the location
    for ln in lines:
        loc = loc_of(ln.get("tag") or ln.get("location"))
        if loc in ("Remove",):
            continue
        n = node(loc)
        cat = ln.get("l2") or "Others"
        amt = _n(ln.get("total"))
        item = {"label": ln.get("description_of_work") or ln.get("sub_systems") or ln.get("line_id"), "budget": amt,
                "sub_system": ln.get("sub_systems"), "department": ln.get("department"), "line_id": ln.get("line_id")}
        target = None
        if n["tracked"]:  # attach to a tracker category of the same name if there is one
            target = next((c for c in n["cats"] if norm(c).startswith(norm(cat)[:8]) or norm(cat).startswith(norm(c)[:8])), None)
        if target is None:
            target = cat if not n["tracked"] else "AOP capex lines (detail)"
            n["cats"].setdefault(target, {"initial_budget": None, "capex_till_base": None, "budget": 0.0, "open_po": 0.0,
                                          "open_pr": 0.0, "actual": [0.0] * 12, "lines": [], "from_lines": True})
            if n["cats"][target].get("from_lines") and not n["tracked"]:  # tracked locations keep the tracker budget
                n["cats"][target]["budget"] += amt
        n["cats"][target]["lines"].append(item)
    out = []
    for loc in sorted(tree, key=lambda x: (CAPEX_ORDER.index(x) if x in CAPEX_ORDER else 99, x)):
        n = tree[loc]
        cats = n["cats"]
        if not n["tracked"] and posted.get(loc):
            # postings are not split by category — show them on the location
            cats.setdefault("Actual not split by category", {"initial_budget": None, "capex_till_base": None, "budget": 0.0,
                                                             "open_po": 0.0, "open_pr": 0.0, "actual": [0.0] * 12, "lines": []})
            cats["Actual not split by category"]["actual"] = [posted[loc].get(p, 0.0) for p in pm_]
        h = hist.get(norm(loc), {})
        kids = []
        for cat, c in cats.items():
            kids.append({"label": cat, "initial_budget": c["initial_budget"], "capex_till_base": c["capex_till_base"],
                         "budget": c["budget"], "actual": c["actual"], "open_po": c["open_po"], "open_pr": c["open_pr"],
                         "lines": sorted(c["lines"], key=lambda x: -x["budget"])})
        tot = lambda k: sum(_n(x[k]) for x in kids)
        out.append({"label": loc, "initial_budget": tot("initial_budget") or _n(h.get("initial_budget")) or None,
                    "capex_till_base": tot("capex_till_base") or _n(h.get("actuals_till_fy25")) or None,
                    "budget": tot("budget"), "actual": [sum(x["actual"][i] for x in kids) for i in range(12)],
                    "open_po": tot("open_po"), "open_pr": tot("open_pr"),
                    "children": kids if len(kids) > 1 or (kids and kids[0]["label"] not in ("Total", loc)) else [],
                    "lines": kids[0]["lines"] if len(kids) == 1 else []})
    return {**_meta(cfg), "rows": out}


# ---------------------------------------------------------------------------------------------- slide 20
def cute_analysis(data, actuals, cfg, flt: Filters) -> Dict[str, Any]:
    """CUTE revenue = billable PAX × rate: revenue, PAX and per-PAX rate per airport and passenger type."""
    base, plan = cfg["base_fy"], cfg["plan_fy"]
    bm, pm_ = fy_months(base), fy_months(plan)
    cut_b = [p for p in bm if p <= ((cfg.get("cutoffs") or {}).get("default") or "")]
    act_p = set(_act_months(cfg, "default"))
    F, B = "F" + base[2:], "B" + plan[2:]
    rev: Dict[tuple, Dict[str, Dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    pax: Dict[tuple, Dict[str, List[float]]] = defaultdict(dict)
    rate: Dict[tuple, Dict[str, List[float]]] = defaultdict(dict)

    def ok(a):
        return flt.tag_ok(a)

    for r in data.get("rev_cute", []):  # one line per airport / passenger type, each FY in its own columns
        a, t = r.get("airport"), r.get("pax_type") or "Combined"
        if not ok(a):
            continue
        for p in pm_:
            rev[(a, t)]["b_plan"][p] += _n(r.get(vkey(B, p)))
        for p in bm:
            if p not in cut_b:
                rev[(a, t)]["a_base"][p] += _n(r.get(vkey(F, p)))
    for x in actuals:
        if x["domain"] != "rev_cute":
            continue
        d = x.get("dims") or {}
        a, t = d.get("tag"), d.get("pax_type") or "Combined"
        if not ok(a):
            continue
        if x["period"] in cut_b:
            rev[(a, t)]["a_base"][x["period"]] += x["amount"]
        elif x["period"] in act_p:
            rev[(a, t)]["af_plan"][x["period"]] += x["amount"]
    for r in data.get("rev_cute_drivers", []):
        a, t, metric = r.get("airport"), r.get("pax_type") or "Combined", norm(r.get("metric"))
        if not ok(a):
            continue
        target = pax if "pax" in metric else rate if "rate" in metric else None
        if target is None:
            continue
        # the base year's actual (else its forecast), the plan year's budget and actual
        for m, vers in (("a_base", ("A" + base[2:], "F" + base[2:])), ("b_plan", (B,)), ("af_plan", ("A" + plan[2:],))):
            vals = next((v for v in (version_months(r, x) for x in vers) if v), None)
            if vals:
                target[(a, t)][m] = vals

    def months_of(m):
        return bm if m == "a_base" else pm_

    airports = sorted({k[0] for k in list(rev) + list(pax)}, key=lambda a: (AIRPORTS.index(a) if a in AIRPORTS else 9, a))
    rows = []
    for a in airports:
        types = sorted({k[1] for k in list(rev) + list(pax) if k[0] == a and k[1] != "Combined"})
        entries = []
        for t in types + ["Combined"]:
            rv, px = {}, {}
            for m in ("a_base", "b_plan", "af_plan"):
                ms = months_of(m)
                if t == "Combined" and types:  # combined = sum of the split, plus any combined-only amounts
                    rv[m] = vsum([_vec_from(rev[(a, x)][m], ms) for x in types] + [_vec_from(rev[(a, "Combined")][m], ms)])
                    px_parts = [pax[(a, x)].get(m) for x in types if pax[(a, x)].get(m)] or ([pax[(a, "Combined")][m]] if pax[(a, "Combined")].get(m) else [])
                    px[m] = list(vsum(Vec(v + [sum(v)]) for v in px_parts)) if px_parts else None
                else:
                    rv[m] = _vec_from(rev[(a, t)][m], ms)
                    v = pax[(a, t)].get(m)
                    px[m] = v + [sum(v)] if v else None
            if t == "Combined" and not types:
                pass
            entries.append({"id": f"{a}|{t}", "airport": a, "pax_type": t, "revenue": _plain(rv), "pax": px,
                            "rate_plan": rate[(a, t)].get("b_plan")})
        rows.extend(entries)
    return {**_meta(cfg), "rows": rows, "pax_actual_loaded": any(r["pax"].get("af_plan") for r in rows)}


# ---------------------------------------------------------------------------------------------- slides 21–22
def opex_analysis(data, actuals, cfg) -> Dict[str, Any]:
    """TP opex by airport (shared services allocated), by category, and the monthly act + forecast trend."""
    e0, e1 = engines(data, actuals, cfg)
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    B = "B" + plan[2:]

    def m3(fn):
        v = measures_of(e0, e1, fn)
        return {k: list(v[k]) for k in ("a_base", "b_plan", "af_plan")}

    by_loc = []
    for a in AIRPORTS:
        by_loc.append({"id": a, "label": a, "values": m3(lambda e, a=a: e.opex(Filters(tag=a), "CA", shared=False) +
                                                        e.opex(Filters(tag=a), "CA", shared=True))})
    by_loc.append({"id": "cr", "label": "Change Requests", "values": m3(lambda e: e.opex(Filters(), "Change Request"))})
    # trend (slide 22): CA only, shared services on its own line
    trend = [{"id": a, "label": a, "values": m3(lambda e, a=a: e.opex(Filters(tag=a), "CA", shared=False))} for a in AIRPORTS]
    trend.append({"id": "shared", "label": "Shared Services", "values": m3(lambda e: e.opex(Filters(), "CA", shared=True))})
    # by category: AOP lines' nature vs the nature of the bookings
    cat_aop: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in data.get("opex_lines", []):
        if norm(r.get("category")) != "ca":
            continue
        c = opex_category(r.get("nature_of_expense_2"))
        for p in pm_:
            cat_aop[c][p] += _n(r.get(vkey(B, p)))
    cat_act: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    act_p = set(_act_months(cfg, "opex"))
    for a in actuals:
        d = a.get("dims") or {}
        if a["domain"] == "opex" and a["period"] in act_p and norm(d.get("category")) == "ca":
            cat_act[d.get("nature") or "Overheads"][a["period"]] += a["amount"]
    by_cat = [{"id": c, "label": c, "values": {"b_plan": list(_vec_from(cat_aop[c], pm_)), "af_plan": list(_vec_from(cat_act[c], pm_))}}
              for c in OPEX_CATEGORIES]
    return {**_meta(cfg), "by_location": by_loc, "by_category": by_cat, "trend": trend,
            "category_note": "AOP category from the opex line's nature of expense; actual from the booking's nature of services."}


# ---------------------------------------------------------------------------------------------- slides 23–24
PURSUIT = {"Front-End Sales", "Solutions", "Marketing & Alliances Intt.", "Partnerships & IR"}


def resources(data, actuals, resource_actuals, cfg, payroll_visible: bool) -> Dict[str, Any]:
    """Direct and indirect resources — headcount (FTE) and cost, AOP vs actual. resource_actuals carry qty (FTE)."""
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    B = "B" + plan[2:]
    act_p = set(_act_months(cfg, "payroll"))

    def group(cat, tag):
        c, t = norm(cat), str(tag or "").strip()
        if c == "ca":
            return ("direct", "Operations — CA+CR", t if norm(t) in {x.lower() for x in AIRPORTS} else "Shared services")
        if c == "cr":
            return ("direct", "Operations — CA+CR", "Change Request")
        if c == "projects":
            return ("direct", "Solutions — Projects", t or "Unassigned")
        if c == "overheads":
            return ("indirect", "Pursuit-oriented functions" if t in PURSUIT else "Enabling functions", t or "Others")
        if "capex" in c:
            return ("capex", "Capitalisation", t or "Others")
        return ("indirect", "Unclassified", t or "Others")

    cost_aop: Dict[tuple, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in data.get("payroll_lines", []):
        if norm(r.get("category")) in ("sub total", ""):
            continue
        g = group(r.get("category"), r.get("tag"))
        for p in pm_:
            cost_aop[g][p] += _n(r.get(vkey(B, p)))
    cost_act: Dict[tuple, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    fte_act: Dict[tuple, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for a in resource_actuals:
        if a["period"] not in act_p:
            continue
        d = a.get("dims") or {}
        g = group(d.get("category"), d.get("tag"))
        cost_act[g][a["period"]] += a["amount"]
        fte_act[g][a["period"]] += _n(a.get("qty"))
    keys = sorted(set(cost_aop) | set(cost_act))
    rows = []
    for k in keys:
        rows.append({"section": k[0], "group": k[1], "label": k[2],
                     "cost": {"b_plan": list(_vec_from(cost_aop[k], pm_)), "af_plan": list(_vec_from(cost_act[k], pm_))},
                     "fte": {"af_plan": [fte_act[k].get(p, 0.0) for p in pm_]} if fte_act.get(k) else None})
    if not payroll_visible:
        rows = [{**r, "cost": None, "masked": True} for r in rows]
    return {**_meta(cfg), "rows": rows, "has_actuals": bool(resource_actuals),
            "note": "Headcount = FTE from the resource cost file (allocation %) for the selected month; AOP headcount "
                    "appears once the AOP resource file with headcount is loaded."}


# ---------------------------------------------------------------------------------------------- slides 25–26
def _oh_segment(r) -> str:
    return "Solutions" if norm(r.get("dept_for_growth_p_l")) == "growth" else "CA+CR"


def overheads_summary(data, actuals, cfg) -> Dict[str, Any]:
    """Enabling overheads (SG&A) by department and segment — AOP vs actual."""
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    B = "B" + plan[2:]
    aop: Dict[tuple, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in data.get("overhead_lines", []):
        k = (r.get("pl_tag") or "Others", _oh_segment(r))
        for p in pm_:
            aop[k][p] += _n(r.get(vkey(B, p)))
    act: Dict[tuple, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    act_p = set(_act_months(cfg, "overhead"))
    for a in actuals:
        d = a.get("dims") or {}
        if a["domain"] == "overhead" and a["period"] in act_p and d.get("pl_tag"):
            act[(d["pl_tag"], d.get("segment") or "CA+CR")][a["period"]] += a["amount"]
    depts = sorted({k[0] for k in list(aop) + list(act)})
    rows = []
    for dpt in depts:
        vals = {}
        for seg in ("CA+CR", "Solutions"):
            vals[seg] = {"b_plan": list(_vec_from(aop[(dpt, seg)], pm_)), "af_plan": list(_vec_from(act[(dpt, seg)], pm_))}
        vals["Total"] = {m: [a + b for a, b in zip(vals["CA+CR"][m], vals["Solutions"][m])] for m in ("b_plan", "af_plan")}
        rows.append({"id": dpt, "label": dpt, "values": vals})
    rows.sort(key=lambda r: -r["values"]["Total"]["b_plan"][12])
    return {**_meta(cfg), "segments": ["CA+CR", "Solutions", "Total"], "rows": rows}


def overheads_nature(data, actuals, cfg, dept: str) -> Dict[str, Any]:
    """One department's overheads by nature — AOP FY, YTD AOP, YTD actual."""
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    B = "B" + plan[2:]
    aop: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for r in data.get("overhead_lines", []):
        if norm(r.get("pl_tag")) != norm(dept):
            continue
        for p in pm_:
            aop[r.get("final_tag") or "Others"][p] += _n(r.get(vkey(B, p)))
    act: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    act_p = set(_act_months(cfg, "overhead"))
    canon = {norm(k): k for k in aop}  # booking natures take the AOP spelling (case / spacing differ)
    for a in actuals:
        d = a.get("dims") or {}
        if a["domain"] == "overhead" and a["period"] in act_p and norm(d.get("pl_tag")) == norm(dept):
            n = d.get("nature") or "Others"
            n = canon.setdefault(norm(n), n)
            act[n][a["period"]] += a["amount"]
    names = sorted(set(aop) | set(act), key=lambda n: -sum(aop[n].values()))
    rows = [{"id": n, "label": n, "values": {"b_plan": list(_vec_from(aop[n], pm_)), "af_plan": list(_vec_from(act[n], pm_))}}
            for n in names]
    return {**_meta(cfg), "department": dept, "rows": rows}


def overheads_lines(data, bookings: Iterable[Dict[str, Any]], cfg, dept: str, nature: Optional[str]) -> Dict[str, Any]:
    """Budget monitoring raw data: the AOP lines and the actual bookings behind a department (and nature)."""
    plan = cfg["plan_fy"]
    pm_ = fy_months(plan)
    B = "B" + plan[2:]
    aop = []
    for r in data.get("overhead_lines", []):
        if norm(r.get("pl_tag")) != norm(dept) or (nature and norm(r.get("final_tag")) != norm(nature)):
            continue
        aop.append({"aop_head": r.get("aop_head"), "nature": r.get("final_tag"), "description": r.get("sub_type"),
                    "department": r.get("department"), "segment": _oh_segment(r), "geo": r.get("geo"),
                    "monthly": [_n(r.get(vkey(B, p))) for p in pm_]})
    acts = []
    for a in bookings:
        d = a.get("dims") or {}
        acts.append({"date": a.get("date"), "period": a["period"], "voucher": a.get("voucher"), "vendor": d.get("vendor"),
                     "gl": d.get("gl"), "gl_text": d.get("gl_text"), "nature": d.get("nature"), "detail": d.get("detail"),
                     "segment": d.get("segment"), "cost_centre": d.get("cost_centre"), "narration": a.get("narration"),
                     "amount": a["amount"]})
    acts.sort(key=lambda x: (x["period"], -abs(x["amount"])))
    return {**_meta(cfg), "department": dept, "nature": nature, "aop_lines": aop, "bookings": acts}
