"""Import the consolidated AOP workbook and the Opex forecast workbook into AOP datasets.

The workbooks are messy (100+ tabs, helper columns, subtotal rows), so the importer:
  * finds sheets by (fuzzy) name and columns by their *header text*, never by fixed letters;
  * keeps every source column (slugified) so nothing is lost, and adds canonical aliases
    (``category``, ``geo``, ``tag``, …) that the P&L engine relies on;
  * splits monthly values into actuals (→ the single ``aop_actuals`` source) and plan
    versions (``F26`` forecast, ``B27`` budget …) based on the actual cut-off month;
  * skips subtotal / blank rows.

Only cached cell values are read (``data_only=True``) — the importer re-creates the logic, it
does not evaluate Excel formulas.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Optional, Tuple

import openpyxl

from .datasets import (CUTE_LEAD, DRIVER_LEAD, SPECS, build_key, column, slug, vkey, wide_columns, widen_cute,
                       widen_drivers)
from . import opex_schema
from .datasets import coerce
from .periods import fy_months, fy_of_period, period_label, shift_fy, to_iso_date, to_period
from .po import parse_po_tokens, status_from_text

Row = Tuple[Any, ...]


def _n(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(v or "").lower())


def num(v: Any) -> float:
    if isinstance(v, bool) or v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return 0.0


def txt(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


class Book:
    def __init__(self, path_or_file):
        self.wb = openpyxl.load_workbook(path_or_file, read_only=True, data_only=True)
        self.names = self.wb.sheetnames

    def find(self, *candidates: str, required: bool = True) -> Optional[str]:
        norm = {_n(s): s for s in self.names}
        for c in candidates:
            if _n(c) in norm:
                return norm[_n(c)]
        for c in candidates:  # prefix / contains match
            for k, s in norm.items():
                if k.startswith(_n(c)):
                    return s
        if required:
            raise ValueError(f"Sheet not found: {candidates[0]} (have: {', '.join(self.names[:15])}…)")
        return None

    def rows(self, sheet: str, max_col: int = 250, max_row: Optional[int] = None) -> List[Row]:
        ws = self.wb[sheet]
        out = []
        for r in ws.iter_rows(min_row=1, max_row=max_row, max_col=max_col, values_only=True):
            out.append(tuple(r))
        return out


class Header:
    """Header row helper: locate columns by header text; detect month columns."""

    def __init__(self, cells: Row):
        self.cells = cells
        self.by_norm: Dict[str, List[int]] = defaultdict(list)
        for i, c in enumerate(cells):
            if c is not None and not isinstance(c, (int, float)) and to_period(c) is None:
                self.by_norm[_n(c)].append(i)

    def idx(self, *names: str, nth: int = 0) -> Optional[int]:
        for name in names:
            hits = self.by_norm.get(_n(name))
            if hits and len(hits) > nth:
                return hits[nth]
        return None

    def months(self, lo: int = 0, hi: Optional[int] = None) -> List[Tuple[int, str]]:
        out = []
        for i, c in enumerate(self.cells[lo:hi], start=lo):
            p = to_period(c) if not isinstance(c, str) else None
            if p:
                out.append((i, p))
        return out

    def generic_columns(self, skip: Iterable[int]) -> List[Tuple[int, str, str]]:
        """(index, key, label) for every labelled non-month column not in ``skip``."""
        seen: Counter = Counter()
        out = []
        skip = set(skip)
        for i, c in enumerate(self.cells):
            if i in skip or c is None or isinstance(c, (int, float)) or to_period(c):
                continue
            label = str(c).strip()
            if not label:
                continue
            k = slug(label)
            seen[k] += 1
            if seen[k] > 1:
                k = f"{k}_{seen[k]}"
            out.append((i, k, label))
        return out


def find_header_row(rows: List[Row], must: List[str], scan: int = 12) -> int:
    targets = [_n(m) for m in must]
    for i, r in enumerate(rows[:scan]):
        cells = {_n(c) for c in r if c is not None}
        if all(t in cells for t in targets):
            return i
    raise ValueError(f"Header row with {must} not found")


class Result:
    def __init__(self):
        self.datasets: Dict[str, Dict[str, Any]] = {}
        self.actuals: List[Dict[str, Any]] = []
        self.warnings: List[str] = []
        self.meta: Dict[str, Any] = {}

    def add(self, dataset: str, rows: List[Dict[str, Any]], columns: List[Dict[str, Any]]):
        spec = SPECS[dataset]
        seen: Counter = Counter()
        n = 0
        for f in rows:
            if spec.auto_prefix and not f.get("line_id"):
                n += 1
                f["line_id"] = f"{spec.auto_prefix}-{n:05d}"
            k = build_key(spec, f)
            if k is None:
                continue
            seen[k] += 1
            if seen[k] > 1:  # disambiguate duplicate natural keys (kept, never dropped)
                if spec.key_fields:
                    f[spec.key_fields[-1]] = f"{f.get(spec.key_fields[-1]) or ''}#{seen[k]}"
                    k = build_key(spec, f)
                else:
                    f["line_id"] = f"{f['line_id']}-{seen[k]}"
                    k = f["line_id"]
            f["_key"] = k
        keep = [f for f in rows if f.get("_key")]
        dupes = sum(v - 1 for v in seen.values() if v > 1)
        if dupes:
            self.warnings.append(f"{dataset}: {dupes} duplicate keys disambiguated with #n suffix")
        self.datasets[dataset] = {"rows": keep, "columns": columns}

    def actual(self, domain: str, ref: str, period: str, amount: float, dims: Dict[str, Any], **extra):
        if not amount:
            return
        doc = {"domain": domain, "ref": ref, "period": period, "amount": float(amount), "dims": dims}
        doc.update(extra)
        doc["uid"] = extra.get("uid") or f"{domain}|{ref}|{period}"
        self.actuals.append(doc)


def alias_column(key: str, *, editable: bool = False):
    """Column definition for a canonical field, typed from its name (amounts → number, dates → date)."""
    k = key.lower()
    if re.search(r"(amount|net_po|budget|grn|pending|value|target|cost|rate|qty|increment_pct)", k):
        t = "number"
    elif re.search(r"(_start|_end|_date|^po_date)$", k):
        t = "date"
    else:
        t = "text"
    return column(key, key.replace("_", " ").title(), t, editable=editable)


def plan_columns(versions_periods: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    cols = []
    for ver, periods in versions_periods.items():
        for p in periods:
            cols.append(column(vkey(ver, p), f"{ver} {period_label(p)}", "number", group=ver))
    return cols


def generic_fields(h: Header, row: Row, cols: List[Tuple[int, str, str]]) -> Dict[str, Any]:
    f = {}
    for i, k, _ in cols:
        v = row[i] if i < len(row) else None
        if v is None or v == "":
            continue
        if isinstance(v, str) and v.startswith("#"):  # #REF!, #N/A …
            continue
        f[k] = v.isoformat() if hasattr(v, "isoformat") else v
    return f


def apply_aliases(h: Header, row: Row, aliases: Dict[str, List[str]], f: Dict[str, Any], dates=()):
    for canon, names in aliases.items():
        i = h.idx(*names)
        if i is None or i >= len(row):
            continue
        v = row[i]
        if canon in dates:
            v = to_iso_date(v)
        elif isinstance(v, str):
            v = v.strip() or None
        if v is not None and not (isinstance(v, str) and v.startswith("#")):
            f[canon] = v


# =====================================================================================
# AOP workbook
# =====================================================================================

def detect_cutoff(book: Book) -> Tuple[str, str, str]:
    """(base_fy, plan_fy, last actual period) from the WAISL P&L header rows."""
    sheet = book.find("WAISL P&L")
    rows = book.rows(sheet, max_col=40, max_row=4)
    kinds, periods = rows[1], rows[2]
    last_act = None
    for k, p in zip(kinds, periods):
        per = to_period(p) if not isinstance(p, str) else None
        if per and str(k).strip().lower().startswith("act"):
            last_act = per if last_act is None or per > last_act else last_act
    if not last_act:
        raise ValueError("Could not detect the actuals cut-off from the WAISL P&L header")
    base = fy_of_period(last_act)
    from .periods import shift_fy
    return base, shift_fy(base, 1), last_act


def import_aop_workbook(path_or_file) -> Result:
    book = Book(path_or_file)
    res = Result()
    base, plan, cutoff = detect_cutoff(book)
    res.meta.update(base_fy=base, plan_fy=plan, actual_cutoff=cutoff, sheets=len(book.names))
    B = "B" + plan[2:]          # e.g. B27
    F = "F" + base[2:]          # e.g. F26
    BB = "B" + base[2:]         # e.g. B26

    _import_assumptions(book, res, plan)
    _import_cute(book, res, base, plan, cutoff, F, B, BB)
    _import_noncute(book, res, base, plan, cutoff, F, B, BB)
    _import_rev_projects(book, res, base, plan, cutoff, F, B, BB)
    _import_project_master(book, res, base, plan)
    _import_opex(book, res, base, plan, cutoff, F, B)
    _import_payroll(book, res, base, plan, cutoff, F, B, BB)
    _import_overheads(book, res, base, plan, cutoff, F, B)
    _import_capex(book, res)
    _import_pl_sheet(book, res, base, plan, cutoff, F, B)
    _seed_taxonomy(res)
    return res


# ---------------- Assumptions ----------------

def _import_assumptions(book: Book, res: Result, plan: str):
    sheet = book.find("Assumptions")
    rows = book.rows(sheet, max_col=16)
    out, section, sub = [], "", ""
    for r in rows[3:]:
        a, b = txt(r[0]), txt(r[1])
        if a and not b and all(v is None for v in r[2:8]):
            section = a
            continue
        if b and all(v is None for v in r[5:12]):
            sub = b
            continue
        if not b:
            continue
        low, base, high, idx, in_use = r[9], r[10], r[11], r[8], r[7]
        if all(not isinstance(v, (int, float)) for v in (low, base, high, in_use)):
            continue
        parts = [sub, a if a and a != section and a.lower() not in (sub or "").lower() else None, b]
        name = " · ".join(p for p in parts if p)
        out.append({
            "fy": plan, "section": section, "group": sub, "name": name, "code": txt(r[6]),
            "unit": txt(r[5]), "low": low if isinstance(low, (int, float)) else None,
            "base": base if isinstance(base, (int, float)) else None,
            "high": high if isinstance(high, (int, float)) else None,
            "scenario": int(idx) if isinstance(idx, (int, float)) else 2,
            "value": in_use if isinstance(in_use, (int, float)) else None,
            "description": txt(r[12]),
        })
    cols = [column("fy", "FY"), column("section", "Section"), column("group", "Group"), column("name", "Assumption"),
            column("code", "Code"), column("unit", "Unit"),
            column("low", "Low", "number", editable=True), column("base", "Base", "number", editable=True),
            column("high", "High", "number", editable=True), column("scenario", "Scenario (1=Low 2=Base 3=High)", "number", editable=True),
            column("value", "In use", "number"), column("description", "Description", editable=True)]
    res.add("assumptions", out, cols)


# ---------------- CUTE ----------------

def _import_cute(book, res, base, plan, cutoff, F, B, BB):
    sheet = book.find("Cute_Rev")
    rows = book.rows(sheet, max_col=30, max_row=120)
    hi = find_header_row(rows, ["Location", "F Year"], scan=40)
    # month columns are labelled Apr … Mar in the block header; the revenue block above uses the same columns
    apr = next((i for i, c in enumerate(rows[hi]) if str(c or "").strip().lower() == "apr"), 6)
    mcols = list(range(apr, apr + 12))
    rev, drivers = [], []
    block = "revenue"
    for r in rows:
        label = txt(r[1])
        if label and label.lower().startswith("pax count"):
            block = "pax"
            continue
        if label and label.lower() == "rate":
            block = "rate"
            continue
        fy_label = txt(r[4])
        if not label or not fy_label or label in ("Total", "Location") or "FY" not in fy_label:
            continue
        m = re.search(r"FY'?\s*(\d{2})", fy_label)
        if not m:
            continue
        fy = f"FY{m.group(1)}"
        periods = fy_months(fy)
        pax_type = txt(r[2]) or "Combined"
        if block == "revenue":
            if fy not in (base, plan):
                continue
            f = {"airport": label, "pax_type": pax_type, "fy": fy, "stream": "CUTE", "geo": "India", "tag": label}
            ref = f"{label}|{pax_type}|{fy}"
            for i, p in zip(mcols, periods):
                v = num(r[i]) * 1e7  # sheet is INR Cr.
                if fy == base:
                    if p <= cutoff:
                        res.actual("rev_cute", ref, p, v, {"stream": "CUTE", "geo": "India", "tag": label, "pax_type": pax_type})
                    else:
                        f[vkey(F, p)] = v
                else:
                    f[vkey(B, p)] = v
            if fy == base and isinstance(r[21], (int, float)):
                f[vkey(BB, "total")] = num(r[21]) * 1e7
            rev.append(f)
        else:
            f = {"airport": label, "pax_type": pax_type, "fy": fy, "metric": "PAX" if block == "pax" else "Rate (INR)"}
            for i, p in zip(mcols, periods):
                f[vkey("V", p)] = num(r[i])
            drivers.append(f)
    # one line per airport / passenger type: the base year's forecast, the plan year's budget … side by side
    rev = widen_cute(rev)
    res.add("rev_cute", rev, wide_columns(rev, CUTE_LEAD))
    for d in drivers:  # the sheet's months → FY-relative m01..m12, then one line per metric with FY columns
        for i, p in enumerate(fy_months(d["fy"])):
            d[f"m{i + 1:02d}"] = d.pop(vkey("V", p), 0)
    drivers = widen_drivers(drivers, base)
    res.add("rev_cute_drivers", drivers, wide_columns(drivers, DRIVER_LEAD, editable=True))


# ---------------- Non-CUTE & rev share ----------------

def _import_noncute(book, res, base, plan, cutoff, F, B, BB):
    sheet = book.find("Non-Cute+CR+Other", "Non-Cute+CR")
    rows = book.rows(sheet, max_col=35, max_row=60)
    hi = find_header_row(rows, ["Location"], scan=6)
    h = Header(rows[hi])
    months = h.months(0, 30)
    base_m = [(i, p) for i, p in months if fy_of_period(p) == base]
    plan_m = [(i, p) for i, p in months if fy_of_period(p) == plan]
    b26_i = h.idx(f"B FY'{base[2:]}", f"B {base}")
    out = []
    for r in rows[hi + 1:]:
        stream, loc = txt(r[1]), txt(r[2])
        if stream not in ("Non-CUTE", "Rev Share") or not loc or loc == "Total":
            continue
        geo = txt(r[0]) or "India"
        f = {"stream": stream, "location": loc, "geo": geo, "tag": loc}
        ref = f"{stream}|{loc}"
        dom = "rev_noncute" if stream == "Non-CUTE" else "rev_share"
        for i, p in base_m:
            v = num(r[i]) * 1e7
            if p <= cutoff:
                res.actual(dom, ref, p, v, {"stream": stream, "geo": geo, "tag": loc})
            else:
                f[vkey(F, p)] = v
        for i, p in plan_m:
            f[vkey(B, p)] = num(r[i]) * 1e7
        if b26_i is not None and isinstance(r[b26_i], (int, float)):
            f[vkey(BB, "total")] = num(r[b26_i]) * 1e7
        out.append(f)
    cols = [column("stream", "Stream"), column("location", "Location"), column("geo", "Geo"), column("tag", "Reporting tag"),
            column(vkey(BB, "total"), f"{BB} total", "number")] + \
        plan_columns({F: [p for _, p in base_m if p > cutoff], B: [p for _, p in plan_m]})
    res.add("rev_noncute", out, cols)


# ---------------- CR & project revenue lines ----------------

PROJ_ALIASES = {
    "project_id": ["Project ID"], "project_name": ["Project Name"], "geo": ["P&L Head"], "region": ["P&L Region"],
    "grouping": ["Project Grouping"], "airport_flag": ["Airport/Non-Airport"], "location": ["Location"],
    "category": ["Category - 1 (CA/CR/Others)", "Category - 1 (CR/Projects)"], "category2": ["Category - 2 (Digital/Non-Digital)"],
    "tag": ["For P&L Filter(Reporting Tag)"], "bau_growth": ["Retro P&L Tagging"], "customer": ["Customers"],
    "customer_po": ["Customer PO Number", "Customer PO No."], "status": ["Status of timelines", "Status of Timelines"],
}


def _import_rev_projects(book, res, base, plan, cutoff, F, B, BB):
    sheet = book.find("Rev_CR&Project")
    rows = book.rows(sheet, max_col=110)
    hi = find_header_row(rows, ["Project ID", "Project Name"])
    h = Header(rows[hi])
    months = h.months()
    # three month blocks in order: budget base FY, actual/forecast base FY, budget plan FY
    base_blocks = [(i, p) for i, p in months if fy_of_period(p) == base]
    half = len(base_blocks) // 2
    bud_base, af_base = base_blocks[:half], base_blocks[half:]
    plan_m = [(i, p) for i, p in months if fy_of_period(p) == plan]
    skip = {i for i, _ in months}
    gen = h.generic_columns(skip)
    out = []
    for r in rows[hi + 1:]:
        pid = txt(r[h.idx("Project ID")])
        if not pid:
            continue
        f = generic_fields(h, r, gen)
        apply_aliases(h, r, PROJ_ALIASES, f)
        out.append(f)
        f["_months"] = r
    res.add("rev_projects", out, [])
    cols = [column(k, lbl) for _, k, lbl in gen]
    for f in res.datasets["rev_projects"]["rows"]:
        r = f.pop("_months")
        ref = f["line_id"]
        dims = {"stream": f.get("category"), "geo": f.get("geo"), "tag": f.get("tag"), "project_id": f.get("project_id")}
        for i, p in af_base:
            v = num(r[i])
            if p <= cutoff:
                res.actual("rev_projects", ref, p, v, dims)
            else:
                f[vkey(F, p)] = v
        for i, p in bud_base:
            f[vkey(BB, p)] = num(r[i])
        for i, p in plan_m:
            f[vkey(B, p)] = num(r[i])
    alias_cols = [alias_column(k) for k in PROJ_ALIASES]
    res.datasets["rev_projects"]["columns"] = [column("line_id", "Line ID")] + alias_cols + \
        [c for c in cols if c["key"] not in PROJ_ALIASES] + \
        plan_columns({BB: [p for _, p in bud_base], F: [p for _, p in af_base if p > cutoff], B: [p for _, p in plan_m]})


# ---------------- Project master ----------------

def _import_project_master(book, res, base, plan):
    sheet = book.find("CR&Project_Master")
    rows = book.rows(sheet, max_col=60)
    hi = find_header_row(rows, ["Project ID", "Project Name"])
    h = Header(rows[hi])
    gen = h.generic_columns([])
    out = []
    for r in rows[hi + 1:]:
        pid = txt(r[h.idx("Project ID")])
        if not pid or (txt(r[h.idx("Project Name")]) or "").lower() == "all":
            continue
        f = generic_fields(h, r, gen)
        apply_aliases(h, r, PROJ_ALIASES, f)
        f["tp_cost_b_plan"] = num(r[h.idx(f"TP Cost B FY'{plan[2:]}")]) if h.idx(f"TP Cost B FY'{plan[2:]}") is not None else None
        f["revenue_b_base"] = num(r[h.idx(f"Revenue B FY'{base[2:]}")]) if h.idx(f"Revenue B FY'{base[2:]}") is not None else None
        out.append(f)
    cols = [alias_column(k) for k in PROJ_ALIASES] + \
        [column("tp_cost_b_plan", f"TP cost B {plan}", "number"), column("revenue_b_base", f"Revenue B {base}", "number")] + \
        [column(k, lbl) for _, k, lbl in gen if k not in PROJ_ALIASES]
    res.add("project_master", out, cols)


# ---------------- Opex lines ----------------

def _import_opex(book, res, base, plan, cutoff, F, B):
    """Opex_Raw Data in the refined layout (opex_schema): base-year months → actuals to the cut-off, forecast after;
    Budgeted FY'<plan> phased evenly (the plan-year monthly columns are ignored — the sample has them in ₹ crore)."""
    sheet = book.find("Opex_Raw Data")
    rows = book.rows(sheet, max_col=150)
    parsed = opex_schema.read_lines(rows, "opex_lines")
    out = []
    for f in parsed["lines"]:
        f.pop("_row", None)
        f.pop("_sno", None)
        out.append(f)
    _schema_warnings(res, "opex_lines", parsed, plan)
    res.add("opex_lines", out, [])
    for f in res.datasets["opex_lines"]["rows"]:
        months = f.pop("_months", {})
        ref = f["line_id"]
        dims = {k: f.get(k) for k in ("category", "geo", "tag", "aop_code", "wbs", "po", "vendor", "cost_centre")}
        for p in fy_months(base):
            v = months.get(p)
            if v is None:
                continue
            if p <= cutoff:
                res.actual("opex", ref, p, v, dims)
            else:
                f[vkey(F, p)] = v
        f.setdefault(vkey(B, "annual"), 0.0)
        opex_schema.phase_budget(f, plan)
    cfg = {"base_fy": base, "plan_fy": plan, "cutoffs": {"default": cutoff}}
    res.datasets["opex_lines"]["columns"] = opex_schema.meta_columns("opex_lines", cfg)


