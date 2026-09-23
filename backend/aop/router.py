"""AOP API (mounted under /api/aop).

Access model (re-uses the existing roles system — no new role concept):
  * system role ``admin`` → admin portal: imports, uploads/downloads, column management, approvals, config
  * everyone else → workspace sections ``aop_*`` from their role (can_view / can_edit)
  * ``aop_payroll`` is confidential: without it, payroll datasets are hidden and resource-cost lines
    in the P&L are masked
  * a role's ``aop_tags`` (optional) restricts the reporting tags / airports a user's P&L can show
  * user edits touch only columns an admin marked ``user_editable``; when the section's edit mode is
    ``approval`` they are queued in ``aop_changes`` for an admin decision instead of being applied
"""
from __future__ import annotations

import csv
import io
import os
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
import openpyxl

from .datasets import ACTUALS, AOP_SECTIONS, SPECS, build_key, coerce, column, norm, slug
from .importer import Result, import_aop_workbook, import_opex_workbook
from .periods import shift_fy
from .pnl import Filters, PnLEngine

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
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_router(db, get_current_user, write_audit, gen_id) -> APIRouter:
    r = APIRouter(prefix="/aop", tags=["aop"])
    cache: Dict[str, Any] = {"version": None, "data": None, "actuals": None}

    # ------------------------------------------------------------------ access
    async def perms_for(user: dict) -> Dict[str, Any]:
        if user.get("role") == "admin":
            return {"admin": True, "sections": {s: {"can_view": True, "can_edit": True} for s in AOP_SECTIONS}, "tags": []}
        sections = {s: {"can_view": False, "can_edit": False} for s in AOP_SECTIONS}
        tags: List[str] = []
        if user.get("role_id"):
            role = await db.roles.find_one({"id": user["role_id"]}, {"_id": 0})
            if role:
                for s, p in (role.get("permissions") or {}).items():
                    if s in sections:
                        sections[s] = {"can_view": bool(p.get("can_view")), "can_edit": bool(p.get("can_edit"))}
                tags = [t for t in (role.get("aop_tags") or []) if t]
        return {"admin": False, "sections": sections, "tags": tags}

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
        return bool(sp.get("can_view" if action == "view" else "can_edit"))

    async def get_config() -> Dict[str, Any]:
        cfg = await db.aop_config.find_one({"id": "aop"}, {"_id": 0})
        if not cfg:
            cfg = dict(DEFAULT_CONFIG)
            await db.aop_config.insert_one(dict(cfg))
            cfg.pop("_id", None)
        for k, v in DEFAULT_CONFIG.items():
            cfg.setdefault(k, v)
        return cfg

    async def bump_version():
        await db.aop_config.update_one({"id": "aop"}, {"$inc": {"data_version": 1}}, upsert=True)

    async def load_all():
        cfg = await get_config()
        if cache["version"] == cfg.get("data_version") and cache["data"] is not None:
            return cache["data"], cache["actuals"], cfg
        data: Dict[str, List[Dict[str, Any]]] = {}
        needed = ["rev_cute", "rev_noncute", "rev_projects", "project_master", "opex_lines", "payroll_lines",
                  "overhead_lines", "assumptions", "pl_other", "pl_snapshot"]
        async for d in db.aop_rows.find({"dataset": {"$in": needed}}, {"_id": 0, "dataset": 1, "fields": 1}):
            data.setdefault(d["dataset"], []).append(d.get("fields") or {})
        actuals = [a async for a in db.aop_actuals.find({}, {"_id": 0, "domain": 1, "period": 1, "amount": 1, "dims": 1})]
        cache.update(version=cfg.get("data_version"), data=data, actuals=actuals)
        return data, actuals, cfg

    async def columns_for(dataset: str) -> List[Dict[str, Any]]:
        if dataset == ACTUALS:
            meta = await db.aop_dataset_meta.find_one({"dataset": ACTUALS}, {"_id": 0})
            return (meta or {}).get("columns") or ACTUAL_COLUMNS
        meta = await db.aop_dataset_meta.find_one({"dataset": dataset}, {"_id": 0})
        return (meta or {}).get("columns") or []

    def ensure_ds(dataset: str):
        if dataset != ACTUALS and dataset not in SPECS:
            raise HTTPException(404, f"Unknown dataset {dataset}")

    # ------------------------------------------------------------------ config & catalogue
    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        cfg = await get_config()
        p = await perms_for(user)
        return {**cfg, "permissions": p}

    @r.put("/config")
    async def update_config(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        require_admin(user)
        allowed = {"base_fy", "plan_fy", "draft_fy", "cutoffs", "tax_rate", "edit_modes"}
        upd = {k: v for k, v in payload.items() if k in allowed}
        if "edit_modes" in upd:
            upd["edit_modes"] = {k: ("approval" if v == "approval" else "direct") for k, v in upd["edit_modes"].items() if k in AOP_SECTIONS}
        await db.aop_config.update_one({"id": "aop"}, {"$set": upd}, upsert=True)
        await bump_version()
        await write_audit(db, entity_type="aop_config", entity_id="aop", action="update", user=user, field_changes=upd)
        return await get_config()

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
                        "columns": len(m.get("columns") or []), "updated_at": m.get("updated_at")})
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
        return await columns_for(dataset)

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
                   filter_field: Optional[str] = None, filter_value: Optional[str] = None,
                   user: dict = Depends(get_current_user)):
        ensure_ds(dataset)
        if not await can(user, dataset):
            raise HTTPException(403, "Not allowed")
        filters = {filter_field: filter_value} if filter_field else {}
        mq = match_query(dataset, q, filters)
        p = await perms_for(user)
        if dataset == ACTUALS:
            total = await db.aop_actuals.count_documents(mq)
            docs = [d async for d in db.aop_actuals.find(mq, {"_id": 0}).sort([("domain", 1), ("period", 1)]).skip(offset).limit(limit)]
            return {"total": total, "rows": [{"key": d.get("uid"), "fields": d} for d in docs]}
        if not p["admin"] and p["tags"]:
            mq["$and"] = [{"$or": [{"fields.tag": {"$in": p["tags"]}}, {"fields.tag": {"$exists": False}}]}]
        total = await db.aop_rows.count_documents(mq)
        docs = [d async for d in db.aop_rows.find(mq, {"_id": 0, "key": 1, "fields": 1, "updated_at": 1, "updated_by": 1})
                .sort("seq", 1).skip(offset).limit(limit)]
        pending = {}
        if docs:
            async for c in db.aop_changes.find({"dataset": dataset, "status": "pending", "key": {"$in": [d["key"] for d in docs]}},
                                               {"_id": 0, "key": 1, "field": 1, "new": 1, "id": 1}):
                pending.setdefault(c["key"], {})[c["field"]] = {"value": c["new"], "id": c["id"]}
        for d in docs:
            if d["key"] in pending:
                d["pending"] = pending[d["key"]]
        return {"total": total, "rows": docs}

    @r.patch("/datasets/{dataset}/rows")
    async def edit_cells(dataset: str, edits: List[Dict[str, Any]] = Body(...), user: dict = Depends(get_current_user)):
        """Batch cell edits ``[{key, field, value}]`` — from the grid, including multi-cell paste from Excel."""
        ensure_ds(dataset)
        if dataset == ACTUALS:
            require_admin(user)
        p = await perms_for(user)
        if not await can(user, dataset, "edit"):
            raise HTTPException(403, "You don't have edit rights on this section")
        cols = {c["key"]: c for c in await columns_for(dataset)}
        cfg = await get_config()
        spec = SPECS.get(dataset)
        mode = "direct" if p["admin"] else cfg["edit_modes"].get(spec.section if spec else "", "approval")
        applied, queued, rejected = 0, 0, []
        for e in edits[:5000]:
            key, fld = str(e.get("key") or ""), str(e.get("field") or "")
            col = cols.get(fld)
            if not col:
                rejected.append({"key": key, "field": fld, "reason": "unknown column"}); continue
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
                applied += 1
        if applied:
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
    async def upsert_rows(dataset: str, incoming: List[Dict[str, Any]], mode: str, user: dict) -> Dict[str, Any]:
        spec = SPECS[dataset]
        cols = {c["key"]: c for c in await columns_for(dataset)}
        existing = {d["key"]: d for d in [x async for x in db.aop_rows.find({"dataset": dataset}, {"_id": 0, "key": 1, "seq": 1})]}
        if mode == "replace":
            await db.aop_rows.delete_many({"dataset": dataset})
            existing = {}
        seq = max([d.get("seq") or 0 for d in existing.values()] + [0])
        added = updated = skipped = 0
        errors: List[Dict[str, Any]] = []
        auto_n = 0
        seen = set()
        new_docs = []
        for i, raw in enumerate(incoming, start=2):
            fields = {}
            for k, v in raw.items():
                if k in ("key", "_key"):
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
            if key in existing:
                if mode == "add":
                    skipped += 1; continue
                await db.aop_rows.update_one({"dataset": dataset, "key": key},
                                             {"$set": {**{f"fields.{k}": v for k, v in fields.items()},
                                                       "updated_at": now_iso(), "updated_by": user.get("email")}})
                updated += 1
            else:
                if mode == "modify":
                    skipped += 1; continue
                seq += 1
                new_docs.append({"dataset": dataset, "key": key, "seq": seq, "fields": fields,
                                 "updated_at": now_iso(), "updated_by": user.get("email")})
                added += 1
        if new_docs:
            for j in range(0, len(new_docs), 1000):
                await db.aop_rows.insert_many(new_docs[j:j + 1000])
        # unseen columns in an upload are appended to the column list (admins can tidy them later)
        unknown = sorted({k for raw in incoming for k in raw if k not in cols and k not in ("key", "_key")})
        if unknown:
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
        require_admin(user)
        ensure_ds(dataset)
        content = await file.read()
        cols = await columns_for(dataset)
        incoming = read_table(content, file.filename or "upload.csv", cols)
        if dataset == ACTUALS:
            return await upsert_actuals(incoming, mode, user)
        return await upsert_rows(dataset, incoming, mode, user)

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
        require_admin(user)
        ensure_ds(dataset)
        cols = [c for c in await columns_for(dataset)]
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
                async for d in db.aop_rows.find({"dataset": dataset}, {"_id": 0, "fields": 1}).sort("seq", 1):
                    f = d.get("fields") or {}
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

    # ------------------------------------------------------------------ workbook import (admin)
    async def write_result(res: Result, user: dict, replace_actual_domains: Optional[List[str]] = None):
        for ds, payload in res.datasets.items():
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
            os.unlink(path)
        await write_result(res, user)
        await bump_version()
        await db.aop_imports.insert_one({"id": gen_id(), "kind": "opex", "file": file.filename, "at": now_iso(), "by": user.get("email"),
                                         "meta": res.meta, "warnings": res.warnings,
                                         "counts": {k: len(v["rows"]) for k, v in res.datasets.items()}})
        return {"meta": res.meta, "warnings": res.warnings, "counts": {k: len(v["rows"]) for k, v in res.datasets.items()}}

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

    @r.get("/pnl")
    async def pnl(geo: str = "All", tag: str = "All", exclude: Optional[str] = None, user: dict = Depends(get_current_user)):
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_pnl"]["can_view"]):
            raise HTTPException(403, "You don't have access to the P&L")
        if p["tags"] and (norm(tag) == "all" or norm(tag) not in {norm(x) for x in p["tags"]}):
            if norm(tag) == "all" and len(p["tags"]) == 1:
                tag = p["tags"][0]
            else:
                raise HTTPException(403, "Select one of your permitted airports / entities")
        data, actuals, cfg = await load_all()
        eng = PnLEngine(data, actuals, cfg["base_fy"], cfg["plan_fy"], cfg["cutoffs"], cfg.get("tax_rate", 0.25))
        out = eng.compute(Filters(geo, tag, [x for x in (exclude or "").split(",") if x]))
        payroll_ok = p["admin"] or p["sections"]["aop_payroll"]["can_view"]
        if not payroll_ok:
            for row in out["rows"]:
                if row["sensitive"]:
                    row["values"] = None
                    row["masked"] = True
        out["meta"]["payroll_visible"] = payroll_ok
        out["meta"]["filters"] = {"geo": geo, "tag": tag, "exclude": exclude}
        return out

    # ------------------------------------------------------------------ PO drill-down
    @r.get("/po/{po}")
    async def po_detail(po: str, user: dict = Depends(get_current_user)):
        p = await perms_for(user)
        if not (p["admin"] or p["sections"]["aop_opex"]["can_view"]):
            raise HTTPException(403, "Not allowed")
        po = po.strip()
        items = [d["fields"] async for d in db.aop_rows.find({"dataset": "po_register", "fields.purchase_order": po}, {"_id": 0, "fields": 1})]
        import re as _re
        rx = {"$regex": f"(^|[^0-9]){_re.escape(po)}([^0-9]|$)"}
        tracker = [d["fields"] async for d in db.aop_rows.find(
            {"dataset": "opex_tracker", "$or": [{"fields.old_po": po}, {"fields.new_po": po}, {"fields.po_ref": po},
                                                {"fields.mapped_new_pos": rx}]}, {"_id": 0, "fields": 1})]
        lines = [d["fields"] async for d in db.aop_rows.find({"dataset": "opex_lines", "fields.po": {"$in": [po, _maybe_int(po)]}},
                                                              {"_id": 0, "fields": 1})]
        head = items[0] if items else {}
        summary = {
            "purchase_order": po, "supplier": head.get("supplier_name"), "supplier_code": head.get("supplier"),
            "created_on": head.get("created_on"), "currency": head.get("currency"),
            "po_value": sum(_num(i.get("final_value")) for i in items),
            "grn_amount": sum(_num(i.get("gr_amount_in_lc")) for i in items),
            "pending_grn": sum(_num(i.get("pending_gr_amount_in_lc")) for i in items),
            "invoiced": sum(_num(i.get("invoiced_value_base_value")) for i in items),
            "wbs": sorted({str(i.get("wbs_element")) for i in items if i.get("wbs_element")}),
            "items": len({i.get("purchase_order_item") for i in items}),
        }
        return {"summary": summary, "items": items, "tracker": tracker, "opex_lines": lines}

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
        async for c in db.aop_changes.find({"id": {"$in": ids}, "status": "pending"}, {"_id": 0}):
            if approve:
                await db.aop_rows.update_one({"dataset": c["dataset"], "key": c["key"]},
                                             {"$set": {f"fields.{c['field']}": c["new"], "updated_at": now_iso(),
                                                       "updated_by": c.get("requested_by")}})
                await db.aop_history.insert_one({"dataset": c["dataset"], "key": c["key"], "field": c["field"], "old": c.get("old"),
                                                 "new": c["new"], "by": c.get("requested_by"), "approved_by": user.get("email"), "at": now_iso()})
            await db.aop_changes.update_one({"id": c["id"]}, {"$set": {"status": "approved" if approve else "rejected",
                                                                       "decided_by": user.get("email"), "decided_at": now_iso(),
                                                                       "comment": comment}})
            done += 1
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

    return r


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _maybe_int(s: str):
    try:
        return int(s)
    except ValueError:
        return s
