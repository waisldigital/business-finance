"""Review — all human work on POs in one place (mounted on the AOP router).

Tabs: To map (new PO items needing a type and destination), PO changes (flagged changes on mapped items),
Corrections (POs to fix in SAP), Checks (non-blocking data checks), Upload log (every ZMM run).
Plus the PO drawer, the line history drawer, add-on lines, re-splitting allocations and a full recalculation.

Writes go through write_audit and follow the destination section's edit right (Opex → aop_opex, Overheads →
aop_overheads, Capex → aop_capex); everything else needs edit on aop_opex or aop_review.
"""
from __future__ import annotations

import io
from collections import defaultdict
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from . import po as P
from .datasets import vkey
from .opex_schema import COPY_TO_ADDON, MAPPING_STATUSES, ZMM_KEYS, validate
from .periods import fy_months

DEST_SECTION = {"Opex": "aop_opex", "Overheads": "aop_overheads", "Capex": "aop_capex", "Payroll": "aop_payroll"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def register_review(r, ctx: SimpleNamespace):
    """``ctx``: db, engine, get_current_user, perms_for, get_config, write_audit, bump_version, recalc_tracker,
    storage, notify_run."""
    db, engine = ctx.db, ctx.engine
    get_current_user = ctx.get_current_user

    # ------------------------------------------------------------------ access
    async def review_access(user: dict, action: str = "view", section: Optional[str] = None) -> Dict[str, Any]:
        p = await ctx.perms_for(user)
        if p["admin"]:
            return p
        secs = p["sections"]
        if section:
            ok = secs.get(section, {}).get("can_edit")
        elif action == "view":
            ok = secs["aop_opex"]["can_edit"] or secs.get("aop_review", {}).get("can_view")
        else:
            ok = secs["aop_opex"]["can_edit"] or secs.get("aop_review", {}).get("can_edit")
        if not ok:
            raise HTTPException(403, "Review needs edit rights on Opex (or the Review section)")
        return p

    async def audit(user, entity, action, changes):
        await ctx.write_audit(db, entity_type=entity, entity_id="review", action=action, user=user, field_changes=changes)

    async def next_correction_id() -> str:
        last = [d["key"] async for d in db.aop_rows.find({"dataset": "po_corrections"}, {"_id": 0, "key": 1})]
        n = max([int(k.split("-")[-1]) for k in last if k.split("-")[-1].isdigit()] + [0]) + 1
        return f"COR-{n:05d}"

    async def create_correction(po: str, items: List[str], ctype: str, remarks: str, user: dict, source: str,
                                override: Optional[Dict[str, Any]] = None) -> str:
        cid = await next_correction_id()
        raw = await engine.fields("po_items", {"fields.po": po})
        its = items or [v.get("item") for v in raw.values()]
        first = next(iter(raw.values()), {})
        snapshot = {}
        for f in P.CORRECTION_FIELDS.get(ctype, []):
            snapshot[f] = first.get(f"latest_{f}", first.get(f))
        await engine.bulk_set("po_corrections", {cid: {
            "line_id": cid, "po": po, "items": its, "supplier": first.get("supplier_name"), "type": ctype,
            "remarks": remarks, "status": "Open", "source": source, "override": override or None, "snapshot": snapshot,
            "created_at": now_iso(), "created_by": user.get("email")}}, upsert=True, by=user.get("email"))
        return cid

    # ------------------------------------------------------------------ summary
    @r.get("/review/summary")
    async def summary(user: dict = Depends(get_current_user)):
        await review_access(user)
        to_map = await to_map_list(limit=None, counts_only=True)
        changes = await engine.fields("po_changes", {"fields.status": "Open"})
        cors = [c for c in (await engine.fields("po_corrections")).values() if c.get("status") != "Resolved"]
        checks = [c for c in await build_checks() if not c.get("acknowledged")]
        impact = sum(_num(v) for v in {c.get("po"): c.get("fy_impact") for c in changes.values()}.values())  # one per PO
        last = await db.aop_rows.find_one({"dataset": "zmm_runs"}, {"_id": 0, "fields": 1}, sort=[("fields.received_at", -1)])
        out = {"to_map": to_map["pos"], "to_map_items": to_map["items"], "changes": len(changes),
               "pending_fy_impact": round(impact, 2), "corrections": len(cors), "checks": len(checks),
               "last_run": {k: v for k, v in ((last or {}).get("fields") or {}).items() if k != "header"}}
        out["badge"] = out["to_map"] + out["changes"] + out["corrections"] + out["checks"]
        return out

    # ------------------------------------------------------------------ To map
    async def to_map_list(limit: Optional[int] = 500, counts_only: bool = False, q: Optional[str] = None):
        items = await engine.fields("po_items")
        triage = await engine.fields("po_triage")
        by_po: Dict[str, List[str]] = defaultdict(list)
        for k, t in triage.items():
            it = items.get(k)
            if not it or t.get("type") or not it.get("active", True) or it.get("in_latest_zmm") is False:
                continue
            by_po[it["po"]].append(k)
        if counts_only:
            return {"pos": len(by_po), "items": sum(len(v) for v in by_po.values())}
        lines = [{**f, "line_id": k} for k, f in (await engine.fields("opex_tracker")).items()]
        out = []
        for po, keys in sorted(by_po.items()):
            its = [items[k] for k in sorted(keys)]
            tr = [triage[k] for k in sorted(keys)]
            head = its[0]
            if q and q.lower() not in " ".join(str(head.get(x) or "") for x in ("po", "supplier_name", "wbs", "material_description")).lower():
                continue
            sug_types = {t.get("suggested_type") for t in tr}
            total = sum(_num(i.get("value_inr")) for i in its)
            agg = {"po": po, "supplier_code": head.get("supplier_code"), "supplier_name": head.get("supplier_name"),
                   "wbs": head.get("wbs"), "created_on": head.get("created_on"), "currency": head.get("currency"),
                   "value_inr": round(total, 2), "fy_impact_inr": round(sum(_num(i.get("fy_impact_inr")) for i in its), 2),
                   "period_start": min([i["period_start"] for i in its if i.get("period_start")] or [None]),
                   "period_end": max([i["period_end"] for i in its if i.get("period_end")] or [None]),
                   "suggested_type": next(iter(sug_types)) if len(sug_types) == 1 else None,
                   "mixed_types": len(sug_types - {None}) > 1,
                   "awaiting_correction": any(t.get("needs_correction") for t in tr),
                   "location": next((t.get("location") for t in tr if t.get("location")), None),
                   "category": next((t.get("category") for t in tr if t.get("category")), None),
                   "department": next((t.get("department") for t in tr if t.get("department")), None),
                   "items": [{"item": i["item"], "material": i.get("material"), "material_description": i.get("material_description"),
                              "value_inr": i.get("value_inr"), "period_start": i.get("period_start"), "period_end": i.get("period_end"),
                              "fx_source": i.get("fx_source"), "suggested_type": t.get("suggested_type")} for i, t in zip(its, tr)]}
            agg["suggestions"] = P.suggest_lines({**head, "value_inr": total, "location": agg["location"],
                                                  "period_start": agg["period_start"], "period_end": agg["period_end"]}, lines)
            same_wbs = [ln for ln in lines if head.get("wbs") and ln.get("wbs") == head.get("wbs") and ln.get("aop_code")]
            agg["aop_code_suggestion"] = same_wbs[0].get("aop_code") if same_wbs else None
            out.append(agg)
            if limit and len(out) >= limit:
                break
        return out

    @r.get("/review/to-map")
    async def to_map(q: Optional[str] = None, limit: int = Query(500, le=5000), user: dict = Depends(get_current_user)):
        await review_access(user)
        rows = await to_map_list(limit, q=q)
        return {"rows": rows, "types": P.TYPES, "not_required_reasons": P.NOT_REQUIRED_REASONS,
                "correction_types": P.CORRECTION_TYPES, "mapping_statuses": MAPPING_STATUSES}

    async def create_line(fields: Dict[str, Any], parent: Optional[Dict[str, Any]], user: dict, *, line_id: Optional[str] = None) -> str:
        cfg = await ctx.get_config()
        plan = cfg["plan_fy"]
        existing = {d["key"] async for d in db.aop_rows.find({"dataset": "opex_tracker"}, {"_id": 0, "key": 1})}
        if parent:
            lid = line_id or P.addon_line_id(parent["line_id"], existing)
            base = {k: parent.get(k) for k in COPY_TO_ADDON if parent.get(k) not in (None, "")}
            base.update(parent_line_id=parent["line_id"], mapping_status="Add-on")
        else:
            n = max([int(k.split("-")[1]) for k in existing if k.startswith("TRK-") and k.split("-")[1].isdigit()] + [0]) + 1
            lid = line_id or f"TRK-{n:05d}"
            base = {"mapping_status": "New – from ZMM"}
        base.update({k: v for k, v in fields.items() if v not in (None, "")})
        base.setdefault(vkey("B" + plan[2:], "annual"), 0.0)
        base["line_id"] = lid
        await engine.bulk_set("opex_tracker", {lid: base}, upsert=True, by=user.get("email"))
        return lid

    async def link(line_id: str, po: str, user: dict, material: Optional[str] = None, item: Optional[str] = None,
                   source: str = "review", **extra) -> str:
        k = P.link_key(line_id, po, material, item)
        await engine.bulk_set("po_links", {k: {"line_id": line_id, "po": po, "material": material or "", "po_item": item or "",
                                               "status": "Active", "source": source, "created_at": now_iso(),
                                               "created_by": user.get("email"), **{a: b for a, b in extra.items() if b not in (None, "")}}},
                              upsert=True, by=user.get("email"))
        return k

    async def map_opex(po: str, items: List[Dict[str, Any]], d: Dict[str, Any], user: dict) -> List[str]:
        """Opex decision → links (and new / add-on lines)."""
        action = d.get("opex_action") or "Renewal / replacement"
        lines = await engine.fields("opex_tracker")
        made = []
        rows = d.get("rows") or [{"line_id": d.get("line_id"), "add_as_new_line": d.get("add_as_new_line"),
                                  "material": d.get("material"), "po_item": d.get("po_item")}]
        if action == "Renewal / replacement":
            for row in rows:
                lid = row.get("line_id")
                if not lid or lid not in lines:
                    raise HTTPException(400, f"PO {po}: pick the line this PO renews")
                if row.get("add_as_new_line"):
                    first = items[0]
                    lid = await create_line({"recurring": P.recurring_from_period(first.get("period_start"), first.get("period_end")),
                                             "br_scope": None, "po": po}, {**lines[lid], "line_id": lid}, user)
                made.append(await link(lid, po, user, row.get("material"), row.get("po_item")))
        else:
            nl = dict(d.get("new_line") or {})
            if action == "One-time" and d.get("line_id") and d["line_id"] in lines:
                lid = d["line_id"]
            else:
                head = items[0]
                nl.setdefault("wbs", head.get("wbs"))
                nl.setdefault("supplier_code", head.get("supplier_code"))
                nl.setdefault("supplier_name", head.get("supplier_name"))
                nl.setdefault("vendor", head.get("supplier_name"))
                nl.setdefault("po_description", head.get("material_description"))
                nl.setdefault("po", po)
                nl["recurring"] = "One-Time" if action == "One-time" else "Recurring"
                if action != "One-time":
                    nl.setdefault("br_post_dlp", None)
                lid = await create_line({k: v for k, v in nl.items() if k in set(COPY_TO_ADDON) | set(ZMM_KEYS) |
                                         {"po", "recurring", "vendor", "br_post_dlp", "wbs"}}, None, user)
            made.append(await link(lid, po, user))
        return made

    @r.post("/review/to-map/decide")
    async def decide_to_map(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        """``{decisions: [{po, items?, type, ...type fields}]}`` — one decision per PO (all its active items) or per
        item ("split by item": items = [item no.]). Bulk confirm = several decisions with the pre-filled type."""
        decisions = payload.get("decisions") or []
        if not decisions:
            raise HTTPException(400, "No decisions")
        done, made_links, errors = 0, 0, []
        triage_upd: Dict[str, Dict[str, Any]] = {}
        for d in decisions:
            po = P.po_str(d.get("po"))
            typ = d.get("type")
            if typ not in P.TYPES:
                errors.append({"po": po, "reason": "type must be one of " + ", ".join(P.TYPES)}); continue
            await review_access(user, "edit", DEST_SECTION.get(typ))
            raw = await engine.fields("po_items", {"fields.po": po})
            sel = [str(x) for x in d.get("items") or []]
            its = [v for v in raw.values() if (not sel or v.get("item") in sel) and v.get("active", True)] or \
                  [v for v in raw.values() if not sel or v.get("item") in sel]
            if not its:
                errors.append({"po": po, "reason": "PO not in the ZMM"}); continue
            base = {"type": typ, "decided_by": user.get("email"), "decided_at": now_iso(), "remarks": d.get("remarks")}
            try:
                if d.get("needs_correction") or typ == "Needs correction":
                    await create_correction(po, [i["item"] for i in its], d.get("correction_type") or "Other",
                                            d.get("remarks") or "", user, "triage")
                    base["needs_correction"] = True
                    if typ == "Needs correction":
                        base["type"] = d.get("then_type") or None  # stays in To map until a type is chosen
                if typ == "Opex":
                    made_links += len(await map_opex(po, its, d, user))
                    base.update(opex_action=d.get("opex_action") or "Renewal / replacement", line_id=d.get("line_id"),
                                add_as_new_line=bool(d.get("add_as_new_line")))
                elif typ == "Overheads":
                    base.update(department=d.get("department"), budgeted=bool(d.get("budgeted", True)))
                    if d.get("budgeted", True):
                        base["budget_code"] = d.get("budget_code")  # may follow later (bulk confirm sets the type only)
                    else:
                        oh_key = await new_overhead_line(po, its, d, user)
                        base.update(budget_code=oh_key, cost_centre=d.get("cost_centre"), gl=d.get("gl"),
                                    expense_heading=d.get("expense_heading"), description=d.get("description"))
                elif typ == "Capex":
                    base.update(capex_key=d.get("capex_key"), location=d.get("location") or None)
                elif typ == "Payroll":
                    base["department"] = d.get("department")
                elif typ == "Mapping not required":
                    base["not_required_reason"] = d.get("not_required_reason") or "Other"
            except HTTPException as e:
                errors.append({"po": po, "reason": e.detail}); continue
            for i in its:
                triage_upd[f"{po}|{i['item']}"] = {k: v for k, v in base.items() if v is not None or k == "type"}
            done += 1
        await engine.bulk_set("po_triage", triage_upd, upsert=True, by=user.get("email"))
        if made_links:
            await ctx.recalc_tracker()
        await audit(user, "po_triage", "decide", {"decisions": done, "links": made_links})
        return {"decided": done, "links": made_links, "errors": errors}

    async def new_overhead_line(po: str, its: List[Dict[str, Any]], d: Dict[str, Any], user: dict) -> str:
        last = [x["key"] async for x in db.aop_rows.find({"dataset": "overhead_plan"}, {"_id": 0, "key": 1})]
        n = max([int(k.split("-")[-1]) for k in last if k.startswith("OHP-") and k.split("-")[-1].isdigit()] + [0]) + 1
        key = f"OHP-{n:05d}"
        await engine.bulk_set("overhead_plan", {key: {
            "line_id": key, "department": d.get("department"), "cost_centre": d.get("cost_centre"), "gl": d.get("gl"),
            "aop_head": d.get("expense_heading"), "description": d.get("description") or its[0].get("material_description"),
            "unbudgeted": True, "source_po": po, "vendor": its[0].get("supplier_name")}}, upsert=True, by=user.get("email"))
        return key

    @r.get("/review/overhead-budget-lines")
    async def overhead_budget_lines(department: Optional[str] = None, user: dict = Depends(get_current_user)):
        await review_access(user)
        cfg = await ctx.get_config()
        B = "B" + (cfg.get("draft_fy") or cfg["plan_fy"])[2:]
        out = []
        for k, f in (await engine.fields("overhead_plan")).items():
            if department and str(f.get("department") or "").strip().lower() != department.strip().lower():
                continue
            out.append({"key": k, "department": f.get("department"), "cost_centre": f.get("cost_centre"), "gl": f.get("gl"),
                        "aop_head": f.get("aop_head"), "description": f.get("description") or f.get("expense_description"),
                        "budget": f.get(vkey(B, "annual"))})
        return out

    @r.get("/review/capex-projects")
    async def capex_projects(user: dict = Depends(get_current_user)):
        await review_access(user)
        return [{"key": k, "location": f.get("location"), "project": f.get("project")}
                for k, f in (await engine.fields("capex_tracker")).items()]

    # ------------------------------------------------------------------ PO changes
    @r.get("/review/changes")
    async def changes(status: str = "Open", user: dict = Depends(get_current_user)):
        await review_access(user)
        ch = await engine.fields("po_changes", {"fields.status": status} if status != "all" else None)
        st = await engine.load_state()
        base = engine.compute(st, details=False)["forecasts"]
        by_po: Dict[str, List[str]] = defaultdict(list)
        for k, c in ch.items():
            by_po[c.get("po")].append(k)
        upd = {}
        out = []
        for po, keys in by_po.items():
            items = sorted({f"{po}|{ch[k].get('item')}" for k in keys})
            if status == "Open":
                total, per_line = engine.change_impact(st, items, base)
            else:
                total, per_line = None, {}
            for k in keys:
                c = ch[k]
                row = {"key": k, **c, "lines": c.get("lines") or sorted(per_line), "po_fy_impact": total,
                       "line_impact": per_line}
                it = st["raw_items"].get(f"{po}|{c.get('item')}") or {}
                row["supplier_name"] = it.get("supplier_name")
                row["material_description"] = it.get("material_description")
                out.append(row)
                if status == "Open" and c.get("fy_impact") != total:
                    upd[k] = {"fy_impact": total}
        if upd:
            await engine.bulk_set("po_changes", upd)
        out.sort(key=lambda x: (x.get("po") or "", x.get("item") or "", x.get("field") or ""))
        return {"rows": out, "mode": (await ctx.get_config()).get("po_change_mode") or "hold"}

    @r.post("/review/changes/decide")
    async def decide_changes(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        """``{keys: [...] | po: "...", accept: bool, remarks, mapping}`` — accept takes SAP's latest values for those
        fields and recalculates; reject (remark required) keeps the accepted values as an override and opens a
        correction. An accepted "item added" needs its mapping (pre-filled from the PO)."""
        await review_access(user, "edit")
        accept = bool(payload.get("accept"))
        remarks = (payload.get("remarks") or "").strip()
        if not accept and not remarks:
            raise HTTPException(400, "A remark is required to reject a change")
        q: Dict[str, Any] = {"fields.status": "Open"}
        if payload.get("keys"):
            q["key"] = {"$in": payload["keys"]}
        elif payload.get("po"):
            q["fields.po"] = P.po_str(payload["po"])
        else:
            raise HTTPException(400, "keys or po required")
        chs = await engine.fields("po_changes", q)
        items = await engine.fields("po_items")
        item_upd: Dict[str, Dict[str, Any]] = {}
        ch_upd: Dict[str, Dict[str, Any]] = {}
        by_item: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for k, c in chs.items():
            by_item[f"{c['po']}|{c['item']}"].append({**c, "_key": k})
        corrections = 0
        for ik, cs in by_item.items():
            it = items.get(ik) or {}
            fields = [c["field"] for c in cs if c["field"] != "item_added"]
            if accept:
                upd = P.accept_fields(it, fields)
                if any(c["field"] == "item_added" for c in cs):
                    mp = payload.get("mapping") or (cs[0].get("prefill") or {})
                    po, item = ik.split("|", 1)
                    if mp.get("type") == "Opex" and mp.get("line_id"):
                        await map_opex(po, [it], {"opex_action": "Renewal / replacement",
                                                  "rows": [{"line_id": mp["line_id"], "po_item": item,
                                                            "add_as_new_line": mp.get("add_as_new_line")}]}, user)
                    if mp.get("type"):
                        await engine.bulk_set("po_triage", {ik: {"type": mp["type"], "line_id": mp.get("line_id"),
                                                                 "decided_by": user.get("email"), "decided_at": now_iso()}},
                                              upsert=True, by=user.get("email"))
                    upd["accepted_active"] = it.get("latest_active", True)
                item_upd[ik] = upd
            else:
                override = {f: it.get(f"accepted_{f}") for f in fields}
                ctype = P.CORRECTION_TYPE.get(cs[0]["field"], "Other")
                await create_correction(ik.split("|")[0], [ik.split("|", 1)[1]], ctype, remarks, user, "rejected change",
                                        override=override)
                corrections += 1
            for c in cs:
                ch_upd[c["_key"]] = {"status": "Accepted" if accept else "Rejected", "decided_by": user.get("email"),
                                     "decided_at": now_iso(), "remarks": remarks or None}
        await engine.bulk_set("po_items", item_upd, by=user.get("email"))
        await engine.bulk_set("po_changes", ch_upd, by=user.get("email"))
        await ctx.recalc_tracker()
        await audit(user, "po_changes", "accept" if accept else "reject", {"changes": len(ch_upd)})
        return {"decided": len(ch_upd), "corrections": corrections}

    # ------------------------------------------------------------------ corrections
    @r.get("/review/corrections")
    async def corrections(status: Optional[str] = None, format: Optional[str] = None, user: dict = Depends(get_current_user)):
        await review_access(user)
        rows = [{"key": k, **f} for k, f in (await engine.fields("po_corrections")).items()
                if not status or f.get("status") == status or (status == "open" and f.get("status") != "Resolved")]
        rows.sort(key=lambda x: x["key"])
        if format == "xlsx":
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Corrections"
            cols = [("key", "Correction"), ("po", "PO"), ("items", "Items"), ("supplier", "Supplier"), ("type", "Correction type"),
                    ("remarks", "Remarks"), ("raised_to", "Raised to"), ("raised_on", "Raised on"), ("status", "Status"),
                    ("override", "Provisional override"), ("resolved_on", "Resolved on"), ("resolved_by", "Resolved by")]
            ws.append([c[1] for c in cols])
            for r_ in rows:
                ws.append([", ".join(map(str, r_.get(k) or [])) if k == "items" else
                           (str(r_.get(k)) if isinstance(r_.get(k), dict) else r_.get(k)) for k, _ in cols])
            out = io.BytesIO()
            wb.save(out)
            out.seek(0)
            return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                     headers={"Content-Disposition": 'attachment; filename="po_corrections.xlsx"'})
        return {"rows": rows, "types": P.CORRECTION_TYPES, "statuses": ["Open", "Raised", "Possibly resolved", "Resolved"]}

    @r.post("/review/corrections")
    async def add_correction(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        await review_access(user, "edit")
        po = P.po_str(payload.get("po"))
        if not po:
            raise HTTPException(400, "PO required")
        ctype = payload.get("type") or "Other"
        if ctype not in P.CORRECTION_TYPES:
            raise HTTPException(400, "Unknown correction type")
        cid = await create_correction(po, [str(x) for x in payload.get("items") or []], ctype, payload.get("remarks") or "",
                                      user, payload.get("source") or "manual", override=payload.get("override"))
        await audit(user, "po_corrections", "create", {"id": cid, "po": po})
        return {"key": cid}

    @r.patch("/review/corrections/{cid}")
    async def patch_correction(cid: str, payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        await review_access(user, "edit")
        cur = (await engine.fields("po_corrections", {"key": cid})).get(cid)
        if not cur:
            raise HTTPException(404, "Correction not found")
        upd = {k: v for k, v in payload.items() if k in ("type", "remarks", "raised_to", "raised_on", "status", "override")}
        if upd.get("status") and upd["status"] not in ("Open", "Raised", "Possibly resolved", "Resolved"):
            raise HTTPException(400, "Unknown status")
        if upd.get("status") == "Raised" and not (upd.get("raised_on") or cur.get("raised_on")):
            upd["raised_on"] = date.today().isoformat()
        if upd.get("status") == "Resolved":
            upd.update(resolved_on=date.today().isoformat(), resolved_by=user.get("email"), override=None)
        await engine.bulk_set("po_corrections", {cid: upd}, by=user.get("email"))
        if "override" in upd or upd.get("status") == "Resolved":
            await ctx.recalc_tracker()
        await audit(user, "po_corrections", "update", {"id": cid, **{k: str(v) for k, v in upd.items()}})
        return {"key": cid, **upd}

    # ------------------------------------------------------------------ checks
    async def build_checks() -> List[Dict[str, Any]]:
        cfg = await ctx.get_config()
        acks = {a["id"]: a async for a in db.aop_review_acks.find({}, {"_id": 0})}
        links = await engine.fields("po_links")
        items = await engine.fields("po_items")
        lines = await engine.fields("opex_tracker")
        out: List[Dict[str, Any]] = []

        def add(cid, kind, ref, msg, info=False, **extra):
            a = acks.get(cid)
            out.append({"id": cid, "kind": kind, "ref": ref, "message": msg, "informational": info,
                        "acknowledged": bool(a), "ack_remark": (a or {}).get("remark"), **extra})
        for k, ln in links.items():
            if ln.get("status", "Active") != "Active":
                continue
            fl = str(ln.get("flags") or "")
            if ln.get("alloc_auto"):
                add(f"alloc_auto|{k}", "Auto-split allocation", k, f"{ln['line_id']} ← {ln['po']}: {float(ln.get('alloc_pct') or 0):.1%} "
                    "auto-split — confirm or edit", info=True, link=k, line_id=ln["line_id"], po=ln["po"])
            if "Multi-item PO" in fl:
                add(f"multi|{k}", "Map by material / item", k, f"{ln['line_id']} ← {ln['po']}: multi-item PO split by % — map each "
                    "line by material / PO item instead", info=True, link=k, line_id=ln["line_id"], po=ln["po"])
            if "Allocation sums" in fl:
                add(f"alloc_sum|{k}", "Allocation ≠ 100%", k, fl, link=k, line_id=ln["line_id"], po=ln["po"])
            if "deleted/blocked" in fl or "PO not in ZMM" in fl or "Material not on this PO" in fl:
                add(f"dead|{k}", "Link to deleted / missing PO", k, f"{ln['line_id']} ← {ln['po']}: {fl}", link=k,
                    line_id=ln["line_id"], po=ln["po"])
            covered = [items.get(f"{ln['po']}|{i}") or {} for i in ln.get("items") or []]
            if covered and all(c.get("period_missing") for c in covered) and not (ln.get("coverage_from") and ln.get("coverage_to")):
                add(f"period|{k}", "No service period", k, f"{ln['line_id']} ← {ln['po']}: no service period in the ZMM — "
                    "enter coverage dates", link=k, line_id=ln["line_id"], po=ln["po"])
        for k, it in items.items():
            src = str(it.get("fx_source") or "")
            if src not in ("INR", "SAP group currency", ""):
                add(f"fx|{k}", "FX fallback" if src == P.FX_FALLBACK else "No FX rate", k,
                    f"PO {it['po']} item {it['item']} ({it.get('currency')}): {src}", info=src == P.FX_FALLBACK, po=it["po"])
        today = date.today().isoformat()
        for lid, f in lines.items():
            if f.get("link_flags") and "Rate mismatch" in str(f["link_flags"]):
                msg = next(x for x in str(f["link_flags"]).split("; ") if "Rate mismatch" in x)
                add(f"rate|{lid}", "Rate mismatch > 25%", lid, f"{lid}: {msg}", info=True, line_id=lid)
            if f.get("mapping_status") == "Awaiting new PO" and f.get("po_end") and str(f["po_end"]) < today \
                    and not (f.get("active_po_count") or 0):
                add(f"ended|{lid}", "Old PO ended, no new PO", lid, f"{lid}: old PO {f.get('po')} ended {f['po_end']} — awaiting new PO",
                    line_id=lid)
            if not f.get("line_id"):
                add(f"noid|{lid}", "Line without ID", lid, f"{lid}: tracker line without a Line ID", line_id=lid)
            for msg in validate(f, "opex_tracker", cfg):
                add(f"input|{lid}|{msg[:20]}", "Opex line input", lid, f"{lid}: {msg}", line_id=lid)
        return out

    @r.get("/review/checks")
    async def checks(include_acknowledged: bool = False, user: dict = Depends(get_current_user)):
        await review_access(user)
        rows = await build_checks()
        if not include_acknowledged:
            rows = [c for c in rows if not c["acknowledged"]]
        return {"rows": rows}

    @r.post("/review/checks/ack")
    async def ack(payload: Dict[str, Any] = Body(...), user: dict = Depends(get_current_user)):
        await review_access(user, "edit")
        ids = payload.get("ids") or ([payload["id"]] if payload.get("id") else [])
        for i in ids:
            await db.aop_review_acks.update_one({"id": i}, {"$set": {"id": i, "remark": payload.get("remark"), "by": user.get("email"),
                                                                     "at": now_iso()}}, upsert=True)
        # confirming an auto split makes the % the user's
        link_keys = [i.split("|", 1)[1] for i in ids if i.startswith("alloc_auto|")]
        if link_keys and payload.get("confirm_split", True):
            await engine.bulk_set("po_links", {k: {"alloc_auto": False} for k in link_keys}, by=user.get("email"))
        await audit(user, "review_checks", "acknowledge", {"ids": ids[:50]})
        return {"acknowledged": len(ids)}

    # ------------------------------------------------------------------ upload log
    @r.get("/review/runs")
    async def runs(limit: int = Query(200, le=2000), user: dict = Depends(get_current_user)):
        await review_access(user)
        rows = [d.get("fields") or {} async for d in db.aop_rows.find({"dataset": "zmm_runs"}, {"_id": 0, "fields": 1})
                .sort("fields.received_at", -1).limit(limit)]
        for x in rows:
            x.pop("header", None)
        return {"rows": rows}

    @r.get("/review/runs/{run_id}/file")
    async def run_file(run_id: str, user: dict = Depends(get_current_user)):
        await review_access(user)
        doc = await db.aop_rows.find_one({"dataset": "zmm_runs", "key": run_id}, {"_id": 0, "fields": 1})
        key = ((doc or {}).get("fields") or {}).get("storage_key")
        if not key or not ctx.storage:
            raise HTTPException(404, "File not stored")
        got = await ctx.storage.open(key)
        if not got:
            raise HTTPException(404, "File not found")
        name = key.rsplit("/", 1)[-1]
        return StreamingResponse(io.BytesIO(got[0]), media_type=got[1] or "application/octet-stream",
                                 headers={"Content-Disposition": f'attachment; filename="{name}"'})

    # ------------------------------------------------------------------ PO drawer
    @r.get("/po/{po}")
    async def po_detail(po: str, user: dict = Depends(get_current_user)):
        p = await ctx.perms_for(user)
        if not (p["admin"] or p["sections"]["aop_opex"]["can_view"]):
            raise HTTPException(403, "Not allowed")
        po = P.po_str(po.strip()) or po.strip()
        return await po_payload(po)

    async def po_payload(po: str) -> Dict[str, Any]:
        items = sorted((await engine.fields("po_items", {"fields.po": po})).values(), key=lambda x: str(x.get("item")))
        for i in items:  # show what the forecast uses (accepted), and SAP's value where it differs
            i["sap_now"] = {f: i.get(f"latest_{f}") for f in P.FLAGGED if f"accepted_{f}" in i and i.get(f"latest_{f}") != i.get(f"accepted_{f}")}
            i.update({f: i[f"accepted_{f}"] for f in P.TRACKED if f"accepted_{f}" in i})
        reg = [f for f in (await engine.fields("po_register", {"fields.purchase_order": po})).values()]
        grn, inv, seen_g, seen_i = [], [], set(), set()
        for f in sorted(reg, key=lambda x: str(x.get("grn_posting_date") or "")):
            mk = (f.get("migo_no"), f.get("migo_line_item_no"))
            if mk[0] and mk not in seen_g:
                seen_g.add(mk)
                grn.append({"item": f.get("purchase_order_item"), "migo_no": f.get("migo_no"), "migo_line": f.get("migo_line_item_no"),
                            "date": f.get("grn_posting_date"), "amount_inr": f.get("grn_amount_in_group_currency"),
                            "amount_doc": f.get("gr_amount_in_lc")})
            ik = f.get("invoice_no")
            if ik and ik not in seen_i:
                seen_i.add(ik)
                inv.append({"item": f.get("purchase_order_item"), "invoice_no": ik,
                            "date": f.get("invoice_posting_date") or f.get("invoice_date"),
                            "amount_inr": f.get("invoice_amount_in_group_currency")})
        links = [{"key": k, **f} for k, f in (await engine.fields("po_links", {"fields.po": po})).items()]
        lines = await engine.fields("opex_tracker", {"key": {"$in": [ln["line_id"] for ln in links]}})
        for ln in links:
            t = lines.get(ln["line_id"]) or {}
            ln.update(aop_code=t.get("aop_code"), vendor=t.get("vendor") or t.get("supplier_name"), line_po=t.get("po"),
                      tag=t.get("tag"))
        own = [{"line_id": k, "aop_code": f.get("aop_code"), "vendor": f.get("vendor"), "tag": f.get("tag")}
               for k, f in (await engine.fields("opex_tracker", {"fields.po": po})).items()]
        opex_lines = [{"line_id": k, "aop_code": f.get("aop_code"), "vendor": f.get("vendor"),
                       "budget": f.get(vkey("B" + (await ctx.get_config())["plan_fy"][2:], "annual"))}
                      for k, f in (await engine.fields("opex_lines", {"fields.po": po})).items()]
        triage = [{"item": f.get("item"), **f} for f in (await engine.fields("po_triage", {"fields.po": po})).values()]
        chs = [{"key": k, **f} for k, f in (await engine.fields("po_changes", {"fields.po": po})).items() if f.get("status") == "Open"]
        cors = [{"key": k, **f} for k, f in (await engine.fields("po_corrections", {"fields.po": po})).items() if f.get("status") != "Resolved"]
        head = items[0] if items else {}
        alloc_total = sum(_num(ln.get("alloc_value_inr")) for ln in links if ln.get("status", "Active") == "Active")
        value = sum(_num(i.get("value_inr")) for i in items if i.get("active", True))
        summary = {"purchase_order": po, "in_zmm": bool(items), "supplier": head.get("supplier_name"),
                   "supplier_code": head.get("supplier_code"), "created_on": head.get("created_on"), "currency": head.get("currency"),
                   "wbs": sorted({str(i.get("wbs")) for i in items if i.get("wbs")}), "pr_no": head.get("pr_no"),
                   "items": len(items), "po_value": round(value, 2),
                   "grn_amount": round(sum(_num(i.get("grn_inr")) for i in items), 2),
                   "pending_grn": round(sum(_num(i.get("pending_inr")) for i in items), 2),
                   "invoiced": round(sum(_num(i.get("invoiced_inr")) for i in items), 2),
                   "allocated": round(alloc_total, 2),
                   "allocation_warning": (f"Allocated ₹{alloc_total:,.0f} of ₹{value:,.0f}" if links and value and
                                          abs(alloc_total - value) > max(1.0, value * 0.005) else None)}
        return {"summary": summary, "items": items, "grn": grn, "invoices": inv, "links": links, "own_lines": own,
                "opex_lines": opex_lines, "triage": triage, "changes": chs, "corrections": cors}

    # ------------------------------------------------------------------ line history drawer
    @r.get("/opex/lines/{line_id}/history")
    async def line_history(line_id: str, po: Optional[str] = None, user: dict = Depends(get_current_user)):
        p = await ctx.perms_for(user)
        if not (p["admin"] or p["sections"]["aop_opex"]["can_view"]):
            raise HTTPException(403, "Not allowed")
        cfg = await ctx.get_config()
        plan = cfg["plan_fy"]
        lines = await engine.fields("opex_tracker", {"key": line_id})
        line = lines.get(line_id)
        if not line:
            raise HTTPException(404, "Line not found")
        F = "F" + plan[2:]
        addons = [k for k in (await engine.fields("opex_tracker", {"fields.parent_line_id": line_id}))]
        header = {"line_id": line_id, "aop_code": line.get("aop_code"), "wbs": line.get("wbs"), "tag": line.get("tag"),
                  "budget": line.get(vkey("B" + plan[2:], "annual"), line.get("budget_plan")),
                  "forecast": round(sum(_num(line.get(vkey(F, m))) for m in fy_months(plan)), 2),
                  "mapping_status": line.get("mapping_status"), "parent_line_id": line.get("parent_line_id"), "add_ons": addons,
                  "recurring": line.get("recurring"), "vendor": line.get("vendor"), "plan_fy": plan}
        links = [{"key": k, **f} for k, f in (await engine.fields("po_links", {"fields.line_id": line_id})).items()]
        timeline = [{"generation": 0, "po": line.get("po"), "own": True, "supplier": line.get("supplier_name") or line.get("vendor"),
                     "supplier_code": line.get("supplier_code"), "period_start": line.get("po_start"), "period_end": line.get("po_end"),
                     "allocated_inr": line.get("net_po") or line.get("po_amount"), "status": "Line's own PO"}]
        items_all = await engine.fields("po_items", {"fields.po": {"$in": [ln["po"] for ln in links]}})
        for ln in sorted(links, key=lambda x: str(x.get("period_start") or x.get("created_at") or "")):
            its = [v for v in items_all.values() if v.get("po") == ln["po"]]
            grn = sum(_num(i.get("grn_inr")) for i in its)
            val = sum(_num(i.get("value_inr")) for i in its)
            timeline.append({"po": ln["po"], "material": ln.get("material") or None, "po_item": ln.get("po_item") or None,
                             "supplier": ln.get("supplier_name"), "supplier_code": ln.get("supplier_code"),
                             "period_start": ln.get("coverage_from") or ln.get("period_start"),
                             "period_end": ln.get("coverage_to") or ln.get("period_end"), "allocated_inr": ln.get("alloc_value_inr"),
                             "alloc_pct": ln.get("alloc_pct"), "grn_pct": round(grn / val, 4) if val else None,
                             "status": ln.get("status") or "Active", "supplier_changed": ln.get("supplier_changed") == "Yes",
                             "flags": ln.get("flags")})
        for g, t in enumerate(timeline[1:], start=1):
            t["generation"] = g
        target = P.po_str(po) if po else (line.get("latest_po") or line.get("po"))
        detail = None
        if target:
            if await db.aop_rows.find_one({"dataset": "po_items", "fields.po": target}, {"_id": 1}):
                detail = {"kind": "sap", **(await po_payload(target))}
            else:
                detail = {"kind": "legacy", "po": target, "fields": {k: line.get(k) for k in (
                    "supplier_code", "supplier_name", "vendor", "po_date", "po_start", "po_end", "po_amount", "po_amount_doc",
                    "currency", "net_po", "po_description", "material", "material_description", "pr_no")}}
        return {"line": header, "timeline": timeline, "po": target, "detail": detail}

    # ------------------------------------------------------------------ add-on, split, recalc
    @r.post("/opex/lines/{line_id}/add-on")
    async def add_on(line_id: str, payload: Dict[str, Any] = Body(default={}), user: dict = Depends(get_current_user)):
        """Create an add-on line under this line ({parent}-A{n}, fields copied) and link the PO to it, so the PO adds to
        cost instead of replacing the old PO."""
        await review_access(user, "edit", "aop_opex")
        lines = await engine.fields("opex_tracker", {"key": line_id})
        parent = lines.get(line_id)
        if not parent:
            raise HTTPException(404, "Line not found")
        po = P.po_str(payload.get("po"))
        its = list((await engine.fields("po_items", {"fields.po": po})).values()) if po else []
        first = its[0] if its else {}
        rec = payload.get("recurring") or (P.recurring_from_period(first.get("period_start"), first.get("period_end")) if its else None)
        lid = await create_line({"recurring": rec, "po": po, **(payload.get("fields") or {})}, {**parent, "line_id": line_id}, user)
        if po:
            await link(lid, po, user, P.po_str(payload.get("material")), P.po_str(payload.get("po_item")))
        await ctx.recalc_tracker()
        await audit(user, "opex_tracker", "add-on", {"parent": line_id, "line": lid, "po": po})
        return {"line_id": lid}

    @r.post("/opex/links/split")
    async def resplit(payload: Dict[str, Any] = Body(default={}), user: dict = Depends(get_current_user)):
        """Re-apply the automatic allocation (auto-split links only; a user % is never changed)."""
        await review_access(user, "edit", "aop_opex")
        q = {"fields.alloc_auto": True}
        if payload.get("po"):
            q["fields.po"] = P.po_str(payload["po"])
        keys = list(await engine.fields("po_links", q))
        await engine.bulk_set("po_links", {k: {"alloc_pct": None} for k in keys}, by=user.get("email"))
        res = await ctx.recalc_tracker()
        return {"reset": len(keys), "lines": (res or {}).get("lines")}

    @r.post("/opex/recalc")
    async def recalc(user: dict = Depends(get_current_user)):
        if user.get("role") != "admin":
            raise HTTPException(403, "Admin only")
        res = await ctx.recalc_tracker()
        await audit(user, "opex_tracker", "recalc", {"lines": (res or {}).get("lines")})
        return {k: v for k, v in (res or {}).items() if k != "forecasts"}

    return SimpleNamespace(build_checks=build_checks, create_correction=create_correction, to_map_list=to_map_list)