def _schema_warnings(res, dataset, parsed, next_fy):
    if parsed["ignored"]:
        res.warnings.append(f"{dataset}: ignored columns (not in the Opex layout): {', '.join(parsed['ignored'])}")
    if parsed["dropped"]:
        res.warnings.append(f"{dataset}: dropped columns: {', '.join(parsed['dropped'])}")
    w = opex_schema.crore_months_warning(parsed["lines"], next_fy)
    if w and next_fy in parsed["months"]:
        res.warnings.append(f"{dataset}: {w}")
    res.meta.setdefault("schema", {})[dataset] = {k: parsed[k] for k in ("header_row", "ignored", "dropped", "computed")}


# ---------------- Payroll ----------------

def _import_payroll(book, res, base, plan, cutoff, F, B, BB):
    sheet = book.find("Resource Dashboard")
    rows = book.rows(sheet, max_col=75)
    hi = find_header_row(rows, ["Project Code", "P&L Head"])
    h = Header(rows[hi])
    months = h.months()
    base_m = [(i, p) for i, p in months if fy_of_period(p) == base][:12]
    # FY+1 blocks are unlabeled in the header row: projection (total), active, to-be-hired — 12 cols each
    # after the base-year total column; locate them from row 1/2 markers.
    first_proj = base_m[-1][0] + 2  # skip "Expected Cost" total column
    total_blk = list(range(first_proj, first_proj + 12))
    active_blk = list(range(first_proj + 13, first_proj + 25))
    tbh_blk = list(range(first_proj + 26, first_proj + 38))
    b26_i = h.idx(f"B FY{base[2:]}")
    names = ["project_code", "geo", "category", "tag", "bau_growth", "department", "sub_function", "location", "nature"]
    out = []
    for r in rows[hi + 1:]:
        cat = txt(r[2])
        if not cat:
            continue
        f = {k: txt(r[i]) for i, k in enumerate(names)}
        f["_r"] = r
        out.append(f)
    res.add("payroll_lines", out, [])
    pm = fy_months(plan)
    for f in res.datasets["payroll_lines"]["rows"]:
        r = f.pop("_r")
        ref = f["line_id"]
        dims = {k: f.get(k) for k in ("category", "geo", "tag", "department", "project_code")}
        for i, p in base_m:
            v = num(r[i]) * 1e7  # sheet is INR Cr.
            if p <= cutoff:
                res.actual("payroll", ref, p, v, dims)
            else:
                f[vkey(F, p)] = v
        if b26_i is not None:
            f[vkey(BB, "total")] = num(r[b26_i]) * 1e7
        for blk, ver in ((total_blk, B), (active_blk, B + "A"), (tbh_blk, B + "T")):
            for i, p in zip(blk, pm):
                f[vkey(ver, p)] = num(r[i] if i < len(r) else 0) * 1e7
    cols = [column("line_id", "Line ID")] + [column(k, k.replace("_", " ").title()) for k in names] + \
        [column(vkey(BB, "total"), f"{BB} total", "number")] + \
        plan_columns({F: [p for _, p in base_m if p > cutoff], B: pm, B + "A": pm, B + "T": pm})
    res.add("payroll_lines", res.datasets["payroll_lines"]["rows"], cols)


