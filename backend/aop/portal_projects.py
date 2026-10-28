"""AOP / package projects in the portal's Projects section.

The AOP workbook (CR & project master, project revenue lines) and the Financial Reporting Package (Project Summary)
list the Solutions projects the reports are built on. ``sync_projects`` brings them into the ``projects`` collection so
each has a page in Projects — with the fields and document slots (agreement, customer PO …) to fill in as they become
available. The sync never overwrites what a user entered: it creates missing projects, links an existing one (same
AOP project id, WBS or name) and only fills fields that are still empty.

``project_financials`` is the project page's AOP-vs-actual tab, read from the same engine data as the reports (the
numbers match the Project health and Regional P&L drill-downs).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from services import compute_margin, gen_id, now_iso

from .datasets import norm
from .mis_reports import _project_items
from .periods import fy_months, period_label
from .pnl import Filters

# fields the sync refreshes every time (they come from AOP, users do not edit them)
AOP_KEYS = ("aop_project_id", "source", "aop_tag", "aop_status", "aop_synced_at")


def _key(v) -> str:
    return re.sub(r"[^0-9a-z]+", "", str(v or "").lower())


def _first(*vals):
    for v in vals:
        if v not in (None, "", 0):
            return v
    return None


def candidates(data: Dict[str, List[Dict[str, Any]]], actuals: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Solutions projects known to the AOP or the package → {project key: merged info}. A project is keyed by its
    project id (WDP014), else by its name."""
    out: Dict[str, Dict[str, Any]] = {}

    def add(pid, name, **kw):
        k = pid or ("name:" + _key(name))
        if not k or k == "name:":
            return
        e = out.setdefault(k, {"project_id": pid or None, "name": None, "has_actual": False, "has_plan": False})
        e["name"] = e["name"] or name
        for f, v in kw.items():
            if v not in (None, "") and not e.get(f):
                e[f] = v

    for r in data.get("project_master", []):
        if norm(r.get("category")) == "projects":
            add(r.get("project_id"), r.get("project_name"), geo=r.get("geo"), region=r.get("region"), grouping=r.get("grouping"),
                location=r.get("location"), category2=r.get("category2"), tag=r.get("tag"), customer=r.get("customer"),
                customer_po=r.get("customer_po"), status=r.get("status"), tcv=r.get("tcv") or r.get("po_value"),
                solution=r.get("solution_offered"), airport_flag=r.get("airport_flag"), has_plan=True)
    for r in data.get("rev_projects", []):
        if norm(r.get("category")) == "projects":
            add(r.get("project_id"), r.get("project_name") or r.get("description") or r.get("tag"), geo=r.get("geo"), region=r.get("region"),
                tag=r.get("tag"), customer=r.get("customer"), customer_po=r.get("customer_po"), status=r.get("status"),
                grouping=r.get("grouping"), location=r.get("location"), has_plan=True)
    for a in actuals:
        d = a.get("dims") or {}
        solutions = (a.get("domain") == "rev_projects" and norm(d.get("stream")) == "projects") or \
            (a.get("domain") in ("opex", "payroll") and norm(d.get("category")) == "projects")
        if not solutions or not (d.get("project_id") or d.get("project")):
            continue
        add(d.get("project_id") or d.get("project_code"), d.get("project") or d.get("tag"), geo=d.get("geo"), region=d.get("region"),
            tag=d.get("tag"), wbs=d.get("wbs"), gmr=d.get("gmr"))
        out.get(d.get("project_id") or d.get("project_code") or "name:" + _key(d.get("project") or d.get("tag")), {})["has_actual"] = True
    # master rows win for the id → also index by name so an actual without an id lands on its master project
    by_name = {_key(e["name"]): k for k, e in out.items() if e["project_id"] and e["name"]}
    for k in [k for k in out if k.startswith("name:")]:
        target = by_name.get(k[5:])
        if target:
            src = out.pop(k)
            for f, v in src.items():
                if v not in (None, "", False) and not out[target].get(f):
                    out[target][f] = v
    return out


