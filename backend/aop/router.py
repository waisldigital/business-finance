"""AOP API (mounted under /api/aop).

Access model (re-uses the existing roles system — no new role concept):
  * system role ``admin`` → admin portal: imports, uploads/downloads, column management, approvals, config
  * everyone else → workspace sections ``aop_*`` from their role (can_view / can_edit)
  * ``aop_payroll`` is confidential: without it, payroll datasets are hidden and resource-cost lines
    in the P&L are masked
  * a role's ``aop_tags`` (optional) restricts the reporting tags / airports a user's P&L can show
  * a role's ``aop_dept_scope`` ("own" = the user's department from the employee master, "list" = the role's
    ``aop_departments``) limits overhead and payroll data to those departments (see ``departments.py``)
  * user edits touch only columns an admin marked ``user_editable``; when the section's edit mode is
    ``approval`` they are queued in ``aop_changes`` for an admin decision instead of being applied
"""
from __future__ import annotations

import csv
import io
import os
import re
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
import openpyxl

from permissions import resolve_permissions
from sections import AOP_SECTIONS

from .datasets import (ACTUALS, CUTE_LEAD, DRIVER_LEAD, SPECS, VERSION_KEY, build_key, coerce, column, norm,
                       slug, wide_columns, widen_cute, widen_drivers)
from .importer import Result, import_aop_workbook, import_opex_workbook
from .actuals_import import (import_mis_working, import_project_health, import_reporting_package, import_resource_cost,
                             pax_driver_key)
from .periods import shift_fy
from .periods import fy_months, fy_of_period as fy_of, period_label
from .opex import input_fields as tracker_inputs
from . import opex_schema
from . import po as PO
from .po_pipeline import PO_META, OpexEngine, notify_zmm
from .review import register_review
from .plan import build_draft, default_drivers
from . import reports as rep
from .pnl import Filters, PnLEngine
from . import mis
from . import mis_reports as mr
from . import departments as dept_scope

ACTUAL_COLUMNS = [
    column("uid", "Unique key"), column("domain", "Domain"), column("ref", "Line ref"), column("period", "Period (YYYY-MM)"),
    column("amount", "Amount (INR)", "number"), column("entry_type", "Entry type"), column("date", "Date"),
    column("voucher", "Voucher"), column("narration", "Narration"),
    column("dims.category", "Category"), column("dims.geo", "Geo"), column("dims.tag", "Reporting tag"),
    column("dims.stream", "Stream"), column("dims.department", "Department"), column("dims.aop_head", "AOP head"),
    column("dims.cost_centre", "Cost centre"), column("dims.gl", "GL"), column("dims.wbs", "WBS"),
    column("dims.po", "PO"), column("dims.vendor", "Vendor"), column("dims.project_id", "Project ID"),
    column("dims.project_code", "Project code"), column("dims.line", "P&L line"),
]
DEFAULT_CONFIG = {
    "id": "aop", "base_fy": "FY26", "plan_fy": "FY27", "draft_fy": "FY28",
    "cutoffs": {"default": "2025-12", "overhead": "2025-11"}, "tax_rate": 0.25,
    "edit_modes": {s: "approval" for s in AOP_SECTIONS}, "data_version": 0,
    "po_change_mode": "hold", "po_nature_prefix": dict(PO.DEFAULT_PREFIX),
}
OPEX_DATASETS = ("opex_lines", "opex_tracker")
# PO datasets the system writes (read-only in the grid; edited through Review)
READONLY_DATASETS = {"po_register", "po_items", "po_changes", "zmm_runs"}


# opex / capex / overhead lines: department budget inputs for the draft year (FY'28 while FY'27 is the plan year)
BUDGET_INPUT_DATASETS = {"opex_lines", "overhead_lines", "overhead_plan", "capex_lines"}


def budget_input_columns(T: str) -> List[Dict[str, Any]]:
    fy, t = f"FY'{T[1:]} B", T.lower()
    return [column(f"{t}_currency", f"{fy} Currency", editable=True, group=T),
            column(f"{t}_qty", f"{fy} Qty", "number", editable=True, group=T),
            column(f"{t}_unit_price", f"{fy} Unit price", "number", editable=True, group=T),
            column(f"{t}_fx", f"{fy} FX rate", "number", group=T),
            column(f"{T}__annual", f"{fy} (INR)", "number", editable=True, group=T),
            column(f"{t}_dept_remarks", f"{fy} Department remarks", editable=True, group=T),
            column(f"{t}_fin_remarks", f"{fy} Finance remarks", group=T)]


def BUDGET_KEYS(T: str) -> set:  # noqa: N802 — reads like the constant it stands for
    return {c["key"] for c in budget_input_columns(T)}


def fx_rate(data: Dict[str, List[Dict[str, Any]]], currency: Any, fys: List[str]) -> Optional[float]:
    """INR per unit of currency from the assumptions (Currency Assumptions · USD · USD to INR, code usd_inr)."""
    cur = str(currency or "INR").strip().upper()
    if cur in ("", "INR", "RS", "₹"):
        return 1.0
    for fy in fys:
        for a in data.get("assumptions", []):
            if a.get("fy") != fy:
                continue
            code, name = str(a.get("code") or "").lower(), str(a.get("name") or "").upper()
            if code == f"{cur.lower()}_inr" or (f"· {cur} ·" in name and "INR" in name):
                v = a.get("value") if a.get("value") is not None else a.get("base")
                if isinstance(v, (int, float)) and v:
                    return float(v)
    return None


# datasets whose lines show their booked actuals (read-only A<yy> months from the single actual source)
def _cute_match(f: Dict[str, Any], d: Dict[str, Any]) -> int:
    if norm(d.get("tag")) != norm(f.get("airport")):
        return 0
    return 2 if norm(d.get("pax_type") or "combined") == norm(f.get("pax_type") or "combined") else 1


def _noncute_match(f: Dict[str, Any], d: Dict[str, Any]) -> int:
    ok = norm(d.get("stream")) == norm(f.get("stream")) and norm(d.get("tag")) == norm(f.get("location") or f.get("tag"))
    return 2 if ok else 0