# ---------------- Overheads ----------------

OH_ALIASES = {"pl_tag": ["P&L Tag"], "department": ["Final Department FY'27", "Final Department"],
              "department_prev": ["Final Department FY'26"], "aop_head": ["AOP Head"], "final_tag": ["Final Tag"],
              "sub_type": ["Sub Type"], "currency": ["Currency"], "rate": ["Rate"], "qty": ["Qty (HeadCount/ Licenses)"],
              "cost_per_unit": ["Cost per unit"], "geo": ["P&L Category"], "gmr": ["GMR/ Non-GMR"],
              "capex_opex": ["Capex/Opex"]}


def _import_overheads(book, res, base, plan, cutoff, F, B):
    sheet = book.find("Overhead_Inputs")
    rows = book.rows(sheet, max_col=70)
    hi = find_header_row(rows, ["AOP Head", "P&L Tag"])
    h = Header(rows[hi])
    base_m = [(i, p) for i, p in h.months() if fy_of_period(p) == base]
    # month columns flagged "Fcst" on the row above are forecasts even if before the global cut-off
    fc_flags = rows[hi - 1]
    oh_cutoff = cutoff
    for i, p in base_m:
        if str(fc_flags[i] or "").lower().startswith("fc"):
            oh_cutoff = min(oh_cutoff, fy_months(base)[max(0, fy_months(base).index(p) - 1)])
            break
    res.meta["overhead_actual_cutoff"] = oh_cutoff
    bud_i = h.idx(f"Budgeted FY{plan[2:]}_INR", f"Budgeted {plan}_INR")
    skip = {i for i, _ in h.months()}
    gen = h.generic_columns(skip)
    out = []
    for r in rows[hi + 1:]:
        head = txt(r[h.idx("AOP Head")])
        has_values = any(num(r[i]) for i, _ in base_m) or (bud_i is not None and num(r[bud_i]))
        if not head and not (has_values and txt(r[h.idx("P&L Tag")])):
            continue
        f = generic_fields(h, r, gen)
        apply_aliases(h, r, OH_ALIASES, f)
        if not head:  # rows without an AOP head still count in the department totals
            f["aop_head"] = "UNASSIGNED"
        f["_r"] = r
        out.append(f)
    res.add("overhead_lines", out, [])
    line_months: Dict[str, Dict[str, float]] = {}
    for f in res.datasets["overhead_lines"]["rows"]:
        r = f.pop("_r")
        line_months[f["aop_head"]] = {p: num(r[i]) for i, p in base_m if p <= oh_cutoff}
        for i, p in base_m:
            if p > oh_cutoff:
                f[vkey(F, p)] = num(r[i])
        annual = num(r[bud_i]) if bud_i is not None else 0.0
        f[vkey(B, "annual")] = annual
        for p in fy_months(plan):
            f[vkey(B, p)] = annual / 12
    alias_cols = [alias_column(k) for k in OH_ALIASES]
    res.datasets["overhead_lines"]["columns"] = alias_cols + [column(vkey(B, "annual"), f"{B} annual", "number")] + \
        [c for c in (column(k, lbl) for _, k, lbl in gen) if c["key"] not in OH_ALIASES] + \
        plan_columns({F: [p for _, p in base_m if p > oh_cutoff], B: fy_months(plan)})
    _import_overhead_ledger(book, res, base, oh_cutoff, line_months)