def _fields(info: Dict[str, Any], customers: Dict[str, str]) -> Dict[str, Any]:
    """AOP info → the portal project's own fields (used only to fill what is empty)."""
    geo = info.get("geo") or ""
    f: Dict[str, Any] = {
        "wbs_element": info.get("wbs"), "customer_name": info.get("customer"),
        "customer_po_number": info.get("customer_po"), "country": "India" if norm(geo) == "india" else geo or None,
        "pnl_location": info.get("tag"), "pnl_region": info.get("region"), "location": info.get("location"),
        "project_grouping": info.get("grouping"), "category1": "Projects", "category2": info.get("category2"),
        "description": info.get("solution"),
    }
    if info.get("gmr"):
        f["business_category"] = "GMR" if norm(info["gmr"]) == "gmr" else "Non-GMR"
    elif info.get("airport_flag"):
        f["business_category"] = "GMR" if norm(info["airport_flag"]) == "airport" else "Non-GMR"
    try:
        if info.get("tcv") and float(info["tcv"]) > 0:
            f["po_value"] = float(info["tcv"])
    except (TypeError, ValueError):
        pass
    cid = customers.get(_key(info.get("customer")))
    if cid:
        f["customer_id"] = cid
    return {k: v for k, v in f.items() if v not in (None, "")}


async def sync_projects(db, data, actuals, user_email: Optional[str] = None) -> Dict[str, int]:
    """Create / link the AOP and package projects in the Projects section (idempotent)."""
    cands = candidates(data, actuals)
    customers = {_key(c.get("customer_name")): c["id"] async for c in db.customers.find({}, {"_id": 0, "id": 1, "customer_name": 1})}
    existing = [p async for p in db.projects.find({}, {"_id": 0})]
    by_aop = {p["aop_project_id"]: p for p in existing if p.get("aop_project_id")}
    by_wbs = {_key(p.get("wbs_element")): p for p in existing if p.get("wbs_element")}
    by_name = {_key(p.get("project_name")): p for p in existing if p.get("project_name")}
    now = now_iso()
    created = linked = updated = 0
    for k, info in cands.items():
        pid = info.get("project_id")
        name = info.get("name") or pid
        fields = _fields(info, customers)
        aop = {"aop_project_id": pid or k, "aop_tag": info.get("tag"), "aop_status": info.get("status"), "aop_synced_at": now}
        cur = by_aop.get(pid or k) or (by_wbs.get(_key(fields.get("wbs_element"))) if fields.get("wbs_element") else None) \
            or by_name.get(_key(name))
        if cur is None:
            doc = {"id": gen_id(), "project_name": name, "billing_type": "Monthly", "currency": "INR", "milestones": [], "vendor_pos": [],
                   "stakeholders": [], "po_value": 0.0, "revenue_total": 0.0, "cost_total": 0.0, "business_category": "Non-GMR",
                   "current_stage": "Operations" if info.get("has_actual") else "Pipeline", "approval_status": "Not Required",
                   "created_at": now, "updated_at": now, "created_by": user_email, "source": "aop", **fields, **aop}
            m = compute_margin(doc["po_value"], doc["revenue_total"], doc["cost_total"])
            doc["margin_total"], doc["margin_pct"] = m["margin_total"], m["margin_pct"]
            await db.projects.insert_one(doc)
            created += 1
            continue
        fill = {f: v for f, v in fields.items() if cur.get(f) in (None, "", 0, 0.0)}
        upd = {**fill, **{k2: v for k2, v in aop.items() if v is not None and cur.get(k2) != v}}
        if not cur.get("aop_project_id"):
            linked += 1
        if upd and set(upd) - {"aop_synced_at"}:
            upd["updated_at"] = now
            await db.projects.update_one({"id": cur["id"]}, {"$set": upd})
            updated += 1
    return {"created": created, "linked": linked, "updated": updated, "candidates": len(cands)}


# ---------------------------------------------------------------------------------------------- AOP vs actual
LINES = [("revenue", "Revenue", "proj_rev", 1, False), ("tp_opex", "TP opex", "proj_opex", -1, False),
         ("resource", "Resource cost (direct)", "proj_res", -1, True)]


