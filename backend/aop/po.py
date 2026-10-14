"""SAP PO report (ZMM) → PO items, many-to-many links to Opex lines, allocation, forecast segments and PO review.

Pure functions only (no database) so every rule is unit-tested; the pipeline in ``po_pipeline.py`` does the I/O.

Data model (all in ``aop_rows``)::

    po_register   "{po}|{item}|{n}"            raw ZMM rows, columns exactly as uploaded (replaced per run)
    po_items      "{po}|{item}"                one row per PO item, rebuilt each run; keeps latest_* and accepted_*
    po_triage     "{po}|{item}"                classification / enrichment that survives every run
    po_links      "line_id|po|material|item"   mapping, editable
    po_changes    "{run}|{po}|{item}|{field}"  flagged changes on mapped items
    po_corrections COR-nnnnn                   correction list
    zmm_runs      run_id                       upload log
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .datasets import slug
from .opex_schema import po_str
from .periods import fy_months, to_iso_date

# ---------------------------------------------------------------------------------------------- reading the ZMM
REQUIRED = ["Purchase Order", "Purchase Order Item", "Created On", "Supplier", "Supplier Name", "Material",
            "Material Description", "Currency", "Net Order Value", "WBS Element",
            "Start Date for Period of Performance", "End Date for Period of Performance", "MIGO No.",
            "MIGO Line Item No.", "GRN Posting Date", "Invoice No", "Deletion Indicator",
            "PO Net Price in Group Currency", "GRN Amount in Group Currency", "Invoice Amount in Group Currency"]
# columns the portal adds to the ZMM: recomputed on every run, never read as input
DERIVED_COLUMNS = ["Linked Old PO", "Linked Forecast S.No", "Link Status", "Amount Match", "Active (excl L/S)"]
ENRICH = {"nature_opex_capex_oh": "nature", "department": "department", "category_1_ca_cr": "category",
          "location": "location", "nature_of_services": "nature_of_services"}
DATE_KEYS = ("created_on", "delivery_date", "start_date_for_period_of_performance", "end_date_for_period_of_performance",
             "grn_posting_date", "invoice_posting_date", "invoice_date")
NUMBER_KEYS = ("purchase_order", "purchase_order_item", "supplier", "material", "migo_no", "migo_line_item_no",
               "invoice_no", "purchase_requisition", "pr_no")


def _n(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(v or "").lower())


def num(v: Any) -> float:
    if v is None or isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def d(v: Any) -> Optional[date]:
    s = to_iso_date(v) if v not in (None, "") else None
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def find_zmm_header(rows: List[tuple], scan: int = 12) -> int:
    for i, r in enumerate(rows[:scan]):
        cells = {_n(c) for c in r if isinstance(c, str)}
        if "purchaseorder" in cells and "purchaseorderitem" in cells:
            return i
    raise ValueError("ZMM header not found: expected 'Purchase Order' and 'Purchase Order Item' in the first 12 rows")


def read_zmm(rows: List[tuple]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """(header labels, rows as {slug: value}). Repeated headers get _2, _3 (two 'Currency' columns: currency,
    currency_2 — the PO uses the first). PO, item, supplier and material are digit strings."""
    hi = find_zmm_header(rows)
    header = [str(c).strip() if c is not None else "" for c in rows[hi]]
    have = {_n(h) for h in header}
    missing = [m for m in REQUIRED if _n(m) not in have]
    if missing:
        raise ValueError(f"ZMM report is missing required columns: {', '.join(missing)}")
    keys, seen = [], defaultdict(int)
    for h in header:
        k = slug(h) if h else ""
        if k:
            seen[k] += 1
            if seen[k] > 1:
                k = f"{k}_{seen[k]}"
        keys.append(k)
    out = []
    for r in rows[hi + 1:]:
        f: Dict[str, Any] = {}
        for k, v in zip(keys, r):
            if not k or v is None or v == "" or (isinstance(v, str) and v.strip().startswith("#")):
                continue
            if hasattr(v, "isoformat"):
                v = v.isoformat()[:10]
            elif isinstance(v, str):
                v = v.strip()
            f[k] = v
        if not f.get("purchase_order"):
            continue
        for k in NUMBER_KEYS:
            if k in f:
                f[k] = po_str(f[k])
        for k in DATE_KEYS:
            if k in f:
                f[k] = to_iso_date(f[k]) or f[k]
        if not re.fullmatch(r"\d{6,12}", str(f["purchase_order"])):
            continue  # subtotal / note rows
        out.append(f)
    return [h for h in header if h], out


def register_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """po_register keys ``{po}|{item}|{n}`` (n = occurrence in the file) — the MIGO/invoice key is not unique."""
    n: Dict[Tuple[str, str], int] = defaultdict(int)
    for f in rows:
        k = (f["purchase_order"], str(f.get("purchase_order_item") or ""))
        n[k] += 1
        f["row_n"] = n[k]
        f["_key"] = f"{k[0]}|{k[1]}|{n[k]}"
    return rows


# ---------------------------------------------------------------------------------------------- INR
def to_inr(cur: Any, doc_value: Any, sap_group_value: Any, rate: Optional[float]) -> Tuple[Optional[float], str]:
    """Document-currency value → INR. SAP's group-currency value is used when it looks converted (within 15% of the
    assumption rate), else the assumption rate (flagged), else nothing (flagged, out of the forecast)."""
    cur = str(cur or "").strip().upper()
    doc_value, sap = num(doc_value), num(sap_group_value)
    if cur in ("", "INR"):
        return doc_value, "INR"
    if rate and doc_value and sap and abs(sap / doc_value / rate - 1) <= 0.15:
        return sap, "SAP group currency"
    if rate:
        return doc_value * rate, "FX assumption (SAP not converted)"
    return None, f"No FX rate for {cur}"


FX_FALLBACK = "FX assumption (no rate for the PO date)"


def fx_flagged(source: Any) -> bool:
    """INR value from the FY assumption or not converted at all → Review → Checks."""
    s = str(source or "")
    return s == FX_FALLBACK or s.startswith("No FX")


def _first(f: Dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if f.get(k) not in (None, ""):
            return f[k]
    return None


def fy_impact(value: float, start: Optional[date], end: Optional[date], fy: str, one_day: Optional[date] = None) -> float:
    """Share of a value inside the FY by period days (or the whole value if the one-day date falls in the FY)."""
    ms = fy_months(fy)
    lo = date(int(ms[0][:4]), 4, 1)
    hi = date(int(ms[-1][:4]), 3, 31)
    if start and end and end >= start:
        ov = max(0, (min(end, hi) - max(start, lo)).days + 1)
        return value * ov / ((end - start).days + 1)
    if one_day:
        return value if lo <= one_day <= hi else 0.0
    return 0.0


def build_items(rows: List[Dict[str, Any]], rate_for: Callable[..., Any], plan_fy: str) -> Dict[str, Dict[str, Any]]:
    """One record per PO item from the raw rows. Header fields come from the item's first row; GRN once per
    (MIGO no., MIGO line) and invoices once per invoice no. — the file repeats header values on every GRN row and
    carries pending as a running balance, so neither is summed.

    Amounts are in the PO's currency (Net Order Price / Value, GR Amount In LC, Invoiced Value). INR = amount × the
    exchange rate on the PO date (Created On): ``rate_for(currency, date)`` → (INR per unit, source) or None. SAP's
    group-currency columns are not used for the value — they are converted inconsistently in the report."""
    by_item: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for f in rows:
        by_item[f"{f['purchase_order']}|{f.get('purchase_order_item') or ''}"].append(f)
    out = {}
    for key, rs in by_item.items():
        h = rs[0]
        cur = str(_first(h, "currency") or "INR").strip().upper()
        po_date = d(h.get("created_on"))
        doc_val = num(h.get("net_order_value"))
        qty = num(_first(h, "order_quantity", "quantity", "po_quantity"))
        if cur in ("", "INR"):
            rate, fx_source = 1.0, "INR"
        else:
            got = rate_for(cur, po_date)
            if isinstance(got, tuple):
                rate, fx_source = got
            else:  # a plain rate (assumption)
                rate, fx_source = got, FX_FALLBACK
            if not rate:
                rate, fx_source = None, f"No FX rate for {cur}"
        value_inr = doc_val * rate if rate else None
        grn = invoice = 0.0
        grn_doc = 0.0
        seen_migo, seen_inv = set(), set()
        last_grn = last_inv = None
        for f in rs:
            mk = (f.get("migo_no"), f.get("migo_line_item_no"))
            if mk[0] and mk not in seen_migo:
                seen_migo.add(mk)
                gi = num(f.get("grn_amount_in_group_currency"))
                gd = num(_first(f, "gr_amount_in_lc"))  # in the PO's currency
                if cur in ("", "INR"):
                    grn += gd or gi
                elif rate:
                    grn += gd * rate
                grn_doc += gd
                gd_ = f.get("grn_posting_date")
                if gd_ and (last_grn is None or str(gd_) > last_grn):
                    last_grn = str(gd_)[:10]
            ik = f.get("invoice_no")
            if ik and ik not in seen_inv:
                seen_inv.add(ik)
                ii = num(f.get("invoice_amount_in_group_currency"))
                idoc = num(_first(f, "invoiced_value_base_value", "invoice_amount"))  # in the PO's currency
                if cur in ("", "INR"):
                    invoice += idoc or ii
                elif rate:
                    invoice += idoc * rate
                idt = _first(f, "invoice_posting_date", "invoice_date")
                if idt and (last_inv is None or str(idt) > last_inv):
                    last_inv = str(idt)[:10]
        ps, pe = d(h.get("start_date_for_period_of_performance")), d(h.get("end_date_for_period_of_performance"))
        deletion = str(h.get("deletion_indicator") or "").strip().upper()
        active = deletion not in ("L", "S")
        delivery = d(h.get("delivery_date"))
        created = d(h.get("created_on"))
        po, item = key.split("|", 1)
        rec = {
            "po": po, "item": item, "material": po_str(h.get("material")),
            "material_description": h.get("material_description"),
            "supplier_code": po_str(h.get("supplier")), "supplier_name": h.get("supplier_name"),
            "created_on": created.isoformat() if created else None,
            "pr_no": po_str(_first(h, "purchase_requisition", "pr_no", "pr_number", "purchase_req_no")),
            "plant": _first(h, "plant"), "purchasing_group": _first(h, "purchasing_group"),
            "gl": po_str(_first(h, "g_l_account", "gl_account", "g_l_account_no", "gl")),
            "wbs": h.get("wbs_element"), "delivery_date": delivery.isoformat() if delivery else None,
            "currency": cur or "INR", "quantity": qty or None, "net_order_value": doc_val,
            "net_price": num(_first(h, "net_order_price", "net_price", "po_net_price")) or None,
            "fx_rate": rate if cur not in ("", "INR") else None, "fx_date": po_date.isoformat() if po_date and cur not in ("", "INR") else None,
            "aop_code": _first(h, "short_id_wbs_elem", "short_id"), "wbs_name": _first(h, "wbs_element_name"),
            "material_type": _first(h, "material_type_desc", "material_type"),
            "value_inr": round(value_inr, 2) if value_inr is not None else None, "fx_source": fx_source,
            "period_start": ps.isoformat() if ps else None, "period_end": pe.isoformat() if pe else None,
            "period_missing": not (ps and pe), "active": active, "deletion_indicator": deletion or None,
            "grn_inr": round(grn, 2), "last_grn_date": last_grn, "invoiced_inr": round(invoice, 2),
            "last_invoice_date": last_inv, "rows": len(rs), "in_latest_zmm": True,
        }
        v = rec["value_inr"] or 0.0
        rec["pending_inr"] = round(max(0.0, v - grn), 2)
        rec["grn_pct"] = round(grn / v, 4) if v else None
        rec["fy_impact_inr"] = round(fy_impact(v, ps, pe, plan_fy, delivery or created), 2) if active else 0.0
        out[key] = rec
    return out


def final_values(rows: List[Dict[str, Any]]) -> None:
    """Final Value = Net Order Value / rows of that PO item (0 if deleted) — written back onto po_register."""
    cnt: Dict[str, int] = defaultdict(int)
    for f in rows:
        cnt[f"{f['purchase_order']}|{f.get('purchase_order_item') or ''}"] += 1
    for f in rows:
        k = f"{f['purchase_order']}|{f.get('purchase_order_item') or ''}"
        dele = str(f.get("deletion_indicator") or "").strip().upper() in ("L", "S")
        f["final_value"] = 0.0 if dele else round(num(f.get("net_order_value")) / cnt[k], 2)


# ---------------------------------------------------------------------------------------------- accepted vs latest
# fields compared between runs; ``SILENT`` changes are applied without review
TRACKED = ["active", "in_latest_zmm", "period_start", "period_end", "net_order_value", "quantity", "net_price",
           "currency", "value_inr", "wbs", "supplier_code", "supplier_name", "material", "delivery_date",
           "fx_source", "material_description"]
FLAGGED = ["active", "in_latest_zmm", "period_start", "period_end", "net_order_value", "quantity", "net_price",
           "currency", "wbs", "supplier_code", "material", "delivery_date"]
FIELD_LABEL = {"active": "Item deleted / blocked", "in_latest_zmm": "Item missing from the report",
               "period_start": "Period start", "period_end": "Period end", "net_order_value": "Net order value",
               "quantity": "Quantity", "net_price": "Price", "currency": "Currency", "wbs": "WBS",
               "supplier_code": "Supplier", "material": "Material", "delivery_date": "Delivery date",
               "item_added": "Item added to the PO"}
# which correction type a rejected field raises
CORRECTION_TYPE = {"period_start": "Missing / wrong period", "period_end": "Missing / wrong period",
                   "net_order_value": "Wrong value / qty", "quantity": "Wrong value / qty", "net_price": "Wrong value / qty",
                   "currency": "Wrong currency / FX", "wbs": "Wrong WBS", "supplier_code": "Wrong supplier",
                   "active": "Should be deleted", "in_latest_zmm": "Other", "material": "Other",
                   "delivery_date": "Missing / wrong period", "item_added": "Other"}
CORRECTION_TYPES = ["Wrong WBS", "Wrong GL", "Missing / wrong period", "Wrong value / qty", "Wrong currency / FX",
                    "Wrong supplier", "Duplicate PO", "Should be deleted", "Other"]
# the ZMM fields a correction type is about (a change there → "Possibly resolved")
CORRECTION_FIELDS = {"Wrong WBS": ["wbs"], "Wrong GL": ["gl"], "Missing / wrong period": ["period_start", "period_end", "delivery_date"],
                     "Wrong value / qty": ["net_order_value", "quantity", "net_price"], "Wrong currency / FX": ["currency", "value_inr"],
                     "Wrong supplier": ["supplier_code", "supplier_name"], "Duplicate PO": ["active"], "Should be deleted": ["active"],
                     "Other": []}


def _same(field: str, a: Any, b: Any) -> bool:
    if field in ("net_order_value", "quantity", "net_price", "value_inr"):
        return abs(num(a) - num(b)) < 1  # "≥ 1 unit change" flags
    return (a if a not in ("", None) else None) == (b if b not in ("", None) else None)


def merge_item(new: Dict[str, Any], prev: Optional[Dict[str, Any]], in_scope: bool, mode: str = "hold") -> Dict[str, Any]:
    """Item record for this run: ``latest_<f>`` from the file; ``accepted_<f>`` kept from the previous run when the
    item is in review scope (linked or triaged), else the latest values. A first sight (no previous) accepts all."""
    out = dict(new)
    for f in TRACKED:
        out[f"latest_{f}"] = new.get(f)
        if prev and in_scope and mode == "hold" and f"accepted_{f}" in prev:
            out[f"accepted_{f}"] = prev.get(f"accepted_{f}")
        else:
            out[f"accepted_{f}"] = new.get(f)
    return out


def missing_item(prev: Dict[str, Any], in_scope: bool, mode: str = "hold") -> Dict[str, Any]:
    """An item that disappeared from the report (kept only when linked or triaged)."""
    out = dict(prev)
    out["in_latest_zmm"] = False
    out["latest_in_latest_zmm"] = False
    if not in_scope or mode != "hold":
        out["accepted_in_latest_zmm"] = False
    return out


def effective(item: Dict[str, Any], override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The values links and the forecast use: correction override > accepted > latest."""
    out = dict(item)
    for f in TRACKED:
        if f"accepted_{f}" in item:
            out[f] = item[f"accepted_{f}"]
    for k, v in (override or {}).items():
        if v not in (None, ""):
            out[k] = v
    if out.get("in_latest_zmm") is False:
        out["active"] = False
    return out