def _import_overhead_ledger(book, res, base, oh_cutoff, line_months):
    """Voucher-level overhead actuals (the single actual source for overheads)."""
    sheet = book.find("Indirect Cost_Raw Data", "Indirect Cost Raw Data")
    rows = book.rows(sheet, max_col=45)
    hi = find_header_row(rows, ["Voucher No.", "AOP Head"])
    h = Header(rows[hi])
    ix = {k: h.idx(*v) for k, v in {
        "books": ["Books"], "sno": ["S.No."], "date": ["Date"], "voucher": ["Voucher No."], "vendor": ["Vendor"],
        "gl": ["Ledger"], "cost_centre": ["Cost Centre"], "department": ["Department - Final"],
        "expense_head": ["Expense Head"], "nature": ["Nature of Expense"], "amount": ["Amount"],
        "narration": ["Narration"], "aop_head": ["AOP Head"], "wbs": ["WBS Element"],
        "final_department": ["Final Department"], "source": ["Source"]}.items()}
    got: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    n = 0
    for r in rows[hi + 1:]:
        amt = num(r[ix["amount"]]) if ix["amount"] is not None else 0
        per = to_period(r[ix["date"]]) if ix["date"] is not None else None
        if not amt or not per or fy_of_period(per) != base or per > oh_cutoff:
            continue
        n += 1
        g = lambda k: txt(r[ix[k]]) if ix.get(k) is not None else None
        head = g("aop_head")
        dims = {"aop_head": head, "cost_centre": g("cost_centre"), "gl": g("gl"), "department": g("final_department") or g("department"),
                "wbs": g("wbs"), "vendor": g("vendor")}
        ref = f"{g('source') or ''}|{g('books') or ''}|{g('voucher') or ''}|{g('sno') or n}"
        res.actual("overhead", ref, per, amt, dims, entry_type="ledger", date=to_iso_date(r[ix["date"]]), voucher=g("voucher"),
                   narration=(g("narration") or "")[:300], expense_head=g("expense_head"), uid=f"overhead|{ref}|{n}")
        got[head][per] += amt
    # Reconcile: the AOP's per-head monthly actuals include manual provisions with no voucher behind
    # them. Post the difference as a provision/adjustment entry so the single actual source carries
    # ledger detail *and* ties exactly to the approved figures.
    adj = 0
    for f in res.datasets["overhead_lines"]["rows"]:
        head = f["aop_head"]
        base_head = head.split("#")[0]
        for p, v in line_months.get(head, {}).items():
            booked = got.get(base_head, {}).get(p, 0) if base_head == head else 0.0
            diff = v - booked
            if abs(diff) > 0.5:
                adj += 1
                res.actual("overhead", f"ADJ|{head}", p, diff, {"aop_head": head, "department": f.get("pl_tag"), "geo": f.get("geo")},
                           entry_type="provision_adjustment", narration="Provision / adjustment to AOP actual")
    res.meta["overhead_voucher_rows"] = n
    res.meta["overhead_adjustments"] = adj
    known = {f["aop_head"] for f in res.datasets["overhead_lines"]["rows"]}
    unmapped = sorted({str(h) for h in got if h not in known})
    if unmapped:
        res.warnings.append(f"overheads: {len(unmapped)} AOP heads in the ledger have no overhead line (excluded from P&L): {', '.join(map(str, unmapped[:8]))}")