ACTUAL_LINKS = {"rev_cute": (["rev_cute"], _cute_match), "rev_noncute": (["rev_noncute", "rev_share"], _noncute_match)}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_router(db, get_current_user, write_audit, gen_id, storage=None) -> APIRouter:
    r = APIRouter(prefix="/aop", tags=["aop"])
    # Per-process cache of the datasets and actuals the P&L engine reads. It is keyed on aop_config.data_version,
    # a counter in MongoDB bumped by every write (bump_version), so with several workers or instances each one
    # reloads as soon as any of them changes data — no single-worker requirement.
    cache: Dict[str, Any] = {"version": None, "data": None, "actuals": None}

    # ------------------------------------------------------------------ access
    async def perms_for(user: dict) -> Dict[str, Any]:
        if not cache.get("wide"):
            await get_config()  # runs the one-time data-layout migration before anything reads the rows
        resolved = await resolve_permissions(db, user)  # the one permission resolver (permissions.py)
        sections = {s: {k: resolved["permissions"][s][k] for k in ("can_view", "can_edit", "can_upload")} for s in AOP_SECTIONS}
        if resolved["is_admin"]:
            return {"admin": True, "sections": sections, "tags": [], "departments": None, "dept_scope": "all"}
        role = resolved["role"] or {}
        tags: List[str] = [t for t in (role.get("aop_tags") or []) if t]
        departments: Optional[List[str]] = None
        scope = role.get("aop_dept_scope") or "all"
        if scope in ("own", "list"):
            names = list(role.get("aop_departments") or [])
            if scope == "own":
                emp = await db.employees.find_one({"email_id": {"$regex": f"^{re.escape(user.get('email') or '')}$", "$options": "i"}},
                                                  {"_id": 0, "department": 1, "sub_department": 1})
                names = [x for x in ((emp or {}).get("department"), (emp or {}).get("sub_department")) if x] + names
            cfg = await get_config()
            departments = dept_scope.expand(names, cfg.get("dept_aliases"))
        return {"admin": False, "sections": sections, "tags": tags, "departments": departments, "dept_scope": scope}

    def payroll_visible(p: Dict[str, Any]) -> bool:
        """Company-wide payroll lines (P&L, airport GM, project health) — never for department-scoped users."""
        return p["admin"] or (p["sections"]["aop_payroll"]["can_view"] and p.get("departments") is None)

    def require_admin(user: dict):
        if user.get("role") != "admin":
            raise HTTPException(403, "Admin only")

    async def can(user: dict, dataset: str, action: str = "view") -> bool:
        p = await perms_for(user)
        if p["admin"]:
            return True
        if dataset == ACTUALS:
            return False  # the raw actual source is admin-managed; users see it through reports
        spec = SPECS.get(dataset)
        if not spec:
            return False
        if spec.sensitive and not p["sections"]["aop_payroll"]["can_view"]:
            return False
        sp = p["sections"].get(spec.section, {})
        return bool(sp.get({"view": "can_view", "upload": "can_upload"}.get(action, "can_edit")))

    async def get_config() -> Dict[str, Any]:
        cfg = await db.aop_config.find_one({"id": "aop"}, {"_id": 0})
        if not cfg:
            cfg = dict(DEFAULT_CONFIG)
            await db.aop_config.insert_one(dict(cfg))
            cfg.pop("_id", None)
        for k, v in DEFAULT_CONFIG.items():
            cfg.setdefault(k, v)
        if not cache.get("wide") and not cfg.get("wide_fy_layout"):
            cache["wide"] = True
            await migrate_wide(cfg)
            cfg["wide_fy_layout"] = True
        return cfg

    async def migrate_wide(cfg: Dict[str, Any]):
        """One-time: CUTE revenue / drivers stored one line per FY → one line per airport (and metric), FY in columns."""
        for ds, widen, lead, editable in (("rev_cute", widen_cute, CUTE_LEAD, False),
                                          ("rev_cute_drivers", lambda rs: widen_drivers(rs, cfg["base_fy"]), DRIVER_LEAD, True)):
            docs = [d async for d in db.aop_rows.find({"dataset": ds}, {"_id": 0}).sort("seq", 1)]
            if not any("fy" in (d.get("fields") or {}) for d in docs):
                continue
            wide = widen([d.get("fields") or {} for d in docs])
            await db.aop_rows.delete_many({"dataset": ds})
            spec = SPECS[ds]
            new = [{"dataset": ds, "key": build_key(spec, f), "seq": i, "fields": f, "updated_at": now_iso(), "updated_by": "migration"}
                   for i, f in enumerate(wide, start=1)]
            if new:
                await db.aop_rows.insert_many(new)
            await db.aop_dataset_meta.update_one({"dataset": ds}, {"$set": {"columns": wide_columns(wide, lead, editable),
                                                                            "updated_at": now_iso()}}, upsert=True)
        await db.aop_config.update_one({"id": "aop"}, {"$set": {"wide_fy_layout": True}}, upsert=True)
        await db.aop_config.update_one({"id": "aop"}, {"$inc": {"data_version": 1}})

    async def refresh_wide_meta(ds: str):
        """Add version columns that rows carry but the column list doesn't (e.g. actual PAX months from a package)."""
        lead, editable = (DRIVER_LEAD, True) if ds == "rev_cute_drivers" else (CUTE_LEAD, False)
        rows = [d.get("fields") or {} async for d in db.aop_rows.find({"dataset": ds}, {"_id": 0, "fields": 1})]
        stored = {c["key"]: c for c in await columns_for(ds)}
        fresh = wide_columns(rows, lead, editable)
        keys = [c["key"] for c in fresh] + [k for k in stored if k not in {c["key"] for c in fresh}]
        cols = [stored.get(k) or next(c for c in fresh if c["key"] == k) for k in keys]
        await db.aop_dataset_meta.update_one({"dataset": ds}, {"$set": {"columns": cols, "updated_at": now_iso()}}, upsert=True)

    async def bump_version():
        await db.aop_config.update_one({"id": "aop"}, {"$inc": {"data_version": 1}}, upsert=True)

    async def load_all():
        cfg = await get_config()
        if cache["version"] == cfg.get("data_version") and cache["data"] is not None:
            return cache["data"], cache["actuals"], cfg
        data: Dict[str, List[Dict[str, Any]]] = {}
        needed = ["rev_cute", "rev_noncute", "rev_projects", "project_master", "opex_lines", "payroll_lines",
                  "overhead_lines", "overhead_plan", "assumptions", "pl_other", "pl_snapshot", "rev_cute_drivers",
                  "capex_lines", "capex_tracker", "capex_history"]
        async for d in db.aop_rows.find({"dataset": {"$in": needed}}, {"_id": 0, "dataset": 1, "fields": 1}):
            data.setdefault(d["dataset"], []).append(d.get("fields") or {})
        # reconciliation-only domains (SAP payroll / capex postings) stay out of the engine's working set
        actuals = [a async for a in db.aop_actuals.find({"domain": {"$nin": ["payroll_sap", "capex_sap"]}},
                                                        {"_id": 0, "domain": 1, "period": 1, "amount": 1, "dims": 1})]
        cache.update(version=cfg.get("data_version"), data=data, actuals=actuals)
        return data, actuals, cfg

    async def columns_for(dataset: str) -> List[Dict[str, Any]]:
        if dataset == ACTUALS:
            meta = await db.aop_dataset_meta.find_one({"dataset": ACTUALS}, {"_id": 0})
            return (meta or {}).get("columns") or ACTUAL_COLUMNS
        meta = await db.aop_dataset_meta.find_one({"dataset": dataset}, {"_id": 0})
        stored = (meta or {}).get("columns") or []
        if dataset in OPEX_DATASETS:  # one layout for both, labelled with today's FYs
            return opex_schema.meta_columns(dataset, await get_config(), stored)
        if dataset in PO_META:
            known = {c["key"] for c in PO_META[dataset]}
            prev = {c["key"]: c for c in stored}
            return [{**c, **{k: prev[c["key"]][k] for k in ("hidden", "width") if c["key"] in prev and k in prev[c["key"]]}}
                    for c in PO_META[dataset]] + [c for c in stored if c.get("custom") and c["key"] not in known]
        return stored

    async def draft_version() -> str:
        cfg = await get_config()
        return "B" + (cfg.get("draft_fy") or shift_fy(cfg["plan_fy"], 1))[2:]

    async def columns_with_draft(dataset: str) -> List[Dict[str, Any]]:
        """Stored columns plus the draft year's budget: every dataset that carries a monthly budget also offers the
        next AOP's months, and the opex / capex / overhead lines carry the department budget inputs (currency, qty,
        unit price, FY budget, department and finance remarks). The draft year's cells stay open for departments."""
        cols = await columns_for(dataset)
        spec = SPECS.get(dataset)
        if not spec:
            return cols
        T = await draft_version()
        monthly = any(v.startswith("B") for v in spec.versions)
        have = {c["key"] for c in cols}
        extra = []
        if dataset in BUDGET_INPUT_DATASETS:
            extra += [c for c in budget_input_columns(T) if c["key"] not in have]
        if monthly:
            extra += [column(f"{T}__{q}", f"{T} {period_label(q)}", "number", editable=True, group=T)
                      for q in fy_months("FY" + T[1:]) if f"{T}__{q}" not in have]
        booked = await actual_months(dataset)
        if booked:  # read-only actual months, placed before the first column of a later version
            have_now = {c["key"] for c in cols + extra}
            acts = [column(f"A{fy_of(p)[2:]}__{p}", f"A{fy_of(p)[2:]} {period_label(p)}", "number", group=f"A{fy_of(p)[2:]}") | {"actual": True}
                    for p in booked if f"A{fy_of(p)[2:]}__{p}" not in have_now]
            for a in acts:
                yy = int(a["group"][1:])
                allc = cols
                pos = next((i for i, c in enumerate(allc) if VERSION_KEY.match(c["key"]) and
                            (int(VERSION_KEY.match(c["key"]).group(1)[1:3]) > yy or
                             (int(VERSION_KEY.match(c["key"]).group(1)[1:3]) == yy and c["key"][0] == "F"))), len(allc))
                cols = allc[:pos] + [a] + allc[pos:]
        admin_only = {f"{T.lower()}_fin_remarks", f"{T.lower()}_fx"}
        out = []
        for c in cols + extra:
            if c.get("actual"):
                out.append(c)
                continue
            if (c["key"].startswith(f"{T}__") or c["key"] in BUDGET_KEYS(T)) and c["key"] not in admin_only and not c.get("user_editable"):
                c = {**c, "user_editable": True}
            out.append(c)
        return out

    async def actual_months(dataset: str, docs: Optional[List[Dict[str, Any]]] = None) -> List[str]:
        """Booked months (base and plan year) behind a dataset's lines; with docs, adds A<yy>__<month> to each line's fields.
        An actual goes to the line that matches it best (same airport and passenger type, else the airport's line)."""
        if dataset not in ACTUAL_LINKS:
            return []
        cfg = await get_config()
        domains, match = ACTUAL_LINKS[dataset]
        months = fy_months(cfg["base_fy"]) + fy_months(cfg["plan_fy"])
        acts = [a async for a in db.aop_actuals.find({"domain": {"$in": domains}, "period": {"$in": months}},
                                                     {"_id": 0, "period": 1, "amount": 1, "dims": 1})]
        if docs is not None:
            for a in acts:
                d = a.get("dims") or {}
                best, score = None, 0
                for doc in docs:
                    sc = match(doc.get("fields") or {}, d)
                    if sc > score:
                        best, score = doc, sc
                        if sc == 2:
                            break
                if best is not None:
                    k = f"A{fy_of(a['period'])[2:]}__{a['period']}"
                    best["fields"][k] = round((best["fields"].get(k) or 0) + float(a.get("amount") or 0), 2)
        return sorted({a["period"] for a in acts})

    def ensure_ds(dataset: str):
        if dataset != ACTUALS and dataset not in SPECS:
            raise HTTPException(404, f"Unknown dataset {dataset}")

    async def fx_for(currency: str) -> Optional[float]:
        data, _, cfg = await load_all()
        return fx_rate(data, currency, [cfg["plan_fy"], cfg["base_fy"]])

    engine = OpexEngine(db, get_config, fx_for, storage=storage, bump=bump_version)

    async def recalc_tracker(keys: Optional[List[str]] = None):
        """Resolve the PO links and recompute the forecast months and PO display fields of tracker lines (all lines
        when keys is None)."""
        return await engine.resolve_all(list(keys) if keys is not None else None)

    async def recalc_budget(dataset: str, changed: List[tuple]):
        """Department budget inputs → the draft year's budget. Qty × unit price × FX (from the assumptions unless finance
        set a rate) gives the FY budget in INR; a new FY budget is phased evenly over the months; editing a month
        re-totals the FY budget."""
        if dataset not in BUDGET_INPUT_DATASETS or not changed:
            return
        cfg = await get_config()
        T = await draft_version()
        t = T.lower()
        months = fy_months("FY" + T[1:])
        monthly = any(v.startswith("B") for v in SPECS[dataset].versions)
        data = None
        by_key: Dict[str, set] = {}
        for k, fld in changed:
            by_key.setdefault(k, set()).add(fld)
        for key, flds in by_key.items():
            doc = await db.aop_rows.find_one({"dataset": dataset, "key": key}, {"_id": 0, "fields": 1})
            f = (doc or {}).get("fields") or {}
            upd: Dict[str, Any] = {}
            price_inputs = {f"{t}_currency", f"{t}_qty", f"{t}_unit_price", f"{t}_fx"}
            if flds & price_inputs:
                fx = f.get(f"{t}_fx") if f"{t}_fx" in flds else None
                if not fx:
                    if data is None:
                        data, _, _ = await load_all()
                    fx = fx_rate(data, f.get(f"{t}_currency") or f.get("currency"), ["FY" + T[1:], cfg["plan_fy"]])
                    upd[f"{t}_fx"] = fx
                qty, price = f.get(f"{t}_qty"), f.get(f"{t}_unit_price")
                if isinstance(qty, (int, float)) and isinstance(price, (int, float)) and fx:
                    annual = round(qty * price * fx, 2)
                    if annual != f.get(f"{T}__annual"):
                        upd[f"{T}__annual"] = annual
            month_edit = any(fl.startswith(f"{T}__") and fl != f"{T}__annual" for fl in flds)
            if monthly and (f"{T}__annual" in upd or (f"{T}__annual" in flds and not month_edit)):
                annual = upd.get(f"{T}__annual", f.get(f"{T}__annual")) or 0
                upd.update({f"{T}__{q}": round(annual / 12, 2) for q in months})
            elif monthly and month_edit:
                upd[f"{T}__annual"] = round(sum(float(f.get(f"{T}__{q}") or 0) for q in months), 2)
            if upd:
                await db.aop_rows.update_one({"dataset": dataset, "key": key}, {"$set": {f"fields.{k}": v for k, v in upd.items()}})

    async def after_edit(dataset: str, changed: List[tuple]):
        await recalc_budget(dataset, changed)
        if not changed:
            return
        if dataset == "po_links":  # allocation is shared across lines: re-resolve every line
            for k in {k for k, fld in changed if fld == "alloc_pct"}:  # a user-entered % is never changed by the system
                await db.aop_rows.update_one({"dataset": "po_links", "key": k}, {"$set": {"fields.alloc_auto": False}})
            await recalc_tracker()
            return
        if dataset != "opex_tracker":
            return
        cfg = await get_config()
        keys = {k for k, fld in changed if fld in tracker_inputs(cfg["plan_fy"])}
        if keys:
            await recalc_tracker(list(keys))

    # ------------------------------------------------------------------ config & catalogue
    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        cfg = await get_config()
        p = await perms_for(user)
        return {**cfg, "permissions": p}

    @r.put("/config")
    async def update_config(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        allowed = {"base_fy", "plan_fy", "draft_fy", "cutoffs", "tax_rate", "edit_modes", "drivers", "report_formats",
                   "mis_segments", "mis_solutions_noncute", "dept_aliases"}
        upd = {k: v for k, v in payload.items() if k in allowed}
        if "report_formats" in upd:
            keys = {f["key"] for f in mis.FORMATS}
            upd["report_formats"] = {k: bool(v) for k, v in (upd["report_formats"] or {}).items() if k in keys}
        if "mis_segments" in upd:
            upd["mis_segments"] = {k: v for k, v in (upd["mis_segments"] or {}).items() if v in ("solutions", "ca_cr", "common")}
        if "dept_aliases" in upd:
            upd["dept_aliases"] = {str(k).strip(): [str(x).strip() for x in (v if isinstance(v, list) else [v]) if str(x).strip()]
                                   for k, v in (upd["dept_aliases"] or {}).items() if str(k).strip()}
        if "edit_modes" in upd:
            upd["edit_modes"] = {k: ("approval" if v == "approval" else "direct") for k, v in upd["edit_modes"].items() if k in AOP_SECTIONS}
        await db.aop_config.update_one({"id": "aop"}, {"$set": upd}, upsert=True)
        await bump_version()
        await write_audit(db, entity_type="aop_config", entity_id="aop", action="update", user=user, field_changes=upd)
        return await get_config()

    # ------------------------------------------------------------------ admin default views (every report / grid)
    VIEW_FIELDS = {"order", "hidden", "pivot", "subtotals", "repeatLabels", "filtersOn", "twelveM", "sort", "period",
                   "measures", "segments", "variance", "subs", "section", "view", "selected"}

    @r.get("/views")
    async def views(user: dict = Depends(get_current_user)):
        """Default layouts an admin saved for everyone: {grid key: view}. Viewers start from these; "Default" returns to them."""
        return {d["key"]: d.get("view") or {} async for d in db.aop_views.find({}, {"_id": 0, "key": 1, "view": 1})}

    @r.put("/views/{key}")
    async def save_view(key: str, view: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        clean = {k: v for k, v in view.items() if k in VIEW_FIELDS}
        await db.aop_views.update_one({"key": key}, {"$set": {"view": clean, "updated_at": now_iso(), "updated_by": user.get("email")}},
                                      upsert=True)
        await write_audit(db, entity_type="aop_view", entity_id=key, action="update", user=user, field_changes=clean)
        return clean

    @r.delete("/views/{key}")
    async def clear_view(key: str, user: dict = Depends(get_current_user)):
        require_admin(user)
        await db.aop_views.delete_one({"key": key})
        return {"ok": True}

    @r.get("/departments")
    async def departments(user: dict = Depends(get_current_user)):
        """Department names in the overhead / payroll data, the employee master's departments and how they map
        (for the role editor's department scope). Non-admins get their own resolved scope."""
        p = await perms_for(user)
        if not p["admin"]:
            return {"scope": p.get("dept_scope"), "departments": p.get("departments")}
        data, actuals, cfg = await load_all()
        aop: set = set()
        for ds, flds in (("overhead_lines", ("pl_tag",)), ("overhead_plan", ("department",)), ("payroll_lines", ("tag", "department"))):
            for f in data.get(ds, []):
                if ds == "payroll_lines" and norm(f.get("category")) in ("sub total", ""):
                    continue
                aop.update(str(f[k]).strip() for k in flds if f.get(k) not in (None, ""))
        aop.update(str((a.get("dims") or {})["pl_tag"]) for a in actuals if a.get("domain") == "overhead" and (a.get("dims") or {}).get("pl_tag"))
        aop.discard("Others")
        emp = sorted({str(e[k]).strip() async for e in db.employees.find({}, {"_id": 0, "department": 1, "sub_department": 1})
                      for k in ("department", "sub_department") if e.get(k)})
        aliases = cfg.get("dept_aliases") or {}
        mapping = {d: sorted(x for x in aop if dept_scope.allowed(dept_scope.expand([d], aliases), x)) for d in emp}
        return {"aop": sorted(aop), "employees": emp, "aliases": aliases, "mapping": mapping}

    @r.get("/datasets")
    async def datasets(user: dict = Depends(get_current_user)):
        out = []
        counts = {d["_id"]: d["n"] async for d in db.aop_rows.aggregate([{"$group": {"_id": "$dataset", "n": {"$sum": 1}}}])}
        metas = {m["dataset"]: m async for m in db.aop_dataset_meta.find({}, {"_id": 0})}
        for key, spec in SPECS.items():
            if not await can(user, key):
                continue
            m = metas.get(key) or {}
            out.append({"key": key, "label": spec.label, "group": spec.group, "section": spec.section,
                        "description": spec.description, "sensitive": spec.sensitive,
                        "key_fields": spec.key_fields or ["line_id"], "rows": counts.get(key, 0),
                        "columns": len(m.get("columns") or []), "updated_at": m.get("updated_at"),
                        "can_upload": await can(user, key, "upload")})
        if user.get("role") == "admin":
            n = await db.aop_actuals.count_documents({})
            out.append({"key": ACTUALS, "label": "Actuals (single source)", "group": "Actuals", "section": "admin",
                        "description": "Every booked actual — revenue, opex accruals, payroll, overhead vouchers & provisions.",
                        "sensitive": False, "key_fields": ["uid"], "rows": n, "columns": len(ACTUAL_COLUMNS)})
        return out

    # ------------------------------------------------------------------ columns (admin)
    @r.get("/datasets/{dataset}/columns")
    async def get_columns(dataset: str, user: dict = Depends(get_current_user)):
        ensure_ds(dataset)
        if not await can(user, dataset):
            raise HTTPException(403, "Not allowed")
        return await columns_with_draft(dataset)

    @r.put("/datasets/{dataset}/columns")
    async def put_columns(dataset: str, columns: List[Dict[str, Any]] = Body(...), purge: bool = False,
                          user: dict = Depends(get_current_user)):
        """Replace the column list — add, delete, rename, re-type, reorder, hide, mark user-editable."""
        require_admin(user)
        ensure_ds(dataset)
        seen, clean = set(), []
        for c in columns:
            key = c.get("key") or slug(c.get("label"))
            if dataset != ACTUALS:
                key = slug(key) if not key.replace("_", "").replace("-", "").isalnum() else key
            if key in seen:
                raise HTTPException(400, f"Duplicate column key {key}")
            seen.add(key)
            clean.append({"key": key, "label": c.get("label") or key, "type": c.get("type") or "text",
                          "user_editable": bool(c.get("user_editable")), "hidden": bool(c.get("hidden")),
                          "group": c.get("group") or "", "width": c.get("width"), "custom": bool(c.get("custom"))})
        old = {c["key"] for c in await columns_for(dataset)}
        removed = old - seen
        await db.aop_dataset_meta.update_one({"dataset": dataset}, {"$set": {"columns": clean, "updated_at": now_iso()}}, upsert=True)
        if removed and purge and dataset != ACTUALS:  # optional: also erase the removed columns' data
            await db.aop_rows.update_many({"dataset": dataset}, {"$unset": {f"fields.{k}": "" for k in removed}})
        await write_audit(db, entity_type="aop_columns", entity_id=dataset, action="update", user=user,
                          field_changes={"columns": [c["key"] for c in clean], "removed": sorted(removed)})
        return clean

    # ------------------------------------------------------------------ rows
    def match_query(dataset: str, q: Optional[str], filters: Dict[str, str]) -> Dict[str, Any]:
        mq: Dict[str, Any] = {} if dataset == ACTUALS else {"dataset": dataset}
        prefix = "" if dataset == ACTUALS else "fields."
        for k, v in filters.items():
            if v not in (None, ""):
                mq[prefix + k] = v
        if q:
            import re as _re
            rx = {"$regex": _re.escape(q), "$options": "i"}
            if dataset == ACTUALS:
                mq["$or"] = [{"ref": rx}, {"narration": rx}, {"voucher": rx}, {"dims.vendor": rx}, {"dims.aop_head": rx}, {"dims.po": rx}]
            else:
                mq["$or"] = [{"key": rx}] + [{f"fields.{k}": rx} for k in ("line_id", "po", "aop_code", "vendor", "project_id",
                                                                          "project_name", "aop_head", "department", "name",
                                                                          "description_of_work", "purchase_order", "supplier_name",
                                                                          "old_po", "new_po", "wbs", "tag", "location")]
        return mq

    @r.get("/datasets/{dataset}/rows")
    async def rows(dataset: str, q: Optional[str] = None, limit: int = Query(200, le=5000), offset: int = 0,
                   filter_field: Optional[str] = None, filter_value: Optional[str] = None, keys: Optional[str] = None,
                   user: dict = Depends(get_current_user)):
        ensure_ds(dataset)
        if not await can(user, dataset):
            raise HTTPException(403, "Not allowed")
        filters = {filter_field: filter_value} if filter_field else {}
        mq = match_query(dataset, q, filters)
        if keys:  # just these lines (the grid re-reads what it saved)
            mq["uid" if dataset == ACTUALS else "key"] = {"$in": [k for k in keys.split("\x01") if k]}
        p = await perms_for(user)
        if dataset == ACTUALS:
            total = await db.aop_actuals.count_documents(mq)
            docs = [d async for d in db.aop_actuals.find(mq, {"_id": 0}).sort([("domain", 1), ("period", 1)]).skip(offset).limit(limit)]
            return {"total": total, "rows": [{"key": d.get("uid"), "fields": d} for d in docs]}
        if not p["admin"] and p["tags"]:
            mq["$and"] = [{"$or": [{"fields.tag": {"$in": p["tags"]}}, {"fields.tag": {"$exists": False}}]}]
        proj = {"_id": 0, "key": 1, "fields": 1, "updated_at": 1, "updated_by": 1}
        if p.get("departments") is not None and dataset in dept_scope.SCOPED_DATASETS:
            # department-scoped role: only the user's own departments' lines
            docs = [d async for d in db.aop_rows.find(mq, proj).sort("seq", 1)
                    if dept_scope.row_allowed(p["departments"], dataset, d.get("fields") or {})]
            total = len(docs)
            docs = docs[offset:offset + limit]
        else:
            total = await db.aop_rows.count_documents(mq)
            docs = [d async for d in db.aop_rows.find(mq, proj).sort("seq", 1).skip(offset).limit(limit)]
        pending = {}
        if docs:
            async for c in db.aop_changes.find({"dataset": dataset, "status": "pending", "key": {"$in": [d["key"] for d in docs]}},
                                               {"_id": 0, "key": 1, "field": 1, "new": 1, "id": 1}):
                pending.setdefault(c["key"], {})[c["field"]] = {"value": c["new"], "id": c["id"]}
        for d in docs:
            if d["key"] in pending:
                d["pending"] = pending[d["key"]]
        if dataset in ACTUAL_LINKS and docs:
            await actual_months(dataset, docs)
        if dataset == "opex_tracker" and docs:  # add-on lines sort under their parent
            kids: Dict[str, List[Dict[str, Any]]] = {}
            for d in docs:
                par = (d.get("fields") or {}).get("parent_line_id")
                if par:
                    kids.setdefault(par, []).append(d)
            if kids:
                keys_here = {d["key"] for d in docs}
                ordered = []
                for d in docs:
                    par = (d.get("fields") or {}).get("parent_line_id")
                    if par and par in keys_here:
                        continue
                    ordered.append(d)
                    ordered += kids.get(d["key"], [])
                docs = ordered
        if dataset in OPEX_DATASETS and docs:  # computed columns (YTD, totals, variance, bridge check)
            cfg = await get_config()
            acts = await opex_actuals([d["key"] for d in docs]) if dataset == "opex_lines" else {}
            for d in docs:
                d["fields"] = {**d.get("fields", {}), **opex_schema.derive(d.get("fields") or {}, dataset, cfg, acts.get(d["key"]))}
        return {"total": total, "rows": docs}

    async def opex_actuals(keys: Optional[List[str]] = None) -> Dict[str, Dict[str, float]]:
        """Booked opex actuals per opex line (ref = line id) for the base year."""
        cfg = await get_config()
        q: Dict[str, Any] = {"domain": "opex", "period": {"$in": fy_months(cfg["base_fy"])}}
        if keys is not None:
            q["ref"] = {"$in": keys}
        out: Dict[str, Dict[str, float]] = {}
        async for a in db.aop_actuals.find(q, {"_id": 0, "ref": 1, "period": 1, "amount": 1}):
            m = out.setdefault(a.get("ref"), {})
            m[a["period"]] = m.get(a["period"], 0.0) + float(a.get("amount") or 0)
        return out

    @r.patch("/datasets/{dataset}/rows")
    async def edit_cells(dataset: str, edits: List[Dict[str, Any]] = Body(...), user: dict = Depends(get_current_user)):
        """Batch cell edits ``[{key, field, value}]`` — from the grid, including multi-cell paste from Excel."""
        ensure_ds(dataset)
        if dataset == ACTUALS:
            require_admin(user)
        if dataset in READONLY_DATASETS:
            raise HTTPException(400, "This dataset is written by the ZMM run — change it through Review")
        p = await perms_for(user)
        if not await can(user, dataset, "edit"):
            raise HTTPException(403, "You don't have edit rights on this section")
        cols = {c["key"]: c for c in await columns_with_draft(dataset)}
        cfg = await get_config()
        spec = SPECS.get(dataset)
        mode = "direct" if p["admin"] else cfg["edit_modes"].get(spec.section if spec else "", "approval")
        applied, queued, rejected = 0, 0, []
        changed: List[tuple] = []
        for e in edits[:5000]:
            key, fld = str(e.get("key") or ""), str(e.get("field") or "")
            col = cols.get(fld)
            if not col or col.get("actual"):
                rejected.append({"key": key, "field": fld, "reason": "unknown column" if not col else "actuals come from the actual source"}); continue
            if col.get("role") in ("computed", "system", "key"):
                rejected.append({"key": key, "field": fld, "reason": "computed column"}); continue
            if not p["admin"] and not col.get("user_editable"):
                rejected.append({"key": key, "field": fld, "reason": "column is not editable"}); continue
            if spec and fld in spec.key_fields:
                rejected.append({"key": key, "field": fld, "reason": "key columns can't be edited"}); continue
            val = coerce(col.get("type", "text"), e.get("value"))
            if dataset == ACTUALS:
                res = await db.aop_actuals.update_one({"uid": key}, {"$set": {fld: val}})
                applied += res.matched_count
                continue
            doc = await db.aop_rows.find_one({"dataset": dataset, "key": key}, {"_id": 0, "fields": 1})
            if not doc:
                rejected.append({"key": key, "field": fld, "reason": "row not found"}); continue
            if not dept_scope.row_allowed(p.get("departments"), dataset, doc.get("fields") or {}):
                rejected.append({"key": key, "field": fld, "reason": "another department's line"}); continue
            if p.get("departments") is not None and fld in dept_scope.ROW_FIELDS.get(dataset, ()):
                rejected.append({"key": key, "field": fld, "reason": "the department can't be changed"}); continue
            old = (doc.get("fields") or {}).get(fld)
            if old == val:
                continue
            if mode == "approval":
                await db.aop_changes.update_one(
                    {"dataset": dataset, "key": key, "field": fld, "status": "pending", "requested_by": user.get("email")},
                    {"$set": {"new": val, "old": old, "updated_at": now_iso(), "section": spec.section if spec else ""},
                     "$setOnInsert": {"id": gen_id(), "created_at": now_iso(), "requested_by_name": user.get("name")}},
                    upsert=True)
                queued += 1
            else:
                await db.aop_rows.update_one({"dataset": dataset, "key": key},
                                             {"$set": {f"fields.{fld}": val, "updated_at": now_iso(), "updated_by": user.get("email")}})
                await db.aop_history.insert_one({"dataset": dataset, "key": key, "field": fld, "old": old, "new": val,
                                                 "by": user.get("email"), "at": now_iso()})
                changed.append((key, fld))
                applied += 1
        if applied:
            await after_edit(dataset, changed)
            await bump_version()
            await write_audit(db, entity_type="aop_rows", entity_id=dataset, action="edit", user=user,
                              field_changes={"cells": applied})
        return {"applied": applied, "queued": queued, "rejected": rejected, "mode": mode}

    @r.post("/datasets/{dataset}/rows")
    async def add_rows(dataset: str, new_rows: List[Dict[str, Any]] = Body(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        ensure_ds(dataset)
        if dataset == ACTUALS:
            raise HTTPException(400, "Use upload for actuals")
        res = await upsert_rows(dataset, new_rows, "add", user)
        return res

    @r.delete("/datasets/{dataset}/rows")
    async def delete_rows(dataset: str, keys: List[str] = Body(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        ensure_ds(dataset)
        coll = db.aop_actuals if dataset == ACTUALS else db.aop_rows
        q = {"uid": {"$in": keys}} if dataset == ACTUALS else {"dataset": dataset, "key": {"$in": keys}}
        res = await coll.delete_many(q)
        await bump_version()
        await write_audit(db, entity_type="aop_rows", entity_id=dataset, action="delete", user=user, field_changes={"keys": keys[:50]})
        return {"deleted": res.deleted_count}

    # ------------------------------------------------------------------ upload / download (admin only)
    async def upsert_rows(dataset: str, incoming: List[Dict[str, Any]], mode: str, user: dict,
                          scope: Optional[List[str]] = None, add_columns: bool = True) -> Dict[str, Any]:
        spec = SPECS[dataset]
        cols = {c["key"]: c for c in await columns_with_draft(dataset)}
        scoped = scope is not None and dataset in dept_scope.SCOPED_DATASETS
        proj = {"_id": 0, "key": 1, "seq": 1, **({"fields": 1} if scoped or dataset in BUDGET_INPUT_DATASETS else {})}
        existing = {d["key"]: d for d in [x async for x in db.aop_rows.find({"dataset": dataset}, proj)]}
        if mode == "replace":
            await db.aop_rows.delete_many({"dataset": dataset})
            existing = {}
        seq = max([d.get("seq") or 0 for d in existing.values()] + [0])
        added = updated = skipped = 0
        touched: List[tuple] = []
        errors: List[Dict[str, Any]] = []
        auto_n = 0
        seen = set()
        new_docs = []
        for i, raw in enumerate(incoming, start=2):
            fields = {}
            for k, v in raw.items():
                if k in ("key", "_key") or (cols.get(k) or {}).get("actual"):
                    continue
                col = cols.get(k)
                fields[k] = coerce(col["type"], v) if col else (v if v != "" else None)
            fields = {k: v for k, v in fields.items() if v is not None}
            if spec.auto_prefix and not fields.get("line_id"):
                if mode == "modify":
                    errors.append({"row": i, "reason": "line_id is required to modify a row"}); continue
                auto_n += 1
                fields["line_id"] = f"{spec.auto_prefix}-N{datetime.now().strftime('%y%m%d%H%M%S')}{auto_n:04d}"
            key = build_key(spec, fields)
            if not key:
                errors.append({"row": i, "reason": f"missing key ({', '.join(spec.key_fields or ['line_id'])})"}); continue
            if key in seen:
                errors.append({"row": i, "reason": f"duplicate key in file: {key}"}); continue
            seen.add(key)
            if scoped:  # department-scoped users upload their own departments' lines only
                cur = (existing.get(key) or {}).get("fields") or {}
                if not dept_scope.row_allowed(scope, dataset, cur or fields) or \
                        (cur and not dept_scope.row_allowed(scope, dataset, {**cur, **fields})):
                    errors.append({"row": i, "reason": "line belongs to another department"}); continue
            if key in existing:
                if mode == "add":
                    skipped += 1; continue
                await db.aop_rows.update_one({"dataset": dataset, "key": key},
                                             {"$set": {**{f"fields.{k}": v for k, v in fields.items()},
                                                       "updated_at": now_iso(), "updated_by": user.get("email")}})
                old_f = existing[key].get("fields") or {}
                touched += [(key, k) for k, v in fields.items() if old_f.get(k) != v]
                updated += 1
            else:
                if mode == "modify":
                    skipped += 1; continue
                seq += 1
                new_docs.append({"dataset": dataset, "key": key, "seq": seq, "fields": fields,
                                 "updated_at": now_iso(), "updated_by": user.get("email")})
                touched += [(key, k) for k in fields]
                added += 1
        if new_docs:
            for j in range(0, len(new_docs), 1000):
                await db.aop_rows.insert_many(new_docs[j:j + 1000])
        await recalc_budget(dataset, touched)
        # unseen columns in an upload are appended to the column list (admins can tidy them later)
        unknown = sorted({k for raw in incoming for k in raw if k not in cols and k not in ("key", "_key")})
        if unknown and add_columns:
            meta_cols = list(cols.values()) + [column(slug(k), k) | {"custom": True} for k in unknown]
            await db.aop_dataset_meta.update_one({"dataset": dataset}, {"$set": {"columns": meta_cols, "updated_at": now_iso()}}, upsert=True)
        await bump_version()
        await write_audit(db, entity_type="aop_upload", entity_id=dataset, action=mode, user=user,
                          field_changes={"added": added, "updated": updated, "skipped": skipped, "errors": len(errors)})
        return {"mode": mode, "added": added, "updated": updated, "skipped": skipped, "errors": errors[:200], "new_columns": unknown}

    def read_table(content: bytes, filename: str, columns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        by_label = {norm(c["label"]): c["key"] for c in columns}
        by_key = {norm(c["key"]): c["key"] for c in columns}

        def keyof(h):
            h = str(h or "").strip()
            return by_key.get(norm(h)) or by_label.get(norm(h)) or slug(h)
        rows_out = []
        if filename.lower().endswith((".xlsx", ".xlsm")):
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            ws = wb.worksheets[0]
            it = ws.iter_rows(values_only=True)
            header = [keyof(h) for h in next(it)]
            for row in it:
                if not any(v not in (None, "") for v in row):
                    continue
                rows_out.append({h: v for h, v in zip(header, row) if h})
        else:
            text = content.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            header = [keyof(h) for h in next(reader)]
            for row in reader:
                if not any(v.strip() for v in row):
                    continue
                rows_out.append({h: v for h, v in zip(header, row) if h})
        return rows_out

    @r.post("/datasets/{dataset}/upload")
    async def upload(dataset: str, mode: str = Query("upsert", pattern="^(add|replace|modify|upsert)$"),
                     file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        # bulk change: admins, or roles an admin granted "upload" on this section
        ensure_ds(dataset)
        if not await can(user, dataset, "upload"):
            raise HTTPException(403, "Bulk upload needs the upload permission for this section — ask an administrator")
        if mode == "replace" and user.get("role") != "admin":
            raise HTTPException(403, "Only an administrator can replace a whole dataset")
        if dataset in READONLY_DATASETS:
            raise HTTPException(400, "This dataset is written by the ZMM run — upload the ZMM report under Imports")
        content = await file.read()
        if dataset in OPEX_DATASETS:
            return await upload_opex(dataset, content, file.filename or "upload.xlsx", mode, user)
        cols = await columns_with_draft(dataset)
        incoming = read_table(content, file.filename or "upload.csv", cols)
        if dataset == "po_links":  # numbers as digit strings, S. No. → line id, so keys match line|po|material|item
            for raw in incoming:
                for k in ("po", "material", "po_item"):
                    raw[k] = opex_schema.po_str(raw.get(k)) or ""
                lid = raw.get("line_id")
                raw["line_id"] = opex_schema.line_id_from_sno(lid) if isinstance(lid, (int, float)) or str(lid or "").isdigit() else lid
        if dataset == ACTUALS:
            return await upsert_actuals(incoming, mode, user)
        p = await perms_for(user)
        res = await upsert_rows(dataset, incoming, mode, user, p.get("departments"))
        if dataset == "po_links":
            for raw in incoming:  # an uploaded % is the user's
                if raw.get("alloc_pct") not in (None, ""):
                    k = PO.link_key(str(raw.get("line_id") or ""), raw["po"], raw["material"], raw["po_item"])
                    await db.aop_rows.update_one({"dataset": "po_links", "key": k}, {"$set": {"fields.alloc_auto": False}})
            await recalc_tracker()
        return res

    def sheet_rows(content: bytes, filename: str, prefer: Optional[str] = None) -> List[tuple]:
        if filename.lower().endswith((".xlsx", ".xlsm")):
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            name = next((n for n in wb.sheetnames if prefer and norm(n).replace(" ", "_") == norm(prefer)), None)
            ws = wb[name] if name else wb.worksheets[0]
            return [tuple(x) for x in ws.iter_rows(values_only=True)]
        text = content.decode("utf-8-sig", errors="replace")
        return [tuple(x) for x in csv.reader(io.StringIO(text))]

    async def upload_opex(dataset: str, content: bytes, filename: str, mode: str, user: dict) -> Dict[str, Any]:
        """Opex lines / tracker upload in the one Opex layout: unknown headers are reported (never added as columns),
        computed columns and next-FY months are ignored, opex_lines' current-FY months split into actuals (to the
        cut-off) and forecast, and for SAP POs in the ZMM the ZMM value wins over an uploaded one (warned)."""
        cfg = await get_config()
        cur, nxt = opex_schema.fys_for(dataset, cfg)
        try:
            parsed = opex_schema.read_lines(sheet_rows(content, filename, dataset), dataset)
        except ValueError as e:
            raise HTTPException(400, str(e))
        warnings: List[str] = []
        cw = opex_schema.crore_months_warning(parsed["lines"], nxt)
        if cw and nxt in parsed["months"]:
            warnings.append(cw)
        zmm_pos = {d["fields"].get("po") async for d in db.aop_rows.find({"dataset": "po_items"}, {"_id": 0, "fields.po": 1})}
        existing = {d["key"]: d.get("fields") or {} async for d in db.aop_rows.find({"dataset": dataset}, {"_id": 0, "key": 1, "fields": 1})}
        cut = (cfg.get("cutoffs") or {}).get("default") or ""
        incoming, acts = [], []
        auto_n = 0
        for f in parsed["lines"]:
            months = f.pop("_months", {})
            row_n = f.pop("_row")
            sno = f.pop("_sno", None)
            if not f.get("line_id") and dataset == "opex_tracker" and sno not in (None, ""):
                f["line_id"] = opex_schema.line_id_from_sno(sno)
            if not f.get("line_id") and mode != "modify":  # new line: its id now, so its booked months can follow it
                auto_n += 1
                f["line_id"] = f"{SPECS[dataset].auto_prefix}-N{datetime.now().strftime('%y%m%d%H%M%S')}{auto_n:04d}"
            po = f.get("po")
            if po in zmm_pos:
                old = existing.get(f.get("line_id") or "", {})
                for k in opex_schema.ZMM_KEYS:
                    if k in f:
                        v = f.pop(k)
                        if old.get(k) not in (None, "") and old.get(k) != v:
                            warnings.append(f"Row {row_n}: {k} differs from the ZMM for PO {po} — ZMM value kept")
            if dataset == "opex_lines":
                for p_ in fy_months(cur):
                    if p_ in months:
                        if p_ <= cut:
                            acts.append((f, p_, months[p_]))
                        else:
                            f[f"F{cur[2:]}__{p_}"] = months[p_]
                opex_schema.phase_budget(f, nxt)
            elif dataset == "opex_tracker":
                opex_schema.phase_budget(f, nxt)
            incoming.append(f)
        p = await perms_for(user)
        res = await upsert_rows(dataset, incoming, mode, user, p.get("departments"), add_columns=False)
        if acts:
            for f, per, amt in acts:
                lid = f.get("line_id")
                if not lid:
                    continue
                dims = {k: f.get(k) for k in ("category", "geo", "tag", "aop_code", "wbs", "po", "vendor", "cost_centre")}
                await db.aop_actuals.update_one({"uid": f"opex|{lid}|{per}"},
                                                {"$set": {"domain": "opex", "ref": lid, "period": per, "amount": float(amt),
                                                          "dims": dims, "source": "upload", "uid": f"opex|{lid}|{per}"}}, upsert=True)
            await bump_version()
        if dataset == "opex_tracker":
            await recalc_tracker()
        res.update(ignored_columns=parsed["ignored"], dropped_columns=parsed["dropped"], warnings=warnings[:200],
                   header_row=parsed["header_row"])
        return res

    async def upsert_actuals(incoming: List[Dict[str, Any]], mode: str, user: dict):
        if mode == "replace":
            domains = {str(x.get("domain")) for x in incoming if x.get("domain")}
            await db.aop_actuals.delete_many({"domain": {"$in": list(domains)}})
        added = updated = skipped = 0
        errors = []
        for i, raw in enumerate(incoming, start=2):
            doc: Dict[str, Any] = {"dims": {}}
            for k, v in raw.items():
                if v in (None, ""):
                    continue
                if k.startswith("dims."):
                    doc["dims"][k[5:]] = v
                elif k == "amount":
                    doc[k] = coerce("number", v)
                else:
                    doc[k] = str(v).strip() if not isinstance(v, (int, float)) else v
            per = doc.get("period")
            if isinstance(per, (int, float)) or (per and len(str(per)) > 7):
                from .periods import to_period
                doc["period"] = to_period(per) or str(per)[:7]
            if not doc.get("domain") or not doc.get("period") or doc.get("amount") is None:
                errors.append({"row": i, "reason": "domain, period and amount are required"}); continue
            doc["uid"] = doc.get("uid") or f"{doc['domain']}|{doc.get('ref') or 'upload'}|{doc['period']}|{i}"
            exists = await db.aop_actuals.find_one({"uid": doc["uid"]}, {"_id": 1})
            if exists and mode == "add":
                skipped += 1; continue
            if not exists and mode == "modify":
                skipped += 1; continue
            doc["source"] = doc.get("source") or "upload"
            await db.aop_actuals.update_one({"uid": doc["uid"]}, {"$set": doc}, upsert=True)
            updated += 1 if exists else 0
            added += 0 if exists else 1
        await bump_version()
        await write_audit(db, entity_type="aop_upload", entity_id=ACTUALS, action=mode, user=user,
                          field_changes={"added": added, "updated": updated, "skipped": skipped})
        return {"mode": mode, "added": added, "updated": updated, "skipped": skipped, "errors": errors[:200]}

    @r.get("/datasets/{dataset}/download")
    async def download(dataset: str, fmt: str = Query("xlsx", pattern="^(xlsx|csv)$"), template: bool = False,
                       user: dict = Depends(get_current_user)):
        ensure_ds(dataset)
        if not (await can(user, dataset, "upload") or (dataset != ACTUALS and await can(user, dataset, "view"))):
            raise HTTPException(403, "Not allowed")
        ensure_ds(dataset)
        if dataset in OPEX_DATASETS:
            return await download_opex(dataset, fmt, template, user)
        cols = [c for c in await columns_with_draft(dataset) if not c.get("actual")]
        spec = SPECS.get(dataset)
        if spec and spec.auto_prefix and "line_id" not in {c["key"] for c in cols}:
            cols = [column("line_id", "line_id")] + cols
        keys = [c["key"] for c in cols]
        rows_iter: List[List[Any]] = []
        if not template:
            if dataset == ACTUALS:
                async for d in db.aop_actuals.find({}, {"_id": 0}):
                    rows_iter.append([(d.get("dims") or {}).get(k[5:]) if k.startswith("dims.") else d.get(k) for k in keys])
            else:
                scope = (await perms_for(user)).get("departments")
                async for d in db.aop_rows.find({"dataset": dataset}, {"_id": 0, "fields": 1}).sort("seq", 1):
                    f = d.get("fields") or {}
                    if dept_scope.row_allowed(scope, dataset, f):
                        rows_iter.append([f.get(k) for k in keys])
        name = f"{dataset}{'_template' if template else ''}"
        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(keys)
            w.writerows(rows_iter)
            data = io.BytesIO(buf.getvalue().encode("utf-8-sig"))
            return StreamingResponse(data, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
        wb = openpyxl.Workbook(write_only=True)
        ws = wb.create_sheet(dataset[:31])
        ws.append(keys)
        for row in rows_iter:
            ws.append(row)
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})

    async def download_opex(dataset: str, fmt: str, template: bool, user: dict):
        """Exactly the §3.2 order with today's FY labels; computed columns included (shaded grey) so the file
        round-trips through upload."""
        cfg = await get_config()
        lay = opex_schema.layout(dataset, cfg)
        custom = [c for c in await columns_for(dataset) if c.get("custom")]
        lay += [{"key": c["key"], "label": c["label"], "type": c.get("type", "text"), "role": "input"} for c in custom]
        rows_out: List[List[Any]] = []
        if not template:
            acts = await opex_actuals() if dataset == "opex_lines" else {}
            scope = (await perms_for(user)).get("departments")
            async for d in db.aop_rows.find({"dataset": dataset}, {"_id": 0, "key": 1, "fields": 1}).sort("seq", 1):
                f = d.get("fields") or {}
                if not dept_scope.row_allowed(scope, dataset, f):
                    continue
                f = {**f, **opex_schema.derive(f, dataset, cfg, acts.get(d["key"]))}
                rows_out.append([f.get(c["key"]) for c in lay])
        name = f"{dataset}{'_template' if template else ''}"
        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow([c["month"] if c.get("month") else c["label"] for c in lay])
            w.writerows(rows_out)
            return StreamingResponse(io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
                                     headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
        from openpyxl.styles import Font, PatternFill
        from openpyxl.cell import WriteOnlyCell
        wb = openpyxl.Workbook(write_only=True)
        ws = wb.create_sheet(dataset[:31])
        grey = PatternFill("solid", fgColor="E5E7EB")
        head = PatternFill("solid", fgColor="0A1628")
        computed = [c.get("role") in ("computed", "system") for c in lay]
        hdr = []
        for c, comp in zip(lay, computed):
            cell = WriteOnlyCell(ws, value=datetime(int(c["month"][:4]), int(c["month"][5:]), 1) if c.get("month") else c["label"])
            if c.get("month"):
                cell.number_format = "mmm-yy"
            cell.font = Font(bold=True, color="FFFFFF" if not comp else "374151")
            cell.fill = grey if comp else head
            hdr.append(cell)
        ws.append(hdr)
        for row in rows_out:
            out_row = []
            for v, comp in zip(row, computed):
                if isinstance(v, list):
                    v = ", ".join(str(x) for x in v)
                if comp:
                    cell = WriteOnlyCell(ws, value=v)
                    cell.fill = grey
                    out_row.append(cell)
                else:
                    out_row.append(v)
            ws.append(out_row)
        out = io.BytesIO()
        wb.save(out)
        out.seek(0)
        return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})

    # ------------------------------------------------------------------ workbook import (admin)
    async def write_result(res: Result, user: dict, replace_actual_domains: Optional[List[str]] = None):
        for ds, payload in res.datasets.items():
            if payload.get("upsert"):
                await upsert_import(ds, payload["rows"], user)
                continue
            await db.aop_rows.delete_many({"dataset": ds})
            docs = []
            for i, f in enumerate(payload["rows"], start=1):
                key = f.pop("_key")
                docs.append({"dataset": ds, "key": key, "seq": i, "fields": f, "updated_at": now_iso(), "updated_by": user.get("email")})
            for j in range(0, len(docs), 1000):
                await db.aop_rows.insert_many(docs[j:j + 1000])
            await db.aop_dataset_meta.update_one({"dataset": ds}, {"$set": {"columns": payload["columns"], "updated_at": now_iso(),
                                                                            "source": "import"}}, upsert=True)
        if replace_actual_domains:
            await db.aop_actuals.delete_many({"domain": {"$in": replace_actual_domains}, "source": {"$ne": "upload"}})
        if res.actuals:
            for a in res.actuals:
                a["source"] = "import"
            for j in range(0, len(res.actuals), 2000):
                await db.aop_actuals.insert_many([dict(a) for a in res.actuals[j:j + 2000]])

    async def upsert_import(ds: str, rows_in: List[Dict[str, Any]], user: dict):
        """Re-import without wiping portal work: lines upserted by key (file fields set, portal-only fields kept);
        lines missing from the file get in_last_import = false."""
        keys = []
        upd = {}
        for f in rows_in:
            k = f.pop("_key")
            keys.append(k)
            upd[k] = {**{x: v for x, v in f.items() if not x.startswith("_")}, "in_last_import": True}
        await engine.bulk_set(ds, upd, upsert=True, by=user.get("email") or "import")
        await db.aop_rows.update_many({"dataset": ds, "key": {"$nin": keys}}, {"$set": {"fields.in_last_import": False}})

    async def save_upload(file: UploadFile) -> str:
        fd, path = tempfile.mkstemp(suffix=".xlsx")
        with os.fdopen(fd, "wb") as out:
            while chunk := await file.read(1 << 20):
                out.write(chunk)
        return path

    @r.post("/import/aop-workbook")
    async def import_aop(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        path = await save_upload(file)
        try:
            res = import_aop_workbook(path)
        except Exception as e:  # noqa: BLE001 — report parse problems to the admin verbatim
            raise HTTPException(400, f"Could not read the AOP workbook: {e}")
        finally:
            os.unlink(path)
        domains = sorted({a["domain"] for a in res.actuals})
        await write_result(res, user, replace_actual_domains=domains)
        m = res.meta
        await db.aop_config.update_one({"id": "aop"}, {"$set": {
            "base_fy": m["base_fy"], "plan_fy": m["plan_fy"], "draft_fy": shift_fy(m["plan_fy"], 1),
            "cutoffs": {"default": m["actual_cutoff"], "overhead": m.get("overhead_actual_cutoff", m["actual_cutoff"])},
        }, "$setOnInsert": {"edit_modes": DEFAULT_CONFIG["edit_modes"], "tax_rate": 0.25}}, upsert=True)
        await bump_version()
        await db.aop_imports.insert_one({"id": gen_id(), "kind": "aop", "file": file.filename, "at": now_iso(), "by": user.get("email"),
                                         "meta": m, "warnings": res.warnings,
                                         "counts": {k: len(v["rows"]) for k, v in res.datasets.items()}, "actuals": len(res.actuals)})
        await write_audit(db, entity_type="aop_import", entity_id="aop", action="import", user=user,
                          field_changes={"file": file.filename, "actuals": len(res.actuals)})
        return {"meta": m, "warnings": res.warnings, "counts": {k: len(v["rows"]) for k, v in res.datasets.items()},
                "actuals": len(res.actuals)}

    @r.post("/import/opex-workbook")
    async def import_opex(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        cfg = await get_config()
        path = await save_upload(file)
        try:
            res = import_opex_workbook(path, plan=cfg.get("plan_fy", "FY27"))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"Could not read the Opex workbook: {e}")
        finally:
            with open(path, "rb") as fh:
                workbook_bytes = fh.read()
            os.unlink(path)
        await write_result(res, user)
        # links (upsert — portal-made links are kept) and line statuses
        tracker_keys = {d["key"] async for d in db.aop_rows.find({"dataset": "opex_tracker"}, {"_id": 0, "key": 1})}
        link_upd, unknown_lines = {}, set()
        for ln in res.links:
            if ln["line_id"] not in tracker_keys:
                unknown_lines.add(ln["line_id"])
                continue
            k = PO.link_key(ln["line_id"], ln["po"], ln.get("material"), ln.get("po_item"))
            link_upd[k] = {x: v for x, v in ln.items() if not x.startswith("_") and (v is not None or x in ("material", "po_item"))}
            link_upd[k]["material"] = ln.get("material") or ""
            link_upd[k]["po_item"] = ln.get("po_item") or ""
        await engine.bulk_set("po_links", link_upd, upsert=True, by=user.get("email"))
        st_upd = {k: v for k, v in res.statuses.items() if k in tracker_keys}
        await engine.bulk_set("opex_tracker", st_upd, by=user.get("email"))
        if unknown_lines:
            res.rejected.append(f"Links to lines not in the tracker: {', '.join(sorted(unknown_lines)[:30])}")
        zmm = None
        if res.has_zmm:
            last = await db.aop_rows.find_one({"dataset": "zmm_runs", "fields.status": "processed"}, {"_id": 0, "fields": 1},
                                              sort=[("fields.processed_at", -1)])
            zmm = await engine.run_zmm_pipeline(workbook_bytes, file.filename, "workbook", by=user.get("email"))
            if last and zmm.get("snapshot") and (last["fields"].get("snapshot") or "") > zmm["snapshot"]:
                res.warnings.append("The workbook's ZMM sheet is older than the stored snapshot")
        else:
            await recalc_tracker()
        await bump_version()
        counts = {"opex_tracker": len(res.datasets["opex_tracker"]["rows"]), "po_links": len(link_upd), "line_status": len(st_upd)}
        await db.aop_imports.insert_one({"id": gen_id(), "kind": "opex", "file": file.filename, "at": now_iso(), "by": user.get("email"),
                                         "meta": res.meta, "warnings": res.warnings, "rejected": res.rejected, "counts": counts})
        await write_audit(db, entity_type="aop_import", entity_id="opex", action="import", user=user,
                          field_changes={"file": file.filename, **counts})
        return {"meta": res.meta, "warnings": res.warnings, "rejected": res.rejected, "counts": counts,
                "zmm": {k: zmm.get(k) for k in ("run_id", "status", "error", "rows", "po_items", "to_map", "changes_flagged",
                                                "forecast_delta")} if zmm else None}

    @r.post("/import/zmm")
    async def import_zmm(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """Manual ZMM run — admins, or roles with upload on the PO register's section."""
        if not await can(user, "po_register", "upload"):
            raise HTTPException(403, "Uploading the ZMM report needs the upload permission on Opex")
        content = await file.read()
        if not content:
            raise HTTPException(400, "Empty file")
        run = await engine.run_zmm_pipeline(content, file.filename or "zmm.xlsx", "manual", by=user.get("email"))
        await write_audit(db, entity_type="aop_import", entity_id="zmm", action="import", user=user,
                          field_changes={"file": file.filename, "run": run["run_id"], "status": run["status"]})
        if run["status"] == "failed":
            await notify_run(run)
            raise HTTPException(400, f"ZMM run failed: {run.get('error')}")
        await notify_run(run)
        return run

    async def notify_run(run: Dict[str, Any]):
        await notify_zmm(db, run)

    # ------------------------------------------------------------------ monthly actuals (single actual source)
    async def replace_source(res: Result, source: str, user: dict):
        """Replace this source's actuals for the months the file contains; other sources and months are untouched."""
        periods = sorted({a["period"] for a in res.actuals})
        if periods:
            await db.aop_actuals.delete_many({"source": source, "period": {"$in": periods}})
        for a in res.actuals:
            a["source"] = source
            a["imported_by"] = user.get("email")
        for j in range(0, len(res.actuals), 2000):
            await db.aop_actuals.insert_many([dict(a) for a in res.actuals[j:j + 2000]])
        return periods

    async def log_import(kind: str, file, user: dict, meta: Dict[str, Any], extra: Optional[Dict[str, Any]] = None):
        await db.aop_imports.insert_one({"id": gen_id(), "kind": kind, "file": file.filename, "at": now_iso(),
                                         "by": user.get("email"), "meta": meta, **(extra or {})})
        await write_audit(db, entity_type="aop_import", entity_id=kind, action="import", user=user,
                          field_changes={"file": file.filename})

    async def run_import(file: UploadFile, fn, *args):
        path = await save_upload(file)
        try:
            return fn(path, *args)
        except Exception as e:  # noqa: BLE001 — report parse problems to the admin verbatim
            raise HTTPException(400, f"Could not read {file.filename}: {e}")
        finally:
            os.unlink(path)

    async def move_cutoff(keys: List[str], cutoff: Optional[str]):
        """Actual months now run to the file's last month (never moves a cut-off backwards)."""
        if not cutoff:
            return
        cfg = await get_config()
        cut = dict(cfg.get("cutoffs") or {})
        for k in keys:
            if not cut.get(k) or cut[k] < cutoff:
                cut[k] = cutoff
        await db.aop_config.update_one({"id": "aop"}, {"$set": {"cutoffs": cut}})

    @r.post("/import/mis-actuals")
    async def import_mis(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """MIS working file (SAP_Revenue + SAP_Expense + Mapping) → the plan year's actuals."""
        require_admin(user)
        cfg = await get_config()
        res = await run_import(file, import_mis_working, cfg["plan_fy"])
        periods = await replace_source(res, "mis", user)
        cut = res.meta.get("cutoff")
        keys = ["default", "overhead"] + [k for k in (cfg.get("cutoffs") or {}) if k not in ("payroll",)]
        await move_cutoff(sorted(set(keys)), cut)
        await bump_version()
        await log_import("mis_actuals", file, user, res.meta, {"actuals": len(res.actuals)})
        return {"meta": res.meta, "periods": periods, "actuals": len(res.actuals)}

    @r.post("/import/resource-cost")
    async def import_resources(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """Resource cost file (employee × WBS × month) → payroll actuals with FTE and headcount."""
        require_admin(user)
        cfg = await get_config()
        res = await run_import(file, import_resource_cost, cfg["plan_fy"])
        periods = await replace_source(res, "resource", user)
        await move_cutoff(["payroll"], res.meta.get("cutoff"))
        await bump_version()
        await log_import("resource_cost", file, user, res.meta, {"actuals": len(res.actuals)})
        return {"meta": res.meta, "periods": periods, "actuals": len(res.actuals)}

    @r.post("/import/reporting-package")
    async def import_package(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """Reporting package → actual billable PAX (CUTE drivers) and the capex tracker."""
        require_admin(user)
        cfg = await get_config()
        res = await run_import(file, import_reporting_package, cfg["plan_fy"])
        pax = res.datasets.pop("_pax_actual", {"rows": []})["rows"]
        for f in pax:
            key = pax_driver_key(f)
            cur = await db.aop_rows.find_one({"dataset": "rev_cute_drivers", "key": key}, {"_id": 0, "fields": 1})
            fields = {**((cur or {}).get("fields") or {}), **f}
            await db.aop_rows.update_one({"dataset": "rev_cute_drivers", "key": key},
                                         {"$set": {"fields": fields, "updated_at": now_iso(), "updated_by": user.get("email")},
                                          "$setOnInsert": {"seq": 9000}}, upsert=True)
        if pax:
            await refresh_wide_meta("rev_cute_drivers")
        if res.datasets:
            await write_result(res, user)
        await bump_version()
        await log_import("reporting_package", file, user, res.meta)
        return {"meta": res.meta, "pax_rows": len(pax), "counts": {k: len(v["rows"]) for k, v in res.datasets.items()}}

    @r.post("/import/project-health")
    async def import_projects(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        """Project health tracker (revenue master) → TCV, customer, owner and status on the project master."""
        require_admin(user)
        info = await run_import(file, import_project_health)
        n = 0
        for pid, f in info.items():
            upd = {f"fields.{k}": v for k, v in f.items() if v not in (None, "") and k != "project_name"}
            if not upd:
                continue
            r0 = await db.aop_rows.update_one({"dataset": "project_master", "key": pid}, {"$set": upd})
            n += r0.matched_count
        await bump_version()
        await log_import("project_health", file, user, {"projects": len(info), "matched": n})
        return {"projects": len(info), "matched": n}

    @r.get("/imports")
    async def imports(user: dict = Depends(get_current_user)):
        require_admin(user)
        return [d async for d in db.aop_imports.find({}, {"_id": 0}).sort("at", -1).limit(30)]

    # ------------------------------------------------------------------ P&L
    @r.get("/pnl/filters")
    async def pnl_filters(user: dict = Depends(get_current_user)):
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_pnl"]["can_view"]):
            raise HTTPException(403, "Not allowed")
        data, _, cfg = await load_all()
        tags = set()
        for ds in ("rev_cute", "rev_noncute", "opex_lines", "payroll_lines", "rev_projects"):
            for f in data.get(ds, []):
                if ds == "payroll_lines" and norm(f.get("category")) == "overheads":
                    continue  # overhead payroll lines carry the department in the tag column
                t = f.get("tag") or f.get("airport")
                if t and norm(t) != "shared services":
                    tags.add(str(t).strip())
        tags = sorted(tags, key=str.lower)
        if p["tags"]:
            tags = [t for t in tags if norm(t) in {norm(x) for x in p["tags"]}]
        return {"geo": ["All", "India", "International"], "tags": (["All"] if not p["tags"] else []) + tags,
                "base_fy": cfg["base_fy"], "plan_fy": cfg["plan_fy"]}

    PNL_BLOCKS = [  # (key, engine, part, label template, kind)
        ("b_base", 0, "b_base", "B {base}", "budget"),
        ("a_base", 0, "base", "A {base}", "actual"),
        ("b_plan", 0, "plan", "B {plan}", "budget"),
        ("af_plan", 1, "base", "{plan} A/F", "actual"),
        ("b_draft", 1, "plan", "B {draft}", "budget"),
    ]

    async def pnl_guard(user: dict, tag: str):
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_pnl"]["can_view"]):
            raise HTTPException(403, "You don't have access to the P&L")
        if p["tags"] and (norm(tag) == "all" or norm(tag) not in {norm(x) for x in p["tags"]}):
            if norm(tag) == "all" and len(p["tags"]) == 1:
                tag = p["tags"][0]
            else:
                raise HTTPException(403, "Select one of your permitted airports / entities")
        return p, tag

    @r.get("/pnl")
    async def pnl(geo: str = "All", tag: str = "All", exclude: Optional[str] = None, user: dict = Depends(get_current_user)):
        """P&L in column blocks: B base · A base · B plan · plan A/F · B draft, plus variances.
        Two engine runs: (base → plan) reproduces the approved workbook, (plan → draft) gives the current
        year's actual/forecast and next year's budget."""
        p, tag = await pnl_guard(user, tag)
        data, actuals, cfg = await load_all()
        payroll_ok = payroll_visible(p)
        return pnl_payload(data, actuals, cfg, geo, tag, exclude, payroll_ok)

    def pnl_payload(data, actuals, cfg, geo, tag, exclude, payroll_ok, mask=True):
        base, plan = cfg["base_fy"], cfg["plan_fy"]
        draft = cfg.get("draft_fy") or shift_fy(plan, 1)
        flt = Filters(geo, tag, [x for x in (exclude or "").split(",") if x])
        runs = [PnLEngine(data, actuals, base, plan, cfg["cutoffs"], cfg.get("tax_rate", 0.25), approved_fy=plan).compute(flt),
                PnLEngine(data, actuals, plan, draft, cfg["cutoffs"], cfg.get("tax_rate", 0.25), approved_fy=plan).compute(flt)]
        names = {"base": base, "plan": plan, "draft": draft}
        blocks = []
        for key, eng, part, label, kind in PNL_BLOCKS:
            cols_src = runs[eng]["columns"]
            if part == "b_base":
                cols = [{"key": f"{key}:total", "label": label.format(**names), "kind": "total", "src": (eng, "b_base")}]
            else:
                fy = runs[eng]["meta"]["base_fy" if part == "base" else "plan_fy"]
                cols = [{"key": f"{key}:{c['key']}", "label": c["label"], "kind": c["kind"], "month": True, "src": (eng, c["key"])}
                        for c in cols_src if c.get("fy") == fy]
                cols.append({"key": f"{key}:total", "label": label.format(**names), "kind": "total",
                             "src": (eng, "af_base" if part == "base" else "b_plan")})
            blocks.append({"key": key, "label": label.format(**names), "kind": kind, "columns": cols})
        blocks.append({"key": "var", "label": "Variance", "kind": "variance", "columns": [
            {"key": "var:af_vs_b", "label": f"{plan} A/F vs B", "kind": "variance"},
            {"key": "var:af_vs_b_pct", "label": f"{plan} A/F vs B %", "kind": "pct"},
            {"key": "var:growth", "label": f"B {draft} vs {plan} A/F %", "kind": "pct"}]})
        rows = []
        second = {r["id"]: r for r in runs[1]["rows"]}
        for r0 in runs[0]["rows"]:
            r1 = second.get(r0["id"], {"values": {}})
            v0, v1 = r0["values"] or {}, r1["values"] or {}
            vals = {}
            for b in blocks[:-1]:
                for c in b["columns"]:
                    eng, k = c["src"]
                    vals[c["key"]] = (v0 if eng == 0 else v1).get(k)
            if not r0["pct"]:
                af, bp, dr = v1.get("af_base") or 0.0, v0.get("b_plan") or 0.0, v1.get("b_plan") or 0.0
                vals["var:af_vs_b"] = af - bp
                vals["var:af_vs_b_pct"] = (af - bp) / abs(bp) if bp else None
                vals["var:growth"] = (dr - af) / abs(af) if af else None
            rows.append({k: r0[k] for k in ("id", "label", "level", "kind", "sensitive", "pct")} | {"values": vals})
        for b in blocks:
            for c in b["columns"]:
                c.pop("src", None)
        if mask and not payroll_ok:
            for row in rows:
                if row["sensitive"]:
                    row["values"] = None
                    row["masked"] = True
        draft_ready = any(k.startswith("B" + draft[2:] + "__") for f in data.get("opex_lines", [])[:50] for k in f)
        return {"blocks": blocks, "rows": rows,
                "meta": {"base_fy": base, "plan_fy": plan, "draft_fy": draft, "cutoffs": cfg["cutoffs"],
                         "payroll_visible": payroll_ok, "draft_ready": draft_ready,
                         "filters": {"geo": geo, "tag": tag, "exclude": exclude}}}

    # ------------------------------------------------------------------ MIS report formats
    def mis_cfg(cfg):
        return {**cfg, "draft_fy": cfg.get("draft_fy") or shift_fy(cfg["plan_fy"], 1)}

    @r.get("/mis/formats")
    async def mis_formats(user: dict = Depends(get_current_user)):
        p = await perms_for(user)
        cfg = await get_config()
        allowed = {s for s, v in p["sections"].items() if v["can_view"]}
        formats = mis.formats_for(cfg, None if p["admin"] else allowed, p["admin"])
        if p["tags"]:  # the regional P&L spans every entity
            formats = [f for f in formats if f["key"] != "regional_pnl"]
        return {"formats": formats,
                "segment_rules": mis.segment_rules(cfg), "blocks": [b for b, _ in mis.OH_BLOCKS],
                "solutions_noncute": mis.DEFAULT_SOLUTIONS_NONCUTE if cfg.get("mis_solutions_noncute") is None
                else cfg["mis_solutions_noncute"]}

    async def format_guard(key: str, cfg: Dict[str, Any], p: Dict[str, Any]):
        if not p["admin"] and not (cfg.get("report_formats") or {}).get(key, True):
            raise HTTPException(403, "This report format is disabled by the administrator")

    @r.get("/mis/full-pnl")
    async def mis_full_pnl(geo: str = "All", tag: str = "All", exclude: Optional[str] = None,
                           user: dict = Depends(get_current_user)):
        p, tag = await pnl_guard(user, tag)
        data, actuals, cfg = await load_all()
        await format_guard("full_pnl", cfg, p)
        cfg = mis_cfg(cfg)
        payroll_ok = payroll_visible(p)
        base = pnl_payload(data, actuals, cfg, geo, tag, exclude, payroll_ok, mask=False)
        flt = Filters(geo, tag, [x for x in (exclude or "").split(",") if x])
        out = mis.full_pnl(base, cfg, payroll_ok, mis.solutions_noncute(data, actuals, cfg, flt))
        out["meta"] = {**base["meta"], "filters": {"geo": geo, "tag": tag, "exclude": exclude}}
        return out

    @r.get("/mis/revenue")
    async def mis_revenue(geo: str = "All", tag: str = "All", exclude: Optional[str] = None,
                          user: dict = Depends(get_current_user)):
        p, tag = await pnl_guard(user, tag)
        data, actuals, cfg = await load_all()
        await format_guard("revenue_performance", cfg, p)
        cfg = mis_cfg(cfg)
        out = mis.revenue_performance(data, actuals, cfg, Filters(geo, tag, [x for x in (exclude or "").split(",") if x]))
        out["meta"] = {"base_fy": cfg["base_fy"], "plan_fy": cfg["plan_fy"], "draft_fy": cfg["draft_fy"],
                       "cutoffs": cfg["cutoffs"], "filters": {"geo": geo, "tag": tag, "exclude": exclude}}
        return out

    @r.get("/mis/regional")
    async def mis_regional(user: dict = Depends(get_current_user)):
        p = await perms_for(user)
        if p["tags"]:
            raise HTTPException(403, "The regional P&L covers all entities — your role is limited to specific airports")
        p, _ = await pnl_guard(user, "All")
        data, actuals, cfg = await load_all()
        await format_guard("regional_pnl", cfg, p)
        cfg = mis_cfg(cfg)
        payroll_ok = payroll_visible(p)
        out = mis.regional_pnl(data, actuals, cfg, payroll_ok)
        out["meta"] = {"base_fy": cfg["base_fy"], "plan_fy": cfg["plan_fy"], "draft_fy": cfg["draft_fy"], "cutoffs": cfg["cutoffs"]}
        return out

    # ------------------------------------------------------------------ MIS drill-down formats
    async def fmt_ctx(user: dict, key: str, section: str = "aop_pnl", allow_tags: bool = False):
        p = await perms_for(user)
        sections = mis.format_sections(key) if any(f["key"] == key for f in mis.FORMATS) else [section]
        if not (p["admin"] or any(p["sections"][x]["can_view"] for x in sections)):
            raise HTTPException(403, "You don't have access to this report")
        if p["tags"] and not allow_tags:
            raise HTTPException(403, "This report covers all entities — your role is limited to specific airports")
        data, actuals, cfg = await load_all()
        await format_guard(key, cfg, p)
        return p, data, actuals, mis_cfg(cfg), payroll_visible(p)

    @r.get("/mis/airport-gm")
    async def mis_airport_gm(user: dict = Depends(get_current_user)):
        p, data, actuals, cfg, pv = await fmt_ctx(user, "airport_gm", allow_tags=True)
        out = mr.airport_gm(data, actuals, cfg, pv)
        if p["tags"]:  # restricted roles see their airports only
            allowed = {norm(t) for t in p["tags"]}
            keep = [c["key"] for c in out["columns"] if norm(c["key"]) in allowed]
            out["columns"] = [c for c in out["columns"] if c["key"] in keep]
            for row in out["rows"]:
                if row.get("values"):
                    row["values"] = {k: v for k, v in row["values"].items() if k in keep}
        return out

    @r.get("/mis/cute")
    async def mis_cute(tag: str = "All", user: dict = Depends(get_current_user)):
        p, data, actuals, cfg, _ = await fmt_ctx(user, "cute_analysis", allow_tags=True)
        if p["tags"] and norm(tag) not in {norm(t) for t in p["tags"]}:
            tag = p["tags"][0]
        return mr.cute_analysis(data, actuals, cfg, Filters(tag=tag))

    @r.get("/mis/opex")
    async def mis_opex(user: dict = Depends(get_current_user)):
        _, data, actuals, cfg, _ = await fmt_ctx(user, "opex_analysis")
        return mr.opex_analysis(data, actuals, cfg)

    def scoped(p: Dict[str, Any], data: Dict[str, Any], actuals: List[Dict[str, Any]], domain: str, datasets: List[str]):
        """Department-scoped roles: keep only their departments' plan lines and actuals of this domain."""
        sc = p.get("departments")
        if sc is None:
            return data, actuals, None
        data = {**data, **{ds: [f for f in data.get(ds, []) if dept_scope.row_allowed(sc, ds, f)] for ds in datasets}}
        actuals = [a for a in actuals if a.get("domain") != domain or dept_scope.actual_allowed(sc, a)]
        return data, actuals, sc

    def dept_guard(p: Dict[str, Any], dept: str):
        if not dept_scope.allowed(p.get("departments"), dept):
            raise HTTPException(403, "Your role shows your own department's figures only")

    @r.get("/mis/resources")
    async def mis_resources(user: dict = Depends(get_current_user)):
        p, data, _, cfg, pv = await fmt_ctx(user, "resources")
        plan_m = fy_months(cfg["plan_fy"])
        res_act = [a async for a in db.aop_actuals.find({"domain": "payroll", "period": {"$in": plan_m}},
                                                        {"_id": 0, "domain": 1, "period": 1, "amount": 1, "dims": 1, "qty": 1})]
        data, res_act, sc = scoped(p, data, res_act, "payroll", ["payroll_lines"])
        # department-scoped roles with payroll access see their own departments' cost
        own = sc is not None and (p["sections"]["aop_payroll"]["can_view"])
        out = mr.resources(data, None, res_act, cfg, pv or own)
        out["departments"] = sc
        return out

    @r.get("/mis/overheads")
    async def mis_overheads(user: dict = Depends(get_current_user)):
        p, data, actuals, cfg, _ = await fmt_ctx(user, "overheads_summary")
        data, actuals, sc = scoped(p, data, actuals, "overhead", ["overhead_lines"])
        return {**mr.overheads_summary(data, actuals, cfg), "departments": sc}

    @r.get("/mis/overheads/nature")
    async def mis_overheads_nature(dept: str, user: dict = Depends(get_current_user)):
        p, data, actuals, cfg, _ = await fmt_ctx(user, "overheads_nature")
        dept_guard(p, dept)
        return mr.overheads_nature(data, actuals, cfg, dept)

    @r.get("/mis/overheads/lines")
    async def mis_overheads_lines(dept: str, nature: Optional[str] = None, user: dict = Depends(get_current_user)):
        p, data, _, cfg, _ = await fmt_ctx(user, "overheads_lines")
        dept_guard(p, dept)
        q: Dict[str, Any] = {"domain": "overhead", "period": {"$in": fy_months(cfg["plan_fy"])}, "dims.pl_tag": dept}
        bookings = [a async for a in db.aop_actuals.find(q, {"_id": 0}).limit(20000)]
        if nature:  # natures match case-insensitively (SAP and AOP spell them differently)
            bookings = [a for a in bookings if norm((a.get("dims") or {}).get("nature")) == norm(nature)]
        return mr.overheads_lines(data, bookings, cfg, dept, nature)

    @r.get("/mis/overheads/departments")
    async def mis_overhead_depts(user: dict = Depends(get_current_user)):
        p, data, actuals, _, _ = await fmt_ctx(user, "overheads_summary")
        data, actuals, _ = scoped(p, data, actuals, "overhead", ["overhead_lines"])
        depts = {r.get("pl_tag") for r in data.get("overhead_lines", []) if r.get("pl_tag")}
        natures: Dict[str, set] = {}
        for r in data.get("overhead_lines", []):
            natures.setdefault(r.get("pl_tag") or "Others", set()).add(r.get("final_tag") or "Others")
        for a in actuals:
            d = a.get("dims") or {}
            if a["domain"] == "overhead" and d.get("pl_tag"):
                depts.add(d["pl_tag"])
                natures.setdefault(d["pl_tag"], set()).add(d.get("nature") or "Others")
        return {"departments": sorted(depts), "natures": {k: sorted(v) for k, v in natures.items()}}

    @r.get("/mis/project-health")
    async def mis_project_health(user: dict = Depends(get_current_user)):
        _, data, actuals, cfg, pv = await fmt_ctx(user, "project_health", "aop_reports")
        return mr.project_health(data, actuals, cfg, pv)

    @r.get("/mis/capex-tracker")
    async def mis_capex_tracker(user: dict = Depends(get_current_user)):
        _, data, actuals, cfg, _ = await fmt_ctx(user, "capex_tracker", "aop_reports")
        cap = [a async for a in db.aop_actuals.find({"domain": {"$in": ["capex", "capex_sap"]},
                                                     "period": {"$in": fy_months(cfg["plan_fy"])}},
                                                    {"_id": 0, "domain": 1, "period": 1, "amount": 1, "dims": 1})]
        return mr.capex_tracker(data, cap, cfg)

    # ------------------------------------------------------------------ next-year draft
    @r.get("/plan/drivers")
    async def plan_drivers(user: dict = Depends(get_current_user)):
        data, _, cfg = await load_all()
        base = default_drivers(data.get("assumptions", []))
        return {"defaults": base, "drivers": {**base, **(cfg.get("drivers") or {})},
                "source_fy": cfg["plan_fy"], "target_fy": cfg.get("draft_fy") or shift_fy(cfg["plan_fy"], 1)}

    @r.post("/plan/generate")
    async def plan_generate(payload: Dict[str, Any] = Body(default={}), user: dict = Depends(get_current_user)):
        """Seed the next-year (draft) budget from the current year's A/F and the drivers."""
        require_admin(user)
        data, actuals_light, cfg = await load_all()
        src, tgt = cfg["plan_fy"], cfg.get("draft_fy") or shift_fy(cfg["plan_fy"], 1)
        drivers = {**default_drivers(data.get("assumptions", [])), **(cfg.get("drivers") or {}), **(payload.get("drivers") or {})}
        overwrite = bool(payload.get("overwrite"))
        dsets = ["rev_cute", "rev_noncute", "rev_projects", "project_master", "opex_lines", "payroll_lines", "pl_other",
                 "overhead_lines", "overhead_plan"]
        rows: Dict[str, List] = {}
        async for d in db.aop_rows.find({"dataset": {"$in": dsets}}, {"_id": 0, "dataset": 1, "key": 1, "fields": 1}).sort("seq", 1):
            rows.setdefault(d["dataset"], []).append((d["key"], d.get("fields") or {}))
        ledger = [a async for a in db.aop_actuals.find({"domain": "overhead", "entry_type": "ledger"},
                                                       {"_id": 0, "domain": 1, "period": 1, "amount": 1, "dims": 1, "entry_type": 1, "expense_head": 1})]
        draft = build_draft(rows, ledger, src, tgt, drivers, overwrite)
        T = "B" + tgt[2:]
        for ds, upd in draft.updates.items():
            for key, fields in upd.items():
                await db.aop_rows.update_one({"dataset": ds, "key": key},
                                             {"$set": {**{f"fields.{k}": v for k, v in fields.items()}, "updated_at": now_iso(),
                                                       "updated_by": user.get("email")}})
        for ds, new in draft.new_rows.items():
            if ds == "overhead_plan" and overwrite:
                await db.aop_rows.delete_many({"dataset": ds})
            spec = SPECS[ds]
            seq = await db.aop_rows.count_documents({"dataset": ds})
            docs = []
            for i, f in enumerate(new, start=1):
                if spec.auto_prefix:
                    f["line_id"] = f"{spec.auto_prefix}-{tgt}-{i:05d}"
                docs.append({"dataset": ds, "key": build_key(spec, f), "seq": seq + i, "fields": f,
                             "updated_at": now_iso(), "updated_by": user.get("email")})
            if docs:
                await db.aop_rows.insert_many(docs)
        # make the new budget columns visible (and user-editable) in every touched dataset
        for ds in set(draft.updates) | set(draft.new_rows):
            cols = await columns_for(ds)
            have = {c["key"] for c in cols}
            add = [column(f"{T}__{q}", f"{T} {q}", "number", editable=True, group=T) for q in fy_months(tgt) if f"{T}__{q}" not in have]
            if ds == "project_master" and f"tp_cost_b{tgt[2:]}" not in have:
                add = [column(f"tp_cost_b{tgt[2:]}", f"TP cost B {tgt}", "number", editable=True, group=T)]
            if ds == "overhead_plan" and not cols:
                add = [column("line_id", "Line ID"), column("cost_centre", "Cost centre"), column("gl", "GL"),
                       column("department", "Department (P&L)", editable=True), column("geo", "Geo", editable=True),
                       column("aop_head", "AOP head", editable=True), column("description", "Description", editable=True),
                       column("basis", "Basis"), column(f"annual_{T.lower()}", f"{T} annual", "number", editable=True)] + add
            if add:
                await db.aop_dataset_meta.update_one({"dataset": ds}, {"$set": {"columns": cols + add, "updated_at": now_iso()}}, upsert=True)
        await db.aop_config.update_one({"id": "aop"}, {"$set": {"drivers": drivers, "draft_generated_at": now_iso()}}, upsert=True)
        await bump_version()
        await write_audit(db, entity_type="aop_plan", entity_id=tgt, action="generate", user=user,
                          field_changes={"drivers": drivers, "overwrite": overwrite, "counts": dict(draft.counts)})
        return {"source_fy": src, "target_fy": tgt, "drivers": drivers, "counts": dict(draft.counts)}

    # ------------------------------------------------------------------ capex summary
    @r.get("/capex/summary")
    async def capex_summary(user: dict = Depends(get_current_user)):
        """Per location: A base · B plan · spend till date (plan FY, capex GRNs) · plan A/F · B draft ask."""
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_capex"]["can_view"]):
            raise HTTPException(403, "Not allowed")
        cfg = await get_config()
        base, plan = cfg["base_fy"], cfg["plan_fy"]
        draft = cfg.get("draft_fy") or shift_fy(plan, 1)
        hist = {norm(d["fields"].get("location")): d["fields"] async for d in db.aop_rows.find({"dataset": "capex_history"}, {"_id": 0, "fields": 1})}
        lines = [d["fields"] async for d in db.aop_rows.find({"dataset": "capex_lines"}, {"_id": 0, "fields": 1})]
        plan_months = set(fy_months(plan))
        spend: Dict[str, float] = {}
        last = None
        async for a in db.aop_actuals.find({"domain": "capex"}, {"_id": 0, "period": 1, "amount": 1, "dims": 1}):
            if a["period"] in plan_months:
                t = norm((a.get("dims") or {}).get("tag")) or "unmapped"
                spend[t] = spend.get(t, 0.0) + float(a["amount"] or 0)
                last = max(last or a["period"], a["period"])
        agg: Dict[str, Dict[str, Any]] = {}
        for f in lines:
            t = str(f.get("tag") or "Unmapped")
            if norm(t) == "remove":
                continue
            e = agg.setdefault(norm(t), {"location": t, "b_plan": 0.0, "b_draft": 0.0, "lines": 0})
            e["b_plan"] += float(f.get("total") or 0)
            e["b_draft"] += float(f.get("b_next_total") or 0)
            e["lines"] += 1
        for k, h in hist.items():
            if not h.get("parent"):
                agg.setdefault(k, {"location": h.get("location"), "b_plan": 0.0, "b_draft": 0.0, "lines": 0})
        for k in spend:
            agg.setdefault(k, {"location": k.upper() if k in ("dial", "ghial", "ggial", "gvial") else k, "b_plan": 0.0, "b_draft": 0.0, "lines": 0})
        out = []
        for k, e in agg.items():
            h = hist.get(k, {})
            sp = spend.get(k, 0.0)
            fc_override = h.get("fy_forecast_override")
            e.update({
                "a_base": h.get("fy26_actuals") if base == "FY26" else h.get(f"{base.lower()}_actuals"),
                "b_base": h.get("fy26_budget") if base == "FY26" else None,
                "spend_td": sp,
                "af_plan": float(fc_override) if isinstance(fc_override, (int, float)) else max(sp, e["b_plan"]),
                "balance": e["b_plan"] - sp,
                "utilisation": (sp / e["b_plan"]) if e["b_plan"] else None,
                "children": [c.get("location") for c in hist.values() if norm(c.get("parent")) == k],
            })
            out.append(e)
        out.sort(key=lambda x: -(x["b_plan"] or 0))
        return {"rows": out, "meta": {"base_fy": base, "plan_fy": plan, "draft_fy": draft, "spend_till": last,
                                      "af_rule": "spend till date + remaining budget (override per location in Capex history)"}}

    # ------------------------------------------------------------------ reports
    async def reports_guard(user):
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_reports"]["can_view"]):
            raise HTTPException(403, "You don't have access to AOP reports")
        return p

    @r.get("/reports/margin")
    async def report_margin(block: str = Query("af_plan", pattern="^(a_base|b_plan|af_plan|b_draft)$"),
                            user: dict = Depends(get_current_user)):
        p = await reports_guard(user)
        data, actuals, cfg = await load_all()
        tags = rep.tags_for_margin(data)
        if p["tags"]:
            tags = [t for t in tags if norm(t) in {norm(x) for x in p["tags"]}]
        payroll_ok = payroll_visible(p)
        return rep.margin_profile(data, actuals, cfg, block, tags, payroll_ok)

    @r.get("/reports/opex")
    async def report_opex(group_by: str = Query("aop_code", pattern="^(aop_code|vendor|category|tag|recurring|package_l1)$"),
                          user: dict = Depends(get_current_user)):
        await reports_guard(user)
        cfg = await get_config()
        tracker = [d["fields"] async for d in db.aop_rows.find({"dataset": "opex_tracker"}, {"_id": 0, "fields": 1})]
        out = rep.opex_forecast(tracker, cfg["plan_fy"], group_by)
        out["plan_fy"] = cfg["plan_fy"]
        return out

    @r.get("/reports/overheads")
    async def report_overheads(user: dict = Depends(get_current_user)):
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_reports"]["can_view"] or p["sections"]["aop_overheads"]["can_view"]):
            raise HTTPException(403, "You don't have access to AOP reports")
        data, _, cfg = await load_all()
        actuals = [a async for a in db.aop_actuals.find({"domain": "overhead"}, {"_id": 0, "domain": 1, "period": 1, "amount": 1, "dims": 1})]
        data, actuals, _ = scoped(p, data, actuals, "overhead", ["overhead_lines", "overhead_plan"])
        out = rep.overheads_by_department(data, actuals, cfg)
        out.update(base_fy=cfg["base_fy"], plan_fy=cfg["plan_fy"], draft_fy=cfg.get("draft_fy"))
        return out

    @r.get("/reports/wbs")
    async def report_wbs(user: dict = Depends(get_current_user)):
        await reports_guard(user)
        data, _, cfg = await load_all()
        actuals = [a async for a in db.aop_actuals.find({"domain": {"$in": ["opex", "overhead", "capex"]}},
                                                         {"_id": 0, "domain": 1, "amount": 1, "dims.wbs": 1})]
        master = await db.wbs_elements.find({}, {"_id": 0}).to_list(50000)
        out = rep.wbs_report(data, actuals, cfg, master)
        out.update(base_fy=cfg["base_fy"], plan_fy=cfg["plan_fy"], draft_fy=cfg.get("draft_fy"))
        return out

    # ------------------------------------------------------------------ approvals of user edits
    @r.get("/changes")
    async def changes(status: str = "pending", user: dict = Depends(get_current_user)):
        q: Dict[str, Any] = {"status": status}
        if user.get("role") != "admin":
            q["requested_by"] = user.get("email")
        return [d async for d in db.aop_changes.find(q, {"_id": 0}).sort("created_at", -1).limit(1000)]

    @r.post("/changes/decide")
    async def decide(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        ids = payload.get("ids") or []
        approve = bool(payload.get("approve"))
        comment = payload.get("comment") or ""
        done = 0
        changed: Dict[str, List[tuple]] = {}
        async for c in db.aop_changes.find({"id": {"$in": ids}, "status": "pending"}, {"_id": 0}):
            if approve:
                await db.aop_rows.update_one({"dataset": c["dataset"], "key": c["key"]},
                                             {"$set": {f"fields.{c['field']}": c["new"], "updated_at": now_iso(),
                                                       "updated_by": c.get("requested_by")}})
                await db.aop_history.insert_one({"dataset": c["dataset"], "key": c["key"], "field": c["field"], "old": c.get("old"),
                                                 "new": c["new"], "by": c.get("requested_by"), "approved_by": user.get("email"), "at": now_iso()})
                changed.setdefault(c["dataset"], []).append((c["key"], c["field"]))
            await db.aop_changes.update_one({"id": c["id"]}, {"$set": {"status": "approved" if approve else "rejected",
                                                                       "decided_by": user.get("email"), "decided_at": now_iso(),
                                                                       "comment": comment}})
            done += 1
        for ds, ch in changed.items():
            await after_edit(ds, ch)
        if approve and done:
            await bump_version()
        await write_audit(db, entity_type="aop_changes", entity_id="batch", action="approve" if approve else "reject", user=user,
                          field_changes={"count": done})
        return {"decided": done}

    @r.get("/history/{dataset}/{key}")
    async def history(dataset: str, key: str, user: dict = Depends(get_current_user)):
        ensure_ds(dataset)
        if not await can(user, dataset):
            raise HTTPException(403, "Not allowed")
        return [d async for d in db.aop_history.find({"dataset": dataset, "key": key}, {"_id": 0}).sort("at", -1).limit(200)]

    # Review (To map, PO changes, Corrections, Checks, Upload log), PO / line history drawers, add-ons
    register_review(r, SimpleNamespace(db=db, engine=engine, get_current_user=get_current_user, perms_for=perms_for,
                                       get_config=get_config, write_audit=write_audit, bump_version=bump_version,
                                       recalc_tracker=recalc_tracker, storage=storage, notify_run=notify_run))
    return r

