"""The one Opex line layout (refined ``Opex_Raw Data`` format) shared by ``opex_lines`` and ``opex_tracker``.

Import, upload, download, migration and the grid's column list all read ``OPEX_LINE_COLUMNS``, so the two datasets
can never drift apart again. Each column is ``{key, label, type, role, aliases}``:

* ``role`` — ``key`` (line id), ``input`` (editable, uploaded), ``zmm`` (filled from the SAP PO report for SAP POs,
  editable for legacy POs), ``computed`` (read-only, ignored on upload, written on download) or ``system``.
* ``aliases`` — other headers accepted on import (the one-time ``Opex_Forecast`` load). The first match wins, so the
  order of ``match`` matters; a header already claimed by another column is never reused.

FY-labelled headers (month blocks, ``YTD <Mon'yy>``, ``Total FY'yy``, ``Carry Forward in FYyy (Yes/No)``,
``Budgeted FY'yy``) are matched by pattern and generated from the config, never hard-coded.

Which FY a block means depends on the dataset::

    dataset        "current FY" months                          "next FY" block
    opex_lines     base_fy  (A to the cut-off, F after)          plan_fy  (B)
    opex_tracker   plan_fy  (F, computed by the forecast engine)  draft_fy (B, Ops inputs)
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from .datasets import coerce, column, vkey
from .periods import fy_months, fy_of_period, period_label, shift_fy, to_iso_date, to_period


def _n(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(v or "").lower())


def C(key, label, ctype="text", role="input", aliases=(), match=None, editable=True, hidden=False):
    return {"key": key, "label": label, "type": ctype, "role": role, "aliases": list(aliases),
            "match": list(match) if match else [label, *aliases], "editable": editable, "hidden": hidden}


# Markers inside the column list where the FY-labelled blocks go
CUR_MONTHS, CUR_YTD, CUR_TOTAL, CARRY, NEXT_MONTHS, NEXT_BUDGET, CUR_BUDGET = (
    "@cur_months", "@cur_ytd", "@cur_total", "@carry", "@next_months", "@next_budget", "@cur_budget")

OPEX_LINE_COLUMNS: List[Dict[str, Any]] = [
    C("line_id", "Line ID", role="key", match=["Line ID"], editable=False),
    C("aop_code", "AOP Code"),
    C("wbs", "WBS Element", aliases=["WBS Element_Old"], match=["WBS Element", "WBS Element_Old"]),
    C("wbs_l1", "WBS-L1"),
    C("wbs_desc", "WBS Description", match=["WBS Name (Nature)", "WBS Description"]),
    C("wbs_l1_desc", "WBS L-1 Description", match=["WBS L-1 Description", "WBS Description"]),
    C("cost_centre", "Cost centre 1"),
    C("gl_code", "GL Code"),
    C("gl_name", "GL Name"),
    C("project_id", "Manual Project ID", aliases=["Project ID"]),
    C("project_name", "Project Name"),
    C("geo", "P&L Head"),
    C("region", "P&L Region"),
    C("grouping", "Project Grouping"),
    C("airport_type", "Airport/Non-Airport"),
    C("tag", "Location", match=["Reporting Tag", "Location"]),
    C("category", "Category - 1 (CA/CR/Others)"),
    C("category2", "Category - 2 (Digital/Non-Digital)"),
    C("bau_growth", "Retro P&L Tagging"),
    C("retro_location", "Retro P&L Location"),
    C("po", "PO", aliases=["Old PO_Unique", "PO_As per Atul Sheet"]),
    C("po_date", "Date of PO issue", "date", role="zmm"),
    C("supplier_code", "SAP Supplier Code", role="zmm", aliases=["Supplier Code"]),
    C("supplier_name", "SAP Supplier Name", role="zmm", aliases=["Vendor Name"]),
    C("vendor_code", "Supplier Code Unique"),
    C("vendor", "Supplier Name_Unique", aliases=["Vendor Name_Override"]),
    C("po_description", "PO Expense Description", role="zmm", aliases=["Nature of the PO"]),
    C("material_type", "Material Type (GRN/SRN)", role="zmm"),
    C("po_start", "PO Start Date", "date", role="zmm"),
    C("po_end", "PO End Date", "date", role="zmm"),
    C("tech_refresh_date", "Expected Tech-Refresh Date", "date"),
    C("material", "Material Code"),
    C("material_description", "SAP Material Description", role="zmm"),
    C("package_l1", "Package L-1"),
    C("package_l2", "Package L-2"),
    C("package_l3", "Package L-3"),
    C("nature_of_expense", "Nature of Expense"),
    C("qty", "Qty", "number", role="zmm"),
    C("rate", "Rate", "number", role="zmm"),
    C("currency", "Currency", role="zmm", aliases=["CURRENCY"]),
    C("po_amount_doc", "PO Amount", "number", role="zmm", match=["ForEx Amount", "PO Amount"]),
    C("po_amount", "PO AMOUNT (INR)", "number", role="zmm", aliases=["PO AMOUNT"]),
    C("net_po", "Net PO (INR)", "number", aliases=["Net PO"]),
    C("recurring", "PO Nature"),
    C("pr_no", "PR No.", role="zmm"),
    C("latest_pr", "New PR", role="computed", match=["New PR"], editable=False),
    C("previous_po", "Old PO No.", role="computed", match=["Old PO No."], editable=False),
    C("latest_po", "New PO No.", role="computed", match=["New PO No."], editable=False),
    {"key": CUR_MONTHS}, {"key": CUR_YTD}, {"key": CUR_TOTAL}, {"key": CARRY},
    C("expected_start", "Expected Start Date"),
    C("expected_close", "Expected Close Date"),
    C("increment_pct", "% increment", "percent"),
    {"key": NEXT_MONTHS}, {"key": NEXT_BUDGET},
    C("variance", "Variance", "number", role="computed", editable=False),
    C("br_price_escalation", "Price Escalation", "number"),
    C("br_timing", "Timing Difference", "number"),
    C("br_scope", "Change in Scope/BOM/SLA", "number"),
    C("br_post_dlp", "Renewal Post DLP Warranty", "number"),
    C("br_spares", "Spares Requirement", "number"),
    C("br_forex", "Increase due to ForEx", "number"),
    C("br_new_ca", "Increase due to New CA", "number"),
    C("br_pax", "Increase due to PAX Count", "number"),
    C("br_wipro_opt", "Wipro Optimization", "number"),
    C("br_optimization", "Optimization", "number"),
    C("br_others", "Others/Reduction", "number"),
    C("bridge_check", "Bridge check", "number", role="computed", editable=False),
    C("ops_remarks", "Ops team's Detailed Remarks"),
    C("finance_remarks", "Finance team Remarks", editable=False),
    C("owner", "Ops POC Tag", aliases=["Owner Name"]),
    C("po_link", "PO Link"),
]

TRACKER_ONLY_COLUMNS: List[Dict[str, Any]] = [
    C("parent_line_id", "Parent line ID", role="system", editable=False),
    {"key": CUR_BUDGET},
    C("budget_vs_forecast", "Budget − forecast", "number", role="computed", editable=False),
    C("mapping_status", "Mapping status", match=["Mapping status"]),
    C("merged_into_po", "Merged into PO"),
    C("override_amount", "Override amount", "number", aliases=["Override Amount (INPUT)"]),
    C("override_start", "Override start", "date", aliases=["Override Start (INPUT)"]),
    C("override_end", "Override end", "date", aliases=["Override End (INPUT)"]),
    C("latest_po_supplier", "Latest PO supplier", role="computed", editable=False),
    C("latest_po_value_inr", "Latest PO value (INR)", "number", role="computed", editable=False),
    C("latest_po_start", "Latest PO start", "date", role="computed", editable=False),
    C("latest_po_end", "Latest PO end", "date", role="computed", editable=False),
    C("latest_po_grn_pct", "Latest PO GRN %", "percent", role="computed", editable=False),
    C("active_po_count", "Active POs", "number", role="computed", editable=False),
    C("supplier_changed", "Supplier changed", role="computed", editable=False),
    C("new_po_fy_inr", "New PO value in FY", "number", role="computed", editable=False),
    C("link_flags", "Flags", role="computed", editable=False),
    C("pending_review", "Pending review", "number", role="computed", editable=False),
    # savings programme fields kept from the old tracker (hidden; re-show in the column manager)
    C("saving_target", "Saving Target", "number", hidden=True),
    C("revised_value", "Revised Value", "number", hidden=True),
    C("responsibility", "Responsibility", hidden=True),
]

# Recognised headers that are deliberately not read (reported as "dropped" on import)
DROPPED_HEADERS = ["Nature of PO (Recurring/One-Time)"]

MAPPING_STATUSES = [
    "Awaiting new PO", "Old PO continues (no renewal needed)", "Not migrated (old PO continues outside SAP)",
    "Agreement / outside SAP", "Not required", "Merged into another PO", "New PO yet to be issued",
    "Not in AOP – discuss", "Add-on", "New – from ZMM",
]
NO_GAP_STATUSES = {"Not required", "Merged into another PO"}

# Fields copied from a parent line onto an add-on / new line
COPY_TO_ADDON = ["aop_code", "wbs", "wbs_l1", "wbs_desc", "wbs_l1_desc", "cost_centre", "gl_code", "gl_name",
                 "project_id", "project_name", "geo", "region", "grouping", "airport_type", "tag", "category",
                 "category2", "package_l1", "package_l2", "package_l3", "nature_of_expense", "owner"]

BRIDGE_KEYS = ["br_price_escalation", "br_timing", "br_scope", "br_post_dlp", "br_spares", "br_forex", "br_new_ca",
               "br_pax", "br_wipro_opt", "br_optimization", "br_others"]
ZMM_KEYS = [c["key"] for c in OPEX_LINE_COLUMNS if c.get("role") == "zmm"]
HIDDEN_KEEP = {"saving_target", "revised_value", "responsibility"}

RE_YTD = re.compile(r"^ytd\b", re.I)
RE_TOTAL = re.compile(r"^total\s*fy\s*'?\s*(\d{2})\b", re.I)
RE_CARRY = re.compile(r"^carry\s*forward\s*in\s*fy\s*'?\s*(\d{2})", re.I)
RE_BUDGET = re.compile(r"^budgeted\s*fy\s*'?\s*(\d{2})", re.I)


# ---------------------------------------------------------------------------------------------- FYs per dataset
def fys_for(dataset: str, cfg: Dict[str, Any]) -> Tuple[str, str]:
    """(current FY, next FY) of the dataset's two blocks."""
    if dataset == "opex_tracker":
        return cfg["plan_fy"], cfg.get("draft_fy") or shift_fy(cfg["plan_fy"], 1)
    return cfg["base_fy"], cfg["plan_fy"]