# ---------------- Capex ----------------

def _import_capex(book, res):
    sheet = book.find("Budgeted CAPEX")
    rows = book.rows(sheet, max_col=25)
    hi = find_header_row(rows, ["Department", "Description of Work"])
    h = Header(rows[hi])
    gen = h.generic_columns([])
    out = []
    for r in rows[hi + 1:]:
        if not txt(r[h.idx("Description of Work")]) and not num(r[h.idx("Total")]):
            continue
        f = generic_fields(h, r, gen)
        out.append(f)
    for f in out:  # location key used for the capex summary (the sheet's Reporting Tag is often blank)
        f["tag"] = f.get("reporting_tag") or f.get("location") or _capex_location(f.get("l2"), f.get("department"))
    cols = [column("line_id", "Line ID"), column("tag", "Location (summary)")] + \
        [column(k, lbl, "number" if lbl in ("Qty", "Per Item cost", "Total", "Q1", "Q2", "Q3", "Q4") else "text",
                editable=lbl not in ("Department",)) for _, k, lbl in gen] + \
        [column("b_next_total", "Next-year ask (INR)", "number", editable=True, group="Next year"),
         column("b_next_remarks", "Next-year remarks", editable=True, group="Next year")]
    res.add("capex_lines", out, cols)
    _import_capex_history(book, res)