def diff_item(item: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flagged differences latest vs accepted (GRN, invoice, pending, PR / approver changes are never compared; an INR
    change with the document value unchanged is an exchange-rate change and silent)."""
    out = []
    for f in FLAGGED:
        a, b = item.get(f"accepted_{f}"), item.get(f"latest_{f}")
        if f == "delivery_date" and not item.get("period_missing"):
            continue  # delivery date matters only for one-time items without a service period
        if not _same(f, a, b):
            out.append({"field": f, "old": a, "new": b})
    return out


def fx_only_change(item: Dict[str, Any]) -> bool:
    return (_same("net_order_value", item.get("accepted_net_order_value"), item.get("latest_net_order_value"))
            and not _same("value_inr", item.get("accepted_value_inr"), item.get("latest_value_inr")))


def accept_fields(item: Dict[str, Any], fields: Iterable[str]) -> Dict[str, Any]:
    """accepted_* ← latest_* for these fields (value_inr / fx_source follow the value or currency)."""
    upd = {}
    fields = set(fields)
    if fields & {"net_order_value", "quantity", "net_price", "currency"}:
        fields |= {"value_inr", "fx_source"}
    if "supplier_code" in fields:
        fields.add("supplier_name")
    if "material" in fields:
        fields.add("material_description")
    for f in fields:
        if f in TRACKED:
            upd[f"accepted_{f}"] = item.get(f"latest_{f}")
    return upd


# ---------------------------------------------------------------------------------------------- tokens and status text
TOKEN = re.compile(r"^(\d{8,12})(?:[_\-/](\d{6,12}))?$")
STATUS_TEXT = [("not migrated", "Not migrated (old PO continues outside SAP)"), ("not required", "Not required"),
               ("yet to be issued", "New PO yet to be issued"), ("merged", "Merged into another PO"),
               ("not present in aop", "Not in AOP – discuss")]


def parse_po_tokens(text: Any) -> Tuple[List[Tuple[str, Optional[str]]], List[str]]:
    """'4400000018_9700001103, 4400000019' → [('4400000018', '9700001103'), ('4400000019', None)], leftover text."""
    if text in (None, ""):
        return [], []
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return [(po_str(text), None)], []
    links, rest = [], []
    for tok in re.split(r"[,;\s]+", str(text).strip()):
        tok = tok.strip()
        if not tok:
            continue
        m = TOKEN.match(po_str(tok) or tok)
        if m:
            links.append((m.group(1), m.group(2)))
        else:
            rest.append(tok)
    return links, rest


def status_from_text(text: Any) -> Tuple[Optional[str], Optional[str]]:
    """Mapping status from the old mapping text: (status, merged-into PO)."""
    s = str(text or "").strip()
    if not s:
        return "Awaiting new PO", None
    low = s.lower()
    for needle, status in STATUS_TEXT:
        if needle in low:
            merged = None
            if status == "Merged into another PO":
                m = re.search(r"\d{8,12}", s)
                merged = m.group(0) if m else None
            return status, merged
    return "Agreement / outside SAP", None


# ---------------------------------------------------------------------------------------------- links
LINK_ACTIVE = "Active"


def link_key(line_id: str, po: str, material: Optional[str] = None, item: Optional[str] = None) -> str:
    return f"{line_id}|{po}|{material or ''}|{item or ''}"


def resolve(links: List[Dict[str, Any]], items: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """For every link: the item keys it covers (§6.1) and flags. ``items`` are effective item values keyed "po|item".

    1. ``po_item`` set → that item; 2. else ``material`` set → the PO's items with that material; 3. else (PO-to-PO)
    → the PO's items not claimed by a material- or item-level active link on any line (remainder rule). Inactive
    items are dropped."""
    by_po: Dict[str, List[str]] = defaultdict(list)
    for k, it in items.items():
        by_po[it["po"]].append(k)
    claimed: Dict[str, set] = defaultdict(set)
    for ln in links:
        if ln.get("status", LINK_ACTIVE) != LINK_ACTIVE:
            continue
        po = str(ln.get("po") or "")
        if ln.get("po_item"):
            claimed[po].add(f"{po}|{ln['po_item']}")
        elif ln.get("material"):
            claimed[po] |= {k for k in by_po.get(po, []) if items[k].get("material") == str(ln["material"])}
    out = {}
    for ln in links:
        po = str(ln.get("po") or "")
        flags = []
        keys = by_po.get(po, [])
        if not keys:
            flags.append("PO not in ZMM")
        if ln.get("po_item"):
            cov = [k for k in keys if k == f"{po}|{ln['po_item']}"]
        elif ln.get("material"):
            cov = [k for k in keys if items[k].get("material") == str(ln["material"])]
            if keys and not cov:
                flags.append("Material not on this PO")
        else:
            cov = [k for k in keys if k not in claimed.get(po, set())]
        active = [k for k in cov if items[k].get("active", True)]
        if cov and not active:
            flags.append("All items deleted/blocked")
        out[ln["_key"]] = {"items": active, "flags": flags, "multi_item_po": len(keys) > 1}
    return out


def allocate(links: List[Dict[str, Any]], cover: Dict[str, Dict[str, Any]], line_weights: Dict[str, Dict[str, float]],
             history: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> Dict[str, Dict[str, Any]]:
    """Allocation % only where one PO item feeds several lines (§6.2). Returns {link_key: {alloc_pct, alloc_auto,
    checks[]}} for the links whose values the system sets or flags; a user-entered % is never changed.

    ``line_weights`` = {line_id: {"budget": B<plan>__annual, "net_po": ...}}; ``history`` = {line_id: earlier links
    (newest first, with their alloc_pct and item set)} for reusing the last split on a renewal."""
    act = [ln for ln in links if ln.get("status", LINK_ACTIVE) == LINK_ACTIVE and cover.get(ln["_key"], {}).get("items")]
    by_item: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for ln in act:
        for k in cover[ln["_key"]]["items"]:
            by_item[k].append(ln)
    groups: Dict[frozenset, List[Dict[str, Any]]] = {}
    for k, lns in by_item.items():
        if len({ln["line_id"] for ln in lns}) < 2:
            continue
        groups.setdefault(frozenset(ln["_key"] for ln in lns), lns)
    out: Dict[str, Dict[str, Any]] = {}
    for _, lns in groups.items():
        user = [ln for ln in lns if ln.get("alloc_pct") not in (None, "") and not ln.get("alloc_auto")]
        auto = [ln for ln in lns if ln not in user]
        multi = any(cover[ln["_key"]].get("multi_item_po") and not ln.get("material") and not ln.get("po_item") for ln in lns)
        checks = ["Multi-item PO split by % — map each line by material / PO item instead"] if multi else []
        user_sum = sum(float(ln["alloc_pct"]) for ln in user)
        if not auto:
            if not 0.995 <= user_sum <= 1.005:
                for ln in lns:
                    out[ln["_key"]] = {"checks": checks + [f"Allocation sums to {user_sum:.1%}"]}
            elif checks:
                for ln in lns:
                    out[ln["_key"]] = {"checks": checks}
            continue
        remaining = max(0.0, 1.0 - user_sum)
        weights = _reuse_split(auto, history or {}) or _weights(auto, line_weights)
        tot = sum(weights.values()) or 1.0
        for ln in auto:
            pct = round(remaining * weights[ln["_key"]] / tot, 4)
            out[ln["_key"]] = {"alloc_pct": pct, "alloc_auto": True,
                               "checks": checks + ["Auto-split allocation — confirm or edit the %"]}
        if user and not 0.995 <= user_sum + remaining <= 1.005:
            for ln in lns:
                out.setdefault(ln["_key"], {"checks": []})["checks"].append(f"Allocation sums to {user_sum:.1%}")
        for ln in user:
            out.setdefault(ln["_key"], {"checks": list(checks)})
    return out


def _weights(lns: List[Dict[str, Any]], line_weights: Dict[str, Dict[str, float]]) -> Dict[str, float]:
    for basis in ("budget", "net_po"):
        w = {ln["_key"]: max(0.0, num((line_weights.get(ln["line_id"]) or {}).get(basis))) for ln in lns}
        if sum(w.values()) > 0:
            return w
    return {ln["_key"]: 1.0 for ln in lns}


def _reuse_split(lns: List[Dict[str, Any]], history: Dict[str, List[Dict[str, Any]]]) -> Optional[Dict[str, float]]:
    """If these same lines shared the previous PO item (each line's latest earlier link was one shared item), reuse
    that split."""
    prev = {}
    for ln in lns:
        h = [x for x in history.get(ln["line_id"], []) if x.get("po") != ln.get("po")]
        if not h:
            return None
        prev[ln["_key"]] = h[0]
    items = {tuple(sorted(p.get("items") or [])) for p in prev.values()}
    if len(items) != 1 or not next(iter(items)):
        return None
    if any(p.get("alloc_pct") in (None, "") for p in prev.values()):
        return None
    return {k: float(p["alloc_pct"]) for k, p in prev.items()}


# ---------------------------------------------------------------------------------------------- segments
def segments(line: Dict[str, Any], links: List[Dict[str, Any]], cover: Dict[str, Dict[str, Any]],
             items: Dict[str, Dict[str, Any]], alloc: Optional[Dict[str, Dict[str, Any]]] = None
             ) -> Tuple[List[Tuple[float, date, date]], List[Dict[str, Any]], List[str]]:
    """Forecast segments (amount, start, end) of a line from its active links, plus per-segment detail and flags.
    amount = effective value_inr × (alloc_pct or 1); start / end = coverage dates if set, else the item period.
    Without a period a One-Time line gets a one-day segment on the delivery date (else created on); a Recurring
    line gets none and the check "No service period"."""
    recurring = str(line.get("recurring") or "").lower().startswith("recurring")
    segs, detail, flags = [], [], []
    for ln in links:
        if ln.get("status", LINK_ACTIVE) != LINK_ACTIVE:
            continue
        a = (alloc or {}).get(ln["_key"], {})
        pct = a.get("alloc_pct", ln.get("alloc_pct"))
        pct = 1.0 if pct in (None, "") else float(pct)
        for k in cover.get(ln["_key"], {}).get("items", []):
            it = items[k]
            if it.get("value_inr") is None:
                flags.append(f"{k}: no INR value ({it.get('fx_source')})")
                continue
            amt = float(it["value_inr"]) * pct
            s = d(ln.get("coverage_from")) or d(it.get("period_start"))
            e = d(ln.get("coverage_to")) or d(it.get("period_end"))
            has_period = bool(s and e)
            if not (s and e):
                if recurring:
                    flags.append(f"{k}: no service period")
                    # no forecast segment, but the PO still counts for latest / old PO (ordered by its PO date)
                    detail.append({"link": ln["_key"], "item": k, "po": it["po"], "amount": 0.0, "no_segment": True,
                                   "value": round(amt, 2), "start": None, "end": None, "has_period": False, "alloc_pct": pct,
                                   "supplier_code": it.get("supplier_code"), "supplier_name": it.get("supplier_name"),
                                   "created_on": it.get("created_on"), "grn_inr": it.get("grn_inr"),
                                   "value_inr": it.get("value_inr"), "pr_no": it.get("pr_no")})
                    continue
                one = d(it.get("delivery_date")) or d(it.get("created_on"))
                if not one:
                    flags.append(f"{k}: no date")
                    continue
                s = e = one
            if e < s:
                flags.append(f"{k}: period ends before it starts")
                continue
            segs.append((amt, s, e))
            detail.append({"link": ln["_key"], "item": k, "po": it["po"], "amount": round(amt, 2), "value": round(amt, 2),
                           "has_period": has_period, "start": s.isoformat(),
                           "end": e.isoformat(), "alloc_pct": pct, "supplier_code": it.get("supplier_code"),
                           "supplier_name": it.get("supplier_name"), "created_on": it.get("created_on"),
                           "grn_inr": it.get("grn_inr"), "value_inr": it.get("value_inr"), "pr_no": it.get("pr_no")})
    return segs, detail, flags


def fy_amount(segs: List[Tuple[float, date, date]], fy: str) -> float:
    return sum(fy_impact(a, s, e, fy) for a, s, e in segs)


# ---------------------------------------------------------------------------------------------- latest / previous PO
def latest_previous(line: Dict[str, Any], detail: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Latest = the linked PO whose service period starts last (a PO without a service period is placed by its PO
    date; tie → higher allocated value); previous (old) = the next PO in that order with a different number, else the
    line's own PO. Both come with supplier, amount and service start / end for the sheet."""
    by_po: Dict[str, Dict[str, Any]] = {}
    for x in detail:
        e = by_po.setdefault(x["po"], {"po": x["po"], "start": None, "end": None, "value": 0.0, "grn": 0.0,
                                       "supplier_code": x.get("supplier_code"), "has_period": False,
                                       "supplier_name": x.get("supplier_name"), "pr_no": x.get("pr_no"),
                                       "created_on": x.get("created_on")})
        e["value"] += x.get("value", x["amount"])
        e["grn"] += num(x.get("grn_inr")) * x.get("alloc_pct", 1)
        if x.get("start"):
            e["start"] = min(e["start"], x["start"]) if e["start"] else x["start"]
            e["end"] = max(e["end"], x["end"]) if e["end"] else x["end"]
        e["has_period"] = e["has_period"] or bool(x.get("has_period", bool(x.get("start"))))
        if x.get("created_on") and (not e.get("created_on") or x["created_on"] < e["created_on"]):
            e["created_on"] = x["created_on"]
    when = lambda e: (e["start"] if e["has_period"] and e["start"] else e.get("created_on") or e["start"] or "")  # noqa: E731
    order = sorted(by_po.values(), key=lambda e: (when(e), e["value"]), reverse=True)
    own = line.get("po")
    own_details = {"supplier": line.get("supplier_name") or line.get("vendor"),
                   "value": line.get("net_po") or line.get("po_amount"), "start": line.get("po_start"), "end": line.get("po_end")}
    if not order:
        return {"latest_po": own, "previous_po": None, "active_po_count": 0, "latest_pr": None,
                "latest_po_supplier": own_details["supplier"], "latest_po_value_inr": own_details["value"],
                "latest_po_start": own_details["start"], "latest_po_end": own_details["end"],
                "previous_po_supplier": None, "previous_po_value_inr": None, "previous_po_start": None, "previous_po_end": None}
    lt = order[0]
    prev_e = next((e for e in order[1:] if e["po"] != lt["po"]), None)
    prev = prev_e["po"] if prev_e else (own if own != lt["po"] else None)
    if prev_e:
        pd_ = {"supplier": prev_e.get("supplier_name"), "value": round(prev_e["value"], 2), "start": prev_e["start"], "end": prev_e["end"]}
    elif prev:
        pd_ = own_details
    else:
        pd_ = {"supplier": None, "value": None, "start": None, "end": None}
    old_sup = (str(line.get("supplier_code") or "").strip(), _norm_name(line.get("supplier_name") or line.get("vendor")))
    changed = None
    if lt.get("supplier_code") and old_sup[0]:
        changed = lt["supplier_code"] != old_sup[0]
    elif lt.get("supplier_name") and old_sup[1]:
        changed = _norm_name(lt["supplier_name"]) != old_sup[1]
    return {"latest_po": lt["po"], "previous_po": prev, "latest_pr": lt.get("pr_no"),
            "latest_po_supplier": lt.get("supplier_name"), "latest_po_value_inr": round(lt["value"], 2),
            "latest_po_start": lt["start"], "latest_po_end": lt["end"],
            "latest_po_grn_pct": round(lt["grn"] / lt["value"], 4) if lt["value"] else None,
            "previous_po_supplier": pd_["supplier"], "previous_po_value_inr": pd_["value"],
            "previous_po_start": pd_["start"], "previous_po_end": pd_["end"],
            "active_po_count": len(order), "supplier_changed": ("Yes" if changed else "No") if changed is not None else None,
            "po_order": [e["po"] for e in order]}


def _norm_name(s: Any) -> str:
    s = re.sub(r"[^a-z0-9]+", "", str(s or "").lower())
    for suffix in ("privatelimited", "pvtltd", "limited", "ltd", "llp", "inc", "sa"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
    return s


def daily_rate(amount: Any, start: Any, end: Any) -> Optional[float]:
    s, e = d(start), d(end)
    if not (s and e) or e < s or not num(amount):
        return None
    return num(amount) / ((e - s).days + 1)


def rate_mismatch(line: Dict[str, Any], detail: List[Dict[str, Any]], tol: float = 0.25) -> Optional[str]:
    """New daily rate vs old PO daily rate differ by more than 25% (rates, not totals)."""
    old = daily_rate(line.get("net_po") or line.get("po_amount"), line.get("po_start"), line.get("po_end"))
    if not old or not detail:
        return None
    lt = latest_previous(line, detail)
    new = daily_rate(lt.get("latest_po_value_inr"), lt.get("latest_po_start"), lt.get("latest_po_end"))
    if new and abs(new / old - 1) > tol:
        return f"Rate mismatch: new PO ₹{new:,.0f}/day vs old ₹{old:,.0f}/day ({new / old - 1:+.0%})"
    return None


# ---------------------------------------------------------------------------------------------- triage
DEFAULT_PREFIX = {"WOIN": "Opex", "WSIN": "Opex", "WCIN": "Capex", "VHDC": "Overheads", "WSEG": "Overheads",
                  "UOVD": "Overheads"}
TYPES = ["Opex", "Capex", "Overheads", "Payroll", "Mapping not required", "Needs correction"]
NOT_REQUIRED_REASONS = ["No FY impact", "Deleted / blocked", "Duplicate", "Not WAISL cost", "Other"]


def type_from_wbs(wbs: Any, prefix_map: Optional[Dict[str, str]] = None, nature: Any = None) -> Optional[str]:
    """Pre-filled type: the uploaded 'Nature (Opex/Capex/OH)' wins, else the WBS prefix."""
    n = str(nature or "").strip().lower()
    if n:
        if n.startswith("opex"):
            return "Opex"
        if n.startswith("capex"):
            return "Capex"
        if n in ("oh", "overhead", "overheads") or n.startswith("overhead"):
            return "Overheads"
        if n.startswith("payroll"):
            return "Payroll"
    w = str(wbs or "").strip().upper()
    for p, t in (prefix_map or DEFAULT_PREFIX).items():
        if w.startswith(p.upper()):
            return t
    return None


def suggest_lines(item: Dict[str, Any], lines: List[Dict[str, Any]], top: int = 3) -> List[Dict[str, Any]]:
    """Score tracker lines for an Opex renewal: same AOP code (ZMM Short ID) +2, same WBS +2, same supplier as the line's latest or old supplier +2,
    same Location +1, daily rate within ±25% of the line's latest / old rate +1, line awaiting a new PO +1."""
    out = []
    rate = daily_rate(item.get("value_inr"), item.get("period_start"), item.get("period_end"))
    for ln in lines:
        score, why = 0, []
        code = str(item.get("aop_code") or "").strip().upper()
        if code and code == str(ln.get("aop_code") or "").strip().upper():
            score += 2; why.append("same AOP code")
        if item.get("wbs") and str(ln.get("wbs") or "").strip() == str(item["wbs"]).strip():
            score += 2; why.append("same WBS")
        sups = {str(ln.get("supplier_code") or ""), str(ln.get("latest_po_supplier_code") or "")} - {""}
        if item.get("supplier_code") and item["supplier_code"] in sups:
            score += 2; why.append("same supplier")
        elif item.get("supplier_name") and _norm_name(item["supplier_name"]) in {_norm_name(ln.get("supplier_name")),
                                                                               _norm_name(ln.get("vendor")),
                                                                               _norm_name(ln.get("latest_po_supplier"))} - {""}:
            score += 2; why.append("same supplier")
        loc = str(item.get("location") or "").strip().lower()
        if loc and loc == str(ln.get("tag") or "").strip().lower():
            score += 1; why.append("same location")
        lr = daily_rate(ln.get("latest_po_value_inr"), ln.get("latest_po_start"), ln.get("latest_po_end")) or \
            daily_rate(ln.get("net_po") or ln.get("po_amount"), ln.get("po_start"), ln.get("po_end"))
        if rate and lr and abs(rate / lr - 1) <= 0.25:
            score += 1; why.append("similar daily rate")
        if ln.get("mapping_status") == "Awaiting new PO":
            score += 1; why.append("awaiting new PO")
        if score:
            out.append({"line_id": ln.get("line_id"), "score": score, "reason": ", ".join(why),
                        "aop_code": ln.get("aop_code"), "vendor": ln.get("vendor") or ln.get("supplier_name"),
                        "po": ln.get("po"), "tag": ln.get("tag")})
    out.sort(key=lambda x: -x["score"])
    return out[:top]


def addon_line_id(parent: str, existing: Iterable[str]) -> str:
    ex = set(existing)
    n = 1
    while f"{parent}-A{n}" in ex:
        n += 1
    return f"{parent}-A{n}"


def period_days(start: Any, end: Any) -> Optional[int]:
    s, e = d(start), d(end)
    return (e - s).days + 1 if s and e and e >= s else None


def recurring_from_period(start: Any, end: Any) -> str:
    n = period_days(start, end)
    return "Recurring" if n and n >= 90 else "One-Time"


def plus_days(v: Any, n: int) -> Optional[str]:
    x = d(v)
    return (x + timedelta(days=n)).isoformat() if x else None
