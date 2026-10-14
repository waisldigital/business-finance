"""One PO mapping, three places to edit it, and ZMM corrections in the ZMM sheet itself.

The mapping is stored once, in ``po_links`` (tracker line × PO [× material] [× PO item]). It can be changed from:

* the **Opex sheet** (``opex_lines`` / ``opex_tracker``) — column "New PO(s) mapped": ``4200000218, 4400000018_9700001103``
  (PO, or PO_material), or a status in words ("Not required", "Not migrated", "Merged with 4200000111" …);
* the **ZMM sheet** (``po_items`` / ``po_register``) — column "Opex line(s)": ``12, TRK-00013, OPX-00042`` (S. No., tracker
  line id or Opex line id);
* the **PO links** tab (row by row, unchanged).

Each place shows the same links, so a change in one is seen in the other two. Typing in the cell, pasting a block or
uploading the sheet (xlsx) all go through here.

**Corrections** are typed over the SAP value in the ZMM sheet (period, WBS, value, quantity, price, currency,
supplier, delivery date). The SAP value is kept; the typed value becomes the provisional override of an open
correction (Review → Corrections) that links and the forecast use, until SAP is fixed (the next ZMM run then marks
it "Possibly resolved"). Clearing the cell drops that field from the override.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from . import po as P
from .opex_schema import line_id_from_sno, po_str

MAPPING_FIELD = "mapped_pos"        # Opex sheet column
LINES_FIELD = "linked_lines"        # ZMM sheet column (po_items)
REGISTER_LINES_FIELD = "linked_forecast_s_no"  # ZMM sheet column (po_register, as in the SAP / forecast file)
CORRECTED_FIELD = "corrected"       # ZMM sheet: what was corrected, SAP value → used value

# Correctable item fields; po_register (raw ZMM headers) → po_items field
CORRECTABLE = ["period_start", "period_end", "wbs", "net_order_value", "quantity", "net_price", "currency",
               "supplier_code", "supplier_name", "delivery_date", "value_inr"]
REGISTER_FIELDS = {"start_date_for_period_of_performance": "period_start", "end_date_for_period_of_performance": "period_end",
                   "wbs_element": "wbs", "net_order_value": "net_order_value", "order_quantity": "quantity",
                   "quantity": "quantity", "net_order_price": "net_price", "currency": "currency", "supplier": "supplier_code",
                   "supplier_name": "supplier_name", "delivery_date": "delivery_date"}
DATE_FIELDS = {"period_start", "period_end", "delivery_date"}
NUMBER_FIELDS = {"net_order_value", "quantity", "net_price", "value_inr"}
LABEL = {"period_start": "Period start", "period_end": "Period end", "wbs": "WBS", "net_order_value": "Net order value",
         "quantity": "Qty", "net_price": "Price", "currency": "Currency", "supplier_code": "Supplier code",
         "supplier_name": "Supplier", "delivery_date": "Delivery date", "value_inr": "Value (INR)"}
SHEET_SOURCE = "ZMM sheet"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def links_text(links: List[Dict[str, Any]]) -> Optional[str]:
    """Links of one line as the Opex sheet shows them: PO, or PO_material; an item-level link as PO/item."""
    out = []
    for ln in sorted(links, key=lambda x: (str(x.get("po")), str(x.get("material") or ""), str(x.get("po_item") or ""))):
        if ln.get("status") not in (None, "", P.LINK_ACTIVE):
            continue
        t = str(ln.get("po"))
        if ln.get("material"):
            t += f"_{ln['material']}"
        if ln.get("po_item"):
            t += f"/{ln['po_item']}"
        if t not in out:
            out.append(t)
    return ", ".join(out) or None


def parse_mapping_text(text: Any) -> Tuple[List[Tuple[str, Optional[str], Optional[str]]], Optional[str], Optional[str]]:
    """'4200000218, 4400000018_9700001103, 4200000300/20' → ([(po, material, item)…], status, merged-into PO).
    A status in words (no PO numbers) is returned as the mapping status; blank → no links, no status change."""
    if text in (None, ""):
        return [], None, None
    toks: List[Tuple[str, Optional[str], Optional[str]]] = []
    rest: List[str] = []
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return [(po_str(text), None, None)], None, None
    for tok in re.split(r"[,;\n]+|\s{2,}|\s(?=\d{8,})", str(text).strip()):
        tok = tok.strip()
        if not tok:
            continue
        item = None
        m = re.fullmatch(r"(.+?)\s*/\s*(\d{1,6})", tok)
        if m:
            tok, item = m.group(1), str(int(m.group(2)))
        got, left = P.parse_po_tokens(tok)
        if got and not left:
            toks += [(po, mat, item) for po, mat in got]
        else:
            rest.append(tok)
    if toks:
        return toks, None, None
    st, merged = P.status_from_text(" ".join(rest))
    return [], st, merged


def parse_line_refs(text: Any) -> List[str]:
    """'12, TRK-00013, OPX-00042, AOP-CODE' → raw tokens (resolved to tracker lines by the caller)."""
    if text in (None, ""):
        return []
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return [str(int(text))]
    return [t.strip() for t in re.split(r"[,;\n]+", str(text)) if t.strip()]


def coerce_item_value(field: str, v: Any) -> Any:
    if v in (None, ""):
        return None
    if field in DATE_FIELDS:
        if hasattr(v, "isoformat"):
            return v.isoformat()[:10]
        from .periods import to_iso_date
        return to_iso_date(v) or str(v).strip()
    if field in NUMBER_FIELDS:
        try:
            return float(str(v).replace(",", "")) if not isinstance(v, (int, float)) else float(v)
        except ValueError:
            raise ValueError(f"{LABEL.get(field, field)}: not a number ({v})")
    if field == "supplier_code":
        return po_str(v)
    if field == "currency":
        return str(v).strip().upper()
    return str(v).strip()


def same_value(field: str, a: Any, b: Any) -> bool:
    if field in NUMBER_FIELDS:
        try:
            return abs(float(a or 0) - float(b or 0)) < 0.005
        except (TypeError, ValueError):
            return False
    return str(a or "").strip() == str(b or "").strip()


class Mapping:
    """Async helpers over aop_rows, built in the router (``engine`` = OpexEngine)."""

    def __init__(self, db, engine, cache: bool = False):
        """``cache``: keep the tracker lines in memory for one batch (a ZMM file); never for the long-lived instance."""
        self.db, self.engine, self.cache = db, engine, cache
        self._tracker: Optional[Dict[str, Dict[str, Any]]] = None

    async def tracker(self) -> Dict[str, Dict[str, Any]]:
        if self.cache and self._tracker is not None:
            return self._tracker
        t = await self.engine.fields("opex_tracker")
        if self.cache:
            self._tracker = t
        return t

    # ------------------------------------------------------------------ reading
    async def links(self, q: Optional[Dict[str, Any]] = None) -> Dict[str, Dict[str, Any]]:
        return await self.engine.fields("po_links", q)

    async def text_by_line(self) -> Dict[str, Optional[str]]:
        by: Dict[str, List[Dict[str, Any]]] = {}
        for f in (await self.links()).values():
            by.setdefault(str(f.get("line_id")), []).append(f)
        return {k: links_text(v) for k, v in by.items()}

    async def links_by_po(self, pos: Optional[Set[str]] = None) -> Dict[str, List[Dict[str, Any]]]:
        q = {"fields.po": {"$in": sorted(pos)}} if pos else None
        out: Dict[str, List[Dict[str, Any]]] = {}
        for k, f in (await self.links(q)).items():
            if f.get("status") in (None, "", P.LINK_ACTIVE):
                out.setdefault(str(f.get("po")), []).append({**f, "_key": k})
        return out

    @staticmethod
    def covers(link: Dict[str, Any], item: str, material: Optional[str]) -> bool:
        """A PO-level link covers every item; a material link the items of that material; an item link its item."""
        if link.get("po_item") and str(link["po_item"]) != str(item):
            return False
        if link.get("material") and material and str(link["material"]) != str(material):
            return False
        return True

    async def decorate_lines(self, dataset: str, docs: List[Dict[str, Any]]):
        """Opex sheet: "New PO(s) mapped" of each line (an Opex line shows its tracker line's links)."""
        text = await self.text_by_line()
        for d in docs:
            f = d.get("fields") or d
            lid = f.get("tracker_line_id") if dataset == "opex_lines" else (d.get("key") or f.get("line_id"))
            f[MAPPING_FIELD] = text.get(str(lid)) if lid else None

    async def decorate_items(self, dataset: str, docs: List[Dict[str, Any]]):
        """ZMM sheet: linked lines and corrections (the value used is shown; "Corrected" says what SAP has)."""
        fs = [d.get("fields") or {} for d in docs]
        po_of = (lambda f: f.get("po")) if dataset == "po_items" else (lambda f: f.get("purchase_order"))
        it_of = (lambda f: f.get("item")) if dataset == "po_items" else (lambda f: f.get("purchase_order_item"))
        pos = {str(po_of(f)) for f in fs if po_of(f)}
        if not pos:
            return
        by = await self.links_by_po(pos)
        overrides = await self.engine.corrections_overrides()
        tracker = await self.engine.fields("opex_tracker", {"key": {"$in": sorted({ln["line_id"] for v in by.values() for ln in v})}})
        for f in fs:
            po, it = str(po_of(f) or ""), str(it_of(f) or "")
            lines = list(dict.fromkeys(ln["line_id"] for ln in by.get(po, []) if self.covers(ln, it, f.get("material"))))
            col = LINES_FIELD if dataset == "po_items" else REGISTER_LINES_FIELD
            f[col] = ", ".join(lines) or None
            if dataset == "po_items":
                f["linked_aop_codes"] = ", ".join(sorted({str((tracker.get(x) or {}).get("aop_code")) for x in lines
                                                          if (tracker.get(x) or {}).get("aop_code")})) or None
            ov = overrides.get(f"{po}|{it}") or {}
            notes = []
            for fld, v in ov.items():
                if fld not in CORRECTABLE or v in (None, ""):
                    continue
                if dataset == "po_items":
                    sap = f.get(fld)
                    f[fld] = v
                else:
                    raw = next((k for k, x in REGISTER_FIELDS.items() if x == fld and k in f), None)
                    if raw is None:
                        continue
                    sap = f.get(raw)
                    f[raw] = v
                notes.append(f"{LABEL.get(fld, fld)}: SAP {sap if sap not in (None, '') else '—'} → {v}")
            f[CORRECTED_FIELD] = "; ".join(notes) or None

    # ------------------------------------------------------------------ line references
    async def resolve_line(self, ref: str, by: str, create_from_opex: bool = True) -> Optional[str]:
        """S. No. / TRK-… / OPX-… / AOP code → tracker line id (an Opex line without one gets a tracker line)."""
        s = str(ref).strip()
        if not s:
            return None
        tracker = await self.tracker()
        if re.fullmatch(r"\d+(\.0+)?", s) or s.upper().startswith("TRK-"):
            lid = line_id_from_sno(s)
            return lid if lid in tracker else None
        if s in tracker:
            return s
        doc = await self.db.aop_rows.find_one({"dataset": "opex_lines", "key": s}, {"_id": 0, "key": 1, "fields": 1})
        if doc:
            return await self.tracker_for_opex(doc["key"], doc.get("fields") or {}, by, create=create_from_opex)
        code = s.upper()
        hits = [k for k, f in tracker.items() if str(f.get("aop_code") or "").strip().upper() == code and not f.get("parent_line_id")]
        if len(hits) == 1:
            return hits[0]
        if not hits:
            docs = [d async for d in self.db.aop_rows.find({"dataset": "opex_lines"}, {"_id": 0, "key": 1, "fields": 1})
                    if str((d.get("fields") or {}).get("aop_code") or "").strip().upper() == code]
            if len(docs) == 1:
                return await self.tracker_for_opex(docs[0]["key"], docs[0].get("fields") or {}, by, create=create_from_opex)
        return None

    async def tracker_for_opex(self, key: str, f: Dict[str, Any], by: str, create: bool = True) -> Optional[str]:
        """The tracker line behind an Opex line: stored ``tracker_line_id``, else same PO (+ same AOP code), else a new
        tracker line copied from the Opex line (so a line can be mapped before it was ever in the forecast file)."""
        tracker = await self.tracker()
        lid = f.get("tracker_line_id")
        if lid and lid in tracker:
            return lid
        po = str(f.get("po") or "")
        cands = [k for k, t in tracker.items() if po and str(t.get("po") or "") == po and not t.get("parent_line_id")]
        same = [k for k in cands if str(tracker[k].get("aop_code") or "").strip().upper() == str(f.get("aop_code") or "").strip().upper()]
        lid = (same or cands or [None])[0]
        if not lid and create:
            from .opex_schema import OPEX_LINE_COLUMNS
            keep = {c["key"] for c in OPEX_LINE_COLUMNS if c.get("role") in ("input", "zmm") and "key" in c} - {"line_id"}
            n = max([int(k.split("-")[1]) for k in tracker if k.startswith("TRK-") and k.split("-")[1].isdigit()] + [0]) + 1
            lid = f"TRK-{n:05d}"
            base = {k: v for k, v in f.items() if k in keep and v not in (None, "")}
            for k, v in f.items():  # the plan year's budget, so the forecast has a daily rate for gaps
                if re.fullmatch(r"B\d\d__.+", k) and v not in (None, ""):
                    base[k] = v
            base.update(line_id=lid, opex_line_id=key, source="Opex sheet")
            await self.engine.bulk_set("opex_tracker", {lid: base}, upsert=True, by=by)
            if self._tracker is not None:
                self._tracker[lid] = base
        if lid and f.get("tracker_line_id") != lid:
            await self.db.aop_rows.update_one({"dataset": "opex_lines", "key": key}, {"$set": {"fields.tracker_line_id": lid}})
        return lid

    # ------------------------------------------------------------------ writing the mapping
    async def _put_links(self, line_id: str, wanted: List[Tuple[str, Optional[str], Optional[str]]], by: str, source: str,
                         current: Dict[str, Dict[str, Any]], add_only: bool) -> Dict[str, int]:
        want_keys = {P.link_key(line_id, po, mat, it): (po, mat, it) for po, mat, it in wanted}
        new = {k: {"line_id": line_id, "po": po, "material": mat or "", "po_item": it or "", "status": P.LINK_ACTIVE,
                   "source": source, "created_at": now_iso(), "created_by": by}
               for k, (po, mat, it) in want_keys.items() if k not in current or current[k].get("status") not in (None, "", P.LINK_ACTIVE)}
        gone = [] if add_only else [k for k in current if k not in want_keys]
        if new:
            await self.engine.bulk_set("po_links", new, upsert=True, by=by)
        if gone:
            await self.db.aop_rows.delete_many({"dataset": "po_links", "key": {"$in": gone}})
        return {"added": len(new), "removed": len(gone)}

    async def set_line_mapping(self, line_id: str, text: Any, by: str, source: str = "Opex sheet",
                               add_only: bool = False) -> Dict[str, Any]:
        """Opex sheet → links of one tracker line. Words instead of POs set the line's mapping status."""
        toks, status, merged = parse_mapping_text(text)
        current = await self.links({"fields.line_id": line_id})
        res = await self._put_links(line_id, toks, by, source, current, add_only or status is not None)
        upd: Dict[str, Any] = {}
        if status:
            upd["mapping_status"] = status
            if merged:
                upd["merged_into_po"] = merged
        elif toks:
            line = (await self.engine.fields("opex_tracker", {"key": line_id})).get(line_id) or {}
            if line.get("mapping_status") in ("Awaiting new PO", "New PO yet to be issued"):
                upd["mapping_status"] = None
        if upd:
            await self.engine.bulk_set("opex_tracker", {line_id: upd}, by=by)
        return {**res, "status": status}

    async def set_item_mapping(self, po: str, item: str, text: Any, by: str, source: str = SHEET_SOURCE,
                               add_only: bool = False) -> Dict[str, Any]:
        """ZMM sheet → the Opex lines one PO item feeds. New links are PO-level when the PO has one item, else for this
        item; removing a line that is linked to the whole PO keeps it on the PO's other items."""
        refs = parse_line_refs(text)
        lines, unknown = [], []
        for ref in refs:
            lid = await self.resolve_line(ref, by)
            (lines if lid else unknown).append(lid or ref)
        if unknown:
            raise ValueError(f"PO {po}: no Opex line {', '.join(unknown)} (use the S. No., TRK-…, OPX-… or a unique AOP code)")
        lines = list(dict.fromkeys(lines))
        items = await self.engine.fields("po_items", {"fields.po": po})
        all_items = sorted({str(f.get("item") or "") for f in items.values()}) or [str(item or "")]
        me = items.get(f"{po}|{item}") or {}
        links = (await self.links_by_po({po})).get(po, [])
        mine = [ln for ln in links if self.covers(ln, item, me.get("material"))]
        current = {ln["line_id"] for ln in mine}
        added = removed = 0
        if not add_only:
            for ln in mine:
                if ln["line_id"] in lines:
                    continue
                await self.db.aop_rows.delete_one({"dataset": "po_links", "key": ln["_key"]})
                removed += 1
                if not ln.get("po_item") and len(all_items) > 1:  # keep it on the other items
                    others = [i for i in all_items if i != str(item)]
                    await self._put_links(ln["line_id"], [(po, ln.get("material") or None, i) for i in others], by,
                                          ln.get("source") or source, {}, True)
        level = None if len(all_items) <= 1 else str(item)
        for lid in lines:
            if lid in current:
                continue
            added += (await self._put_links(lid, [(po, None, level)], by, source, {}, True))["added"]
        return {"added": added, "removed": removed}

    # ------------------------------------------------------------------ corrections from the ZMM sheet
    async def set_correction(self, po: str, item: str, field: str, value: Any, by: str,
                             source: str = SHEET_SOURCE, remarks: str = "Corrected in the ZMM sheet") -> Optional[str]:
        """A value typed over SAP's → the override of this item's open sheet correction (created if needed). The SAP value
        again (or blank) removes that field; an empty override resolves the correction."""
        if field not in CORRECTABLE:
            raise ValueError(f"{field} can't be corrected here")
        item = str(item or "")
        key = f"{po}|{item}"
        it = (await self.engine.fields("po_items", {"key": key})).get(key)
        if not it:
            raise ValueError(f"PO item {po}/{item} is not in the ZMM")
        val = coerce_item_value(field, value)
        sap = it.get(f"accepted_{field}", it.get(field))
        open_ = {k: f for k, f in (await self.engine.fields("po_corrections", {"fields.po": po})).items()
                 if f.get("status") != "Resolved" and f.get("source") in (SHEET_SOURCE, "Opex forecast file")
                 and item in [str(x) for x in (f.get("items") or [])]}
        cid = next(iter(sorted(open_)), None)
        ov = dict((open_.get(cid) or {}).get("override") or {})
        if val is None or same_value(field, val, sap):
            ov.pop(field, None)
        else:
            ov[field] = val
        if field == "net_order_value" and it.get("fx_rate") and str(it.get("currency") or "INR").upper() != "INR":
            if "net_order_value" in ov:
                ov["value_inr"] = round(float(ov["net_order_value"]) * float(it["fx_rate"]), 2)
            else:
                ov.pop("value_inr", None)
        elif field == "net_order_value" and str(it.get("currency") or "INR").upper() == "INR":
            if "net_order_value" in ov:
                ov["value_inr"] = ov["net_order_value"]
            else:
                ov.pop("value_inr", None)
        types = {P.CORRECTION_TYPE.get(f) for f in ov if f != "value_inr"} - {None}
        ctype = next(iter(types)) if len(types) == 1 else "Other"
        if cid is None and not ov:
            return None
        if cid is None:
            cid = await self._next_id()
            snapshot = {f: it.get(f"accepted_{f}", it.get(f)) for f in ov}
            await self.engine.bulk_set("po_corrections", {cid: {
                "line_id": cid, "po": po, "items": [item], "supplier": it.get("supplier_name"), "type": ctype,
                "remarks": remarks, "status": "Open", "source": source, "override": ov, "snapshot": snapshot,
                "created_at": now_iso(), "created_by": by}}, upsert=True, by=by)
            return cid
        upd: Dict[str, Any] = {"override": ov or None, "type": ctype}
        if not ov:
            upd.update(status="Resolved", resolved_on=now_iso()[:10], resolved_by=by,
                       remarks=((open_[cid].get("remarks") or "") + " · back to the SAP value").strip(" ·"))
        await self.engine.bulk_set("po_corrections", {cid: upd}, by=by)
        return cid

    async def _next_id(self) -> str:
        last = [d["key"] async for d in self.db.aop_rows.find({"dataset": "po_corrections"}, {"_id": 0, "key": 1})]
        n = max([int(k.split("-")[-1]) for k in last if k.split("-")[-1].isdigit()] + [0]) + 1
        return f"COR-{n:05d}"

    async def sheet_edit(self, dataset: str, key: str, field: str, value: Any, by: str) -> str:
        """One cell typed / pasted in the ZMM sheet (po_items or po_register) → mapping or correction.
        Returns "mapping" or "correction"."""
        doc = await self.db.aop_rows.find_one({"dataset": dataset, "key": key}, {"_id": 0, "fields": 1})
        if not doc:
            raise ValueError("row not found")
        f = doc.get("fields") or {}
        if dataset == "po_items":
            po, item = str(f.get("po")), str(f.get("item") or "")
            if field == LINES_FIELD:
                await self.set_item_mapping(po, item, value, by)
                return "mapping"
            await self.set_correction(po, item, field, value, by)
            return "correction"
        po, item = str(f.get("purchase_order")), str(f.get("purchase_order_item") or "")
        if field == REGISTER_LINES_FIELD:
            await self.set_item_mapping(po, item, value, by)
            return "mapping"
        if field not in REGISTER_FIELDS:
            raise ValueError("only the mapping and the correctable SAP columns can be changed here")
        await self.set_correction(po, item, REGISTER_FIELDS[field], value, by)
        return "correction"