AIRPORTS = {"dial", "ghial", "ggial", "gvial"}


def _capex_location(l2, department) -> str:
    """Location for a budget line without a Reporting Tag, following the Capex_Summary grouping:
    DIAL programmes (Phase 3A/3B, Tech Refresh) roll up to DIAL, Digital and Corporate to their buckets."""
    t = str(l2 or "").strip()
    n = t.lower()
    if n in AIRPORTS:
        return t.upper()
    if n.startswith("phase 3") or n.startswith("tech refresh"):
        return "DIAL"
    if "digital" in n or "digital" in str(department or "").lower():
        return "Digital"
    if n == "corporate" or str(department or "").lower() == "corporate":
        return "Ebabling Capex"
    return "Unmapped"


def _import_capex_history(book, res):
    sheet = book.find("Capex_Summary", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=9, max_row=40)
    clean = lambda v: str(v).replace("\u200b", "").strip() if v is not None else None
    hdr = [clean(c) for c in rows[0]]
    keys = ["location", "initial_budget", "capex_till_fy24", "fy25_actuals", "actuals_till_fy25", "fy26_budget",
            "fy26_actuals", "fy27_budget_summary"]
    tops = AIRPORTS | {"shared services", "digital", "ebabling capex", "enabling capex", "product", "others"}
    tops |= {str(f.get("tag") or "").lower() for f in res.datasets.get("capex_lines", {}).get("rows", [])} - {"unmapped", "remove"}
    out, parent = [], None
    for r in rows[2:]:
        name = clean(r[0])
        if not name or name.lower().startswith("grand total"):
            if name and name.lower().startswith("grand total"):
                break
            continue
        vals = [num(v) * 1e7 for v in r[1:8]]  # sheet is INR Cr.
        f = dict(zip(keys, [name] + vals))
        if name.lower() in tops:
            parent = name
        elif parent:
            f["parent"] = parent  # programme under a location (e.g. DIAL → Tech Refresh, Phase 3A)
        out.append(f)
    labels = ["Location", "Initial budget", "Capex till FY24", "FY25 actuals", "Actuals till FY25", "FY26 budget",
              "FY26 actuals", "FY27 budget (summary)"]
    res.add("capex_history", out, [column(k, l, "text" if k == "location" else "number", editable=k != "location")
                                   for k, l in zip(keys, labels)] + [column("parent", "Parent")])
    res.meta["capex_history_header"] = hdr[:8]