def project_financials(data, actuals, cfg, proj: Dict[str, Any], payroll_visible: bool) -> Dict[str, Any]:
    """The project's AOP, actual and actual + forecast by month for the plan year — revenue, TP opex, resource cost, gross
    margin — from the same sources and rules as the Project health / Regional P&L reports."""
    plan = cfg["plan_fy"]
    pm = fy_months(plan)
    cut = (cfg.get("cutoffs") or {}).get("default") or ""
    n_act = sum(1 for p in pm if p <= cut)
    pid, name = proj.get("aop_project_id"), proj.get("project_name")
    lines: List[Dict[str, Any]] = []
    for key, label, kind, sign, sensitive in LINES:
        item = None
        if not (sensitive and not payroll_visible):
            items = _project_items(data, actuals, cfg, kind, Filters())
            item = next((i for i in items if i["id"] == pid), None) or next((i for i in items if _key(i["label"]) == _key(name)), None)
        v = (item or {}).get("values") or {}
        aop, af = list(v.get("b_plan") or [0.0] * 13), list(v.get("af_plan") or [0.0] * 13)
        lines.append({"key": key, "label": label, "sign": sign, "sensitive": sensitive, "masked": sensitive and not payroll_visible,
                      "linked": item is not None, "aop": aop, "af": af, "actual": af[:n_act] + [None] * (12 - n_act)})
    got = [l for l in lines if not l["masked"]]
    gm = {"key": "gm", "label": "Gross margin", "sign": 1, "sensitive": False, "masked": any(l["masked"] for l in lines), "linked": any(l["linked"] for l in got),
          "aop": [sum(l["sign"] * l["aop"][i] for l in got) for i in range(13)],
          "af": [sum(l["sign"] * l["af"][i] for l in got) for i in range(13)],
          "actual": [sum(l["sign"] * (l["actual"][i] or 0.0) for l in got) if i < n_act else None for i in range(12)]}
    lines.append(gm)
    master = next((r for r in data.get("project_master", []) if r.get("project_id") == pid), {}) if pid else {}
    keep = ("project_id", "project_name", "category", "geo", "region", "grouping", "location", "tag", "customer", "customer_po", "status",
            "tcv", "sales_owner", "solution_offered")
    return {"plan_fy": plan, "months": [{"p": p, "label": period_label(p), "actual": p <= cut} for p in pm], "cutoff": cut,
            "actual_months": n_act, "lines": lines, "master": {k: master.get(k) for k in keep if master.get(k) not in (None, "")},
            "linked": any(l["linked"] for l in got),
            "note": "AOP = the approved plan; Actual = booked months from the package / SAP; Actual + forecast adds the forecast "
                    "for the months after the cut-off."}


def projects_summary(data, actuals, cfg, projects: List[Dict[str, Any]], payroll_visible: bool) -> Dict[str, Dict[str, Any]]:
    """Per portal project with an AOP link: FY AOP and YTD actual revenue / cost and the YTD actual gross margin — the
    figures the Projects list shows next to each project. Computed once for the whole list."""
    plan = cfg["plan_fy"]
    cut = (cfg.get("cutoffs") or {}).get("default") or ""
    n_act = sum(1 for p in fy_months(plan) if p <= cut)
    kinds = {k: _project_items(data, actuals, cfg, kind, Filters()) for k, _, kind, _, sens in LINES if not (sens and not payroll_visible)}
    out: Dict[str, Dict[str, Any]] = {}
    for proj in projects:
        pid, name = proj.get("aop_project_id"), proj.get("project_name")
        if not pid:
            continue
        got: Dict[str, Dict[str, Any]] = {}
        for k, items in kinds.items():
            item = next((i for i in items if i["id"] == pid), None) or next((i for i in items if _key(i["label"]) == _key(name)), None)
            v = (item or {}).get("values") or {}
            aop, af = v.get("b_plan") or [0.0] * 13, v.get("af_plan") or [0.0] * 13
            got[k] = {"aop_fy": aop[12], "act_ytd": sum(af[:n_act]), "aop_ytd": sum(aop[:n_act]), "found": item is not None}
        rev, tp, res = got["revenue"], got["tp_opex"], got.get("resource")
        cost_act = tp["act_ytd"] + (res["act_ytd"] if res else 0.0)
        out[proj["id"]] = {"rev_aop_fy": rev["aop_fy"], "rev_aop_ytd": rev["aop_ytd"], "rev_act_ytd": rev["act_ytd"],
                           "cost_act_ytd": cost_act if res else None,
                           "gm_pct_ytd": ((rev["act_ytd"] - cost_act) / rev["act_ytd"]) if res and rev["act_ytd"] else None,
                           "linked": any(g["found"] for g in got.values())}
    return out