def _yy(fy: str) -> str:
    return fy[2:]


def _all_columns(dataset: str) -> List[Dict[str, Any]]:
    return OPEX_LINE_COLUMNS + (TRACKER_ONLY_COLUMNS if dataset == "opex_tracker" else [])


def layout(dataset: str, cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The full ordered column list (§3.2) with today's FY labels: {key, label, type, role, editable, hidden, group}."""
    cur, nxt = fys_for(dataset, cfg)
    cut = (cfg.get("cutoffs") or {}).get("default") or ""
    out: List[Dict[str, Any]] = []
    for c in _all_columns(dataset):
        k = c["key"]
        if k == CUR_MONTHS:
            for p in fy_months(cur):
                actual = dataset == "opex_lines" and p <= cut
                v = ("A" if actual else "F") + _yy(cur)
                out.append({"key": vkey(v, p), "label": period_label(p), "type": "number", "role": "computed",
                            "editable": False, "group": v, "month": p, "actual": actual})
        elif k == CUR_YTD:
            out.append({"key": "ytd_current", "label": f"YTD {period_label(cut).replace('-', chr(39))}" if cut else "YTD",
                        "type": "number", "role": "computed", "editable": False})
        elif k == CUR_TOTAL:
            out.append({"key": "total_current", "label": f"Total FY'{_yy(cur)}", "type": "number", "role": "computed",
                        "editable": False})
        elif k == CARRY:
            out.append({"key": "carry_forward", "label": f"Carry Forward in FY{_yy(nxt)} (Yes/No)", "type": "text",
                        "role": "input", "editable": True})
        elif k == NEXT_MONTHS:
            for p in fy_months(nxt):
                out.append({"key": vkey("B" + _yy(nxt), p), "label": period_label(p), "type": "number",
                            "role": "computed", "editable": False, "group": "B" + _yy(nxt), "month": p})
        elif k == NEXT_BUDGET:
            out.append({"key": vkey("B" + _yy(nxt), "annual"), "label": f"Budgeted FY'{_yy(nxt)}", "type": "number",
                        "role": "input", "editable": True})
        elif k == CUR_BUDGET:
            out.append({"key": vkey("B" + _yy(cur), "annual"), "label": f"Budgeted FY'{_yy(cur)} (current year)",
                        "type": "number", "role": "input", "editable": False})
        else:
            out.append({kk: c[kk] for kk in ("key", "label", "type", "role", "editable", "hidden")})
    return out


def meta_columns(dataset: str, cfg: Dict[str, Any], existing: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """Column definitions for ``aop_dataset_meta`` (grid). Admin-added custom columns are kept at the end; an admin's
    hide / editable / width choices on known columns survive."""
    prev = {c["key"]: c for c in existing or []}
    out = []
    for c in layout(dataset, cfg):
        col = column(c["key"], c["label"], c["type"], editable=bool(c.get("editable")), group=c.get("group", ""),
                     hidden=bool(c.get("hidden")))
        if c.get("actual"):
            col["actual"] = True  # booked months come from the actual source (read-only)
        col["role"] = c.get("role")
        old = prev.get(c["key"])
        if old:
            col.update({k: old[k] for k in ("hidden", "width") if k in old})
            if old.get("user_editable") is not None and c.get("role") not in ("computed", "system", "key"):
                col["user_editable"] = old["user_editable"]
        out.append(col)
    known = {c["key"] for c in out}
    out += [c for c in existing or [] if c.get("custom") and c["key"] not in known]
    return out


# ---------------------------------------------------------------------------------------------- normalisers
def po_str(v: Any) -> Optional[str]:
    """PO / supplier / material numbers as digit strings: 9.700001102e9 → '9700001102', 4200000049.0 → '4200000049'."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    if isinstance(v, int):
        return str(v)
    s = str(v).strip()
    if re.fullmatch(r"\d+(\.0+)?", s):
        return s.split(".")[0]
    if re.fullmatch(r"\d+(\.\d+)?[eE]\+?\d+", s):
        try:
            f = float(s)
            if f.is_integer():
                return str(int(f))
        except ValueError:
            pass
    return s or None


def recurring_value(v: Any) -> Optional[str]:
    s = str(v or "").strip().lower()
    if not s:
        return None
    if s.startswith("recurring"):
        return "Recurring"
    if s.replace("-", "").replace(" ", "") in ("onetime", "nonrecurring") or s.startswith("one") or s.startswith("non"):
        return "One-Time"
    return str(v).strip()


def is_recurring_label(v: Any) -> bool:
    return str(v or "").strip().lower().replace("-", "").replace(" ", "") in ("recurring", "onetime", "nonrecurring")


def yes_no(v: Any) -> Optional[str]:
    s = str(v or "").strip().lower()
    if not s:
        return None
    if s in ("yes", "y", "true", "1"):
        return "Yes"
    if s in ("no", "n", "false", "0"):
        return "No"
    return str(v).strip()


PO_KEYS = {"po", "supplier_code", "vendor_code", "material", "pr_no", "merged_into_po"}


def normalise(key: str, ctype: str, v: Any) -> Any:
    if v is None or (isinstance(v, str) and (not v.strip() or v.strip().startswith("#"))):
        return None
    if key in PO_KEYS:
        return po_str(v)
    if key == "recurring":
        return recurring_value(v)
    if key == "carry_forward":
        return yes_no(v)
    if ctype == "date":
        return to_iso_date(v) or (str(v).strip() if isinstance(v, str) else None)
    if key in ("expected_start", "expected_close"):  # free text in the sample ("NA") or a date
        return to_iso_date(v) or (str(v).strip() if not isinstance(v, (int, float)) else v)
    out = coerce(ctype, v)
    if isinstance(out, str):
        out = out.strip() or None
    return out


# ---------------------------------------------------------------------------------------------- reading files
def find_header(rows: List[tuple], scan: int = 12) -> int:
    """First row (of ``scan``) holding ``AOP Code`` and a PO amount header (the refined file has two note rows above)."""
    for i, r in enumerate(rows[:scan]):
        cells = {_n(c) for c in r if isinstance(c, str)}
        if "aopcode" in cells and cells & {"poamountinr", "poamount"}:
            return i
    raise ValueError("Header row not found: expected 'AOP Code' and 'PO AMOUNT (INR)' in the first 12 rows")


def pick_column(header: List[Any], rows: List[tuple], label: str, predicate) -> Tuple[Optional[int], Optional[int]]:
    """For a label that occurs more than once, (index whose non-blank values mostly satisfy predicate, other index)."""
    hits = [i for i, c in enumerate(header) if isinstance(c, str) and _n(c) == _n(label)]
    if not hits:
        return None, None

    def share(i):
        vals = [r[i] for r in rows if i < len(r) and r[i] not in (None, "")]
        return sum(1 for v in vals if predicate(v)) / len(vals) if vals else 0.0
    if len(hits) == 1:
        return (hits[0], None) if share(hits[0]) > 0.5 else (None, hits[0])
    yes = max(hits, key=share)
    no = next((i for i in hits if i != yes), None)
    return (yes, no) if share(yes) > 0.5 else (None, hits[0])


def read_lines(rows: List[tuple], dataset: str, *, header_index: Optional[int] = None,
               capture: Tuple[str, ...] = ()) -> Dict[str, Any]:
    """Parse an Opex line sheet (refined layout, ``Opex_Forecast`` or a FinSight download).

    Returns ``{"lines": [...], "header_row": n, "ignored": [...], "dropped": [...], "warnings": [...],
    "months": {fy: [periods]}, "budgets": [fy...]}``. Each line holds canonical keys plus ``_row`` (sheet row number),
    ``_months`` {period: value} for every dated month column, and ``B<yy>__annual`` for every ``Budgeted FY'yy``.
    Computed columns are recognised but not read. Headers in ``capture`` (e.g. the old mapping text columns) are
    returned raw in ``_extra`` and not reported as ignored."""
    hi = find_header(rows) if header_index is None else header_index
    header = list(rows[hi])
    body = [r for r in rows[hi + 1:]]
    claimed: Dict[int, str] = {}
    by_norm: Dict[str, List[int]] = {}
    month_idx: List[Tuple[int, str]] = []
    for i, c in enumerate(header):
        if isinstance(c, (datetime, date)) or (isinstance(c, (int, float)) and to_period(c)) or \
                (isinstance(c, str) and re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", c.strip())):
            month_idx.append((i, to_period(c.strip() if isinstance(c, str) else c)))
        elif isinstance(c, str) and c.strip():
            by_norm.setdefault(_n(c), []).append(i)

    def take(names: List[str]) -> Optional[int]:
        for nm in names:
            for i in by_norm.get(_n(nm), []):
                if i not in claimed:
                    return i
        return None

    # "Nature of Expense" occurs twice in Opex_Forecast: one holds Recurring / One-Time (→ recurring), one the category
    rec_i, noe_i = pick_column(header, body, "Nature of Expense", is_recurring_label)
    if noe_i is not None:
        claimed[noe_i] = "nature_of_expense"
    cols = [c for c in _all_columns(dataset) if "match" in c]
    # claim order: exact labels of the refined layout first, so an alias never steals another column's own header
    plan: List[Tuple[str, int]] = []
    for c in cols:
        if c["key"] == "nature_of_expense":
            continue
        own = take([c["label"]]) if c["match"][0] == c["label"] else None
        if own is not None:
            claimed[own] = c["key"]
    # then aliases; the INR amount before the document-currency one ("PO AMOUNT" in Opex_Forecast is INR)
    for c in sorted(cols, key=lambda c: c["key"] != "po_amount"):
        if c["key"] in claimed.values() or c["key"] == "nature_of_expense":
            continue
        names = list(c["match"])
        if c["key"] == "recurring" and rec_i is not None and rec_i not in claimed:
            i = take(names)
            if i is None:
                i = rec_i
        else:
            i = take(names)
        if i is not None:
            claimed[i] = c["key"]
    plan = [(k, i) for i, k in claimed.items()]
    types = {c["key"]: c["type"] for c in cols}
    roles = {c["key"]: c["role"] for c in cols}
    # FY-labelled text headers
    budget_idx: List[Tuple[int, str]] = []
    cap_idx = {lab: by_norm[_n(lab)][0] for lab in capture if by_norm.get(_n(lab))}
    carry_i = None
    sno_i = None
    ignored, dropped, computed_seen = [], [], []
    for i, c in enumerate(header):
        if i in claimed or i in cap_idx.values() or not isinstance(c, str) or not c.strip():
            continue
        lab = c.strip()
        if m := RE_BUDGET.match(lab):
            budget_idx.append((i, "FY" + m.group(1)))
        elif RE_CARRY.match(lab):
            carry_i = i if carry_i is None else carry_i
        elif RE_YTD.match(lab) or RE_TOTAL.match(lab):
            computed_seen.append(lab)
        elif _n(lab) in (_n("S. No."),):
            sno_i = i
        elif _n(lab) in {_n(x) for x in DROPPED_HEADERS} or (i == rec_i and claimed.get(i) != "recurring"):
            dropped.append(lab)
        else:
            ignored.append(lab)
    month_fys: Dict[str, List[str]] = {}
    for _, p in month_idx:
        month_fys.setdefault(fy_of_period(p), []).append(p)
    lines: List[Dict[str, Any]] = []
    input_keys = [k for k, _ in plan if roles.get(k) not in ("computed",)]
    for n, r in enumerate(body, start=hi + 2):
        f: Dict[str, Any] = {}
        for k, i in plan:
            if roles.get(k) == "computed" or i >= len(r):
                continue
            v = normalise(k, types.get(k, "text"), r[i])
            if v is not None:
                f[k] = v
        if carry_i is not None and carry_i < len(r):
            v = normalise("carry_forward", "text", r[carry_i])
            if v is not None:
                f["carry_forward"] = v
        for i, fy in budget_idx:
            if i < len(r) and r[i] not in (None, "") and not (isinstance(r[i], str) and r[i].startswith("#")):
                val = coerce("number", r[i])
                if val is not None:
                    f[vkey("B" + fy[2:], "annual")] = val
        months = {}
        for i, p in month_idx:
            if i < len(r) and isinstance(r[i], (int, float)) and not isinstance(r[i], bool):
                months[p] = float(r[i])
        if sno_i is not None and sno_i < len(r) and r[sno_i] not in (None, ""):
            f["_sno"] = r[sno_i]
        if cap_idx:
            f["_extra"] = {lab: r[i] for lab, i in cap_idx.items() if i < len(r) and r[i] not in (None, "")}
        if not any(k in f for k in input_keys) and not any(k.startswith("B") for k in f) and "_sno" not in f:
            continue
        f["_row"] = n
        f["_months"] = months
        lines.append(f)
    return {"lines": lines, "header_row": hi + 1, "ignored": ignored, "dropped": dropped, "computed": computed_seen,
            "months": month_fys, "budgets": [fy for _, fy in budget_idx], "warnings": [],
            "columns": {k: header[i] for k, i in plan}}


def crore_months_warning(lines: List[Dict[str, Any]], fy: str) -> Optional[str]:
    """Next-FY month columns are ignored on upload. Warn when they look like ₹ crore (Σ months × 10⁷ ≈ annual)."""
    months = set(fy_months(fy))
    ann = vkey("B" + fy[2:], "annual")
    hits = tot = 0
    for f in lines:
        a = f.get(ann)
        s = sum(v for p, v in f.get("_months", {}).items() if p in months)
        if a and s:
            tot += 1
            if abs(s * 1e7 - a) <= max(1.0, abs(a) * 0.01):
                hits += 1
    if tot and hits / tot > 0.5:
        return f"FY'{fy[2:]} monthly columns look like ₹ crore ({hits} of {tot} lines) — ignored; Budgeted FY'{fy[2:]} is phased evenly"
    if tot:
        return f"FY'{fy[2:]} monthly columns ignored; Budgeted FY'{fy[2:]} is phased evenly"
    return None


def phase_budget(f: Dict[str, Any], fy: str):
    """B<yy> months = the annual budget phased evenly."""
    ann = f.get(vkey("B" + fy[2:], "annual"))
    if ann is None:
        return
    for p in fy_months(fy):
        f[vkey("B" + fy[2:], p)] = round(float(ann) / 12, 2)


def line_id_from_sno(v: Any) -> Optional[str]:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return f"TRK-{int(v):05d}"
    s = str(v).strip()
    if re.fullmatch(r"\d+(\.0+)?", s):
        return f"TRK-{int(float(s)):05d}"
    return s if s.upper().startswith("TRK-") else f"TRK-{s}"


# ---------------------------------------------------------------------------------------------- derived values
def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def derive(f: Dict[str, Any], dataset: str, cfg: Dict[str, Any], actuals: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """Computed columns for display / download: YTD, Total current FY, Variance, Bridge check, Budget − forecast.
    ``actuals`` = {period: amount} booked for the line (opex_lines)."""
    cur, nxt = fys_for(dataset, cfg)
    cut = (cfg.get("cutoffs") or {}).get("default") or ""
    months = fy_months(cur)
    vals = {}
    for p in months:
        if dataset == "opex_lines" and p <= cut:
            vals[p] = (actuals or {}).get(p, 0.0)
        else:
            vals[p] = _num(f.get(vkey("F" + cur[2:], p)))
    total = sum(vals.values())
    out = {"ytd_current": round(sum(v for p, v in vals.items() if p <= cut), 2), "total_current": round(total, 2)}
    budget_next = f.get(vkey("B" + nxt[2:], "annual"))
    out["variance"] = round(_num(budget_next) - total, 2) if budget_next is not None else None
    if out["variance"] is not None:
        out["bridge_check"] = round(out["variance"] - sum(_num(f.get(k)) for k in BRIDGE_KEYS), 2)
    if dataset == "opex_tracker":
        bud = f.get(vkey("B" + cur[2:], "annual"), f.get("budget_plan"))
        out["budget_vs_forecast"] = round(_num(bud) - total, 2) if bud is not None else None
    if dataset == "opex_lines":
        for p, v in vals.items():
            if p <= cut:
                out[vkey("A" + cur[2:], p)] = round(v, 2)
    return out


def validate(f: Dict[str, Any], dataset: str, cfg: Dict[str, Any]) -> List[str]:
    """Input checks that never block (Review → Checks)."""
    out = []
    cf = f.get("carry_forward")
    if cf not in (None, "Yes", "No"):
        out.append(f"Carry forward must be Yes / No (is '{cf}')")
    d = derive(f, dataset, cfg)
    if d.get("bridge_check") and abs(d["bridge_check"]) > 1 and any(f.get(k) not in (None, 0) for k in BRIDGE_KEYS):
        out.append(f"Bridge check ≠ 0 ({d['bridge_check']:,.0f})")
    return out


# ---------------------------------------------------------------------------------------------- migration
RENAMES = [("old_po", "po"), ("po_ref", "po"), ("vendor_name_override", "vendor"),
           ("nature_of_expense_2", "nature_of_expense"), ("owner_name", "owner"), ("reporting_tag", "tag"),
           ("wbs_name", "wbs_desc"), ("po_nature", "po_description")]
SYSTEM_KEEP = {"line_id", "in_last_import", "sno", "mapping_note"}


def known_keys(dataset: str, cfg: Dict[str, Any]) -> set:
    keys = {c["key"] for c in layout(dataset, cfg)} | HIDDEN_KEEP | SYSTEM_KEEP
    return keys


def migrate_fields(f: Dict[str, Any], dataset: str, cfg: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Legacy keys → canonical (old_po/po_ref → po, reporting_tag → tag when empty, vendor_name_override → vendor,
    nature_of_expense_2 → nature_of_expense, budget_plan → B<plan>__annual, owner_name → owner); keys outside the
    schema are dropped (except A/B/F version keys, line_id and the hidden savings fields). Returns (fields, dropped)."""
    from .datasets import VERSION_KEY
    out = dict(f)
    for old, new in RENAMES:
        if old in out:
            v = out.pop(old)
            if v not in (None, "") and out.get(new) in (None, ""):
                out[new] = v
    if "budget_plan" in out:
        cur, _ = fys_for(dataset, cfg)
        v = out.pop("budget_plan")
        k = vkey("B" + cur[2:], "annual")
        if v not in (None, "") and out.get(k) in (None, ""):
            out[k] = v
    if "recurring" in out:
        out["recurring"] = recurring_value(out["recurring"])
    for k in ("po", "supplier_code", "material"):
        if k in out:
            out[k] = po_str(out[k])
    keep = known_keys(dataset, cfg)
    dropped = [k for k in out if k not in keep and not VERSION_KEY.match(k)]
    for k in dropped:
        out.pop(k)
    return out, dropped