# ---------------- P&L sheet: below-EBITDA lines and B FY26 snapshot ----------------

PL_OTHER = {"Less: Depreciation": "depreciation", "Less: Interest": "interest", "Add: Interest Income": "interest_income",
            "Less: Taxes": "taxes", "Less: Deferred Tax": "deferred_tax"}


def _import_pl_sheet(book, res, base, plan, cutoff, F, B):
    sheet = book.find("WAISL P&L")
    rows = book.rows(sheet, max_col=32, max_row=100)
    hdr = rows[2]
    months = [(i, to_period(c)) for i, c in enumerate(hdr) if not isinstance(c, str) and to_period(c)]
    base_m = [(i, p) for i, p in months if fy_of_period(p) == base]
    plan_m = [(i, p) for i, p in months if fy_of_period(p) == plan]
    plan_total_i = next((i for i, c in enumerate(hdr) if str(c or "").strip() == f"B {plan}"), None)
    other, snap = [], []
    for r in rows[3:]:
        label = txt(r[1])
        if not label:
            continue
        if label in PL_OTHER:
            f = {"line": PL_OTHER[label], "label": label}
            for i, p in base_m:
                v = num(r[i]) * 1e7
                if p <= cutoff:
                    res.actual("pl_other", PL_OTHER[label], p, v, {"line": PL_OTHER[label]})
                else:
                    f[vkey(F, p)] = v
            s = 0.0
            for i, p in plan_m:
                f[vkey(B, p)] = num(r[i]) * 1e7
                s += f[vkey(B, p)]
            if plan_total_i is not None and abs(num(r[plan_total_i]) * 1e7 - s) > 1:
                f[vkey(B, "total")] = num(r[plan_total_i]) * 1e7
            other.append(f)
        if isinstance(r[2], (int, float)):
            snap.append({"row_id": slug(label), "label": label, "value": num(r[2]) * 1e7})
    res.add("pl_other", other, [column("line", "Line"), column("label", "Label")] +
            plan_columns({F: [p for _, p in base_m if p > cutoff], B: [p for _, p in plan_m]}) +
            [column(vkey(B, "total"), f"{B} total override", "number")])
    res.add("pl_snapshot", snap, [column("row_id", "Row"), column("label", "Label"), column("value", "B " + base, "number")])


def _seed_taxonomy(res: Result):
    seed = {
        "DIAL": ("Delhi International Airport Ltd", "Delhi", "India", "Domestic", "GMR"),
        "GHIAL": ("GMR Hyderabad International Airport Ltd", "Hyderabad", "India", "Domestic", "GMR"),
        "GGIAL": ("GMR Goa International Airport Ltd", "Goa", "India", "Domestic", "GMR"),
        "GVIAL": ("GMR Visakhapatnam International Airport Ltd (Bhogapuram)", "Bhogapuram", "India", "Domestic", "GMR"),
        "Kannur": ("Kannur International Airport", "Kannur", "India", "Domestic", "Non-GMR"),
        "Kuwait": ("Kuwait International Airport", "Kuwait City", "Kuwait", "International", "Non-GMR"),
        "Shared services": ("Shared services (allocated to airports)", "", "India", "Domestic", "GMR"),
    }
    tags = set(seed)
    for ds in ("opex_lines", "rev_projects", "payroll_lines", "rev_noncute"):
        for f in res.datasets.get(ds, {}).get("rows", []):
            if f.get("tag"):
                tags.add(str(f["tag"]).strip())
    out = []
    lower_seed = {k.lower(): k for k in seed}
    for t in sorted(tags, key=str.lower):
        if t.lower() in lower_seed and t != lower_seed[t.lower()]:
            continue
        name, city, country, dom, grp = seed.get(t, (t, "", "", "", ""))
        out.append({"tag": t, "airport_name": name, "city": city, "country": country, "domestic_international": dom, "group": grp})
    res.add("taxonomy_airports", out, [column("tag", "Reporting tag"), column("airport_name", "Airport / entity", editable=True),
                                       column("city", "City", editable=True), column("country", "Country", editable=True),
                                       column("domestic_international", "Domestic / International", editable=True),
                                       column("group", "GMR / Non-GMR", editable=True)])


# =====================================================================================
# Opex forecast workbook (tracker + ZMM PO register)
# =====================================================================================

LINK_TEXT_COLUMNS = ("New PO(s) mapped (ZMM)", "New PO No. (SAP)")
PO_LINK_ALIASES = {"line": ["S. No.", "Line ID"], "po": ["New PO No.", "PO"], "material": ["Material code (optional)", "Material Code"],
                   "po_item": ["PO item (optional)", "PO item"], "alloc_pct": ["Allocation %"],
                   "coverage_from": ["Coverage from (optional)", "Coverage from"],
                   "coverage_to": ["Coverage to (optional)", "Coverage to"], "status": ["Link status"], "remarks": ["Remarks"],
                   "check": ["Check"]}
LINE_STATUS_ALIASES = {"line": ["S. No.", "Line ID"], "mapping_status": ["Mapping status"], "merged_into_po": ["Merged into PO"],
                       "remarks": ["Remarks"]}


def _sheet_table(book: "Book", sheet: str, aliases: Dict[str, List[str]], must: str) -> List[Dict[str, Any]]:
    rows = book.rows(sheet, max_col=40)
    hi = next((i for i, r in enumerate(rows[:12]) if _n(must) in {_n(c) for c in r if isinstance(c, str)}), None)
    if hi is None:
        raise ValueError(f"{sheet}: header with '{must}' not found in the first 12 rows")
    h = Header(rows[hi])
    out = []
    for n, r in enumerate(rows[hi + 1:], start=hi + 2):
        f: Dict[str, Any] = {"_row": n}
        for k, names in aliases.items():
            i = h.idx(*names)
            if i is not None and i < len(r) and r[i] not in (None, ""):
                f[k] = r[i]
        if len(f) > 1:
            out.append(f)
    return out


def read_po_links(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """PO_Links rows → link records keyed line|po|material|item. Pre-filled auto-split % (Check says auto-split)
    are kept but marked alloc_auto so the portal may re-split them."""
    out, errors = [], []
    for f in rows:
        lid = opex_schema.line_id_from_sno(f.get("line"))
        po = opex_schema.po_str(f.get("po"))
        if not lid or not po:
            errors.append(f"PO_Links row {f['_row']}: line and PO are required")
            continue
        mat = opex_schema.po_str(f.get("material"))
        item = opex_schema.po_str(f.get("po_item"))
        pct = coerce("percent", f.get("alloc_pct"))
        if pct is not None and pct > 1.5:
            pct = pct / 100
        status = str(f.get("status") or "Active").strip() or "Active"
        out.append({"line_id": lid, "po": po, "material": mat, "po_item": item, "alloc_pct": pct,
                    "alloc_auto": bool(pct is not None and "auto-split" in str(f.get("check") or "").lower()),
                    "coverage_from": to_iso_date(f.get("coverage_from")), "coverage_to": to_iso_date(f.get("coverage_to")),
                    "status": status, "remarks": txt(f.get("remarks")), "source": "PO_Links"})
    return out, errors


def import_opex_workbook(path_or_file, plan: str = "FY27") -> Result:
    """One-time Opex forecast workbook load (§11): tracker lines through the Opex schema (upserted by line id — a row
    without S. No. / Line ID is rejected), links from a PO_Links sheet else parsed from the old mapping text, mapping
    status from a Line_Status sheet else from that text. The ZMM sheet, if present, is run through the ZMM pipeline
    by the caller."""
    book = Book(path_or_file)
    res = Result()
    sheet = book.find("Opex_Forecast", "Opex forecast tracker", "opex_tracker", "Opex_Raw Data")
    rows = book.rows(sheet, max_col=230)
    parsed = opex_schema.read_lines(rows, "opex_tracker", capture=LINK_TEXT_COLUMNS)
    _schema_warnings(res, "opex_tracker", parsed, shift_fy(plan, 1))
    lines, rejected = [], []
    text_links: List[Dict[str, Any]] = []
    statuses: Dict[str, Dict[str, Any]] = {}
    for f in parsed["lines"]:
        lid = f.get("line_id") or opex_schema.line_id_from_sno(f.get("_sno"))
        if not lid:
            rejected.append(f"Row {f['_row']}: no S. No. / Line ID — give the line a number and re-upload")
            continue
        f["line_id"] = lid
        extra = f.pop("_extra", {})
        f.pop("_months", None)
        f.pop("_sno", None)
        n = f.pop("_row")
        text = next((extra[c] for c in LINK_TEXT_COLUMNS if extra.get(c) not in (None, "")), None)
        toks, rest = parse_po_tokens(text)
        for po, mat in toks:
            text_links.append({"line_id": lid, "po": po, "material": mat, "po_item": None, "alloc_pct": None,
                               "alloc_auto": False, "status": "Active", "source": "mapping text", "_row": n})
        if not toks:
            st, merged = status_from_text(" ".join(rest) if rest else text)
            statuses[lid] = {"mapping_status": st, **({"merged_into_po": merged} if merged else {})}
        opex_schema.phase_budget(f, shift_fy(plan, 1))
        f["_key"] = lid
        lines.append(f)
    seen: Counter = Counter(f["line_id"] for f in lines)
    dup = [k for k, v in seen.items() if v > 1]
    if dup:
        rejected.append(f"Duplicate line ids (later rows win): {', '.join(dup[:20])}")
    res.datasets["opex_tracker"] = {"rows": list({f["line_id"]: f for f in lines}.values()), "columns": [], "upsert": True}
    links = text_links
    ls = book.find("PO_Links", required=False)
    if ls:
        links, errs = read_po_links(_sheet_table(book, ls, PO_LINK_ALIASES, "New PO No."))
        rejected += errs
    st = book.find("Line_Status", required=False)
    if st:
        statuses = {}
        for f in _sheet_table(book, st, LINE_STATUS_ALIASES, "Mapping status"):
            lid = opex_schema.line_id_from_sno(f.get("line"))
            if lid and f.get("mapping_status"):
                statuses[lid] = {"mapping_status": str(f["mapping_status"]).strip(),
                                 **({"merged_into_po": opex_schema.po_str(f["merged_into_po"])} if f.get("merged_into_po") else {})}
    res.links = links
    res.statuses = statuses
    res.rejected = rejected
    res.has_zmm = bool(book.find("ZMM_PO_Report", required=False))
    res.meta.update(tracker_rows=len(lines), plan_fy=plan, links=len(links), lines_with_links=len({x["line_id"] for x in links}),
                    statuses=len(statuses), rejected=len(rejected), link_source="PO_Links" if ls else "mapping text")
    return res
