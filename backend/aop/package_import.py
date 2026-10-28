"""Monthly actuals from the WAISL Financial Reporting Package (the workbook behind the MIS deck).

The package already holds the month-end MIS numbers, reconciled, in ₹ crore. Every P&L block is read at the
level the reports filter and drill on:

==============================  =====================================================  ==================================
Report line                     Package sheet                                          Actual (domain · dims)
==============================  =====================================================  ==================================
CUTE revenue                    Revenue Analysis §A (airport × PAX type)              rev_cute · tag, pax_type
Non-CUTE revenue                Non Cute Full Break up (location)                     rev_noncute · tag
Revenue share                   Revenue Analysis §E (location)                        rev_share · tag
Change request revenue          CR Breakup §A (location)                              rev_projects · stream CR, tag
Project revenue                 Project Summary "Revenue (FY27)" (project)             rev_projects · stream Projects, project
Opex — CA (by airport)          Opex & Dir Resource Airportwsie "Without CR"          opex · category CA, tag
Opex — CR (by airport)          Opex & Dir Resource Airportwsie "CR Only"             opex · category Change Request
Opex — Projects                 Project Summary "Opex (Act FY27)" (project)            opex · category Projects, project
Employee cost — direct CA+CR    Opex & Dir Resource Airportwsie "Resource Cost-Direct"  payroll · category CA, tag (+ FTE)
Employee cost — direct Projects Project Summary "Direct Resource (Act FY27)"           payroll · category Projects
Employee cost — indirect        Resource Cost Raw (enabling / pursuit functions)      payroll · category Overheads (+ FTE)
Overheads (SG&A)                OH Summary_Dept (CA+CR / Solutions × department)       overhead · pl_tag, segment
Depreciation, finance cost,     P&L (monthly MIS)                                     pl_other · line
other income, tax
==============================  =====================================================  ==================================

Only months flagged "Act" in the package (Apr → the last closed month) are read. The P&L sheet's monthly
totals are used as the reconciliation check (``meta["check"]``).
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from openpyxl.utils import get_column_letter

from .datasets import norm
from .importer import Book, num
from .periods import fy_of_period, to_period

CR = 1e7  # the package is in ₹ crore
AIRPORTS = ("DIAL", "GHIAL", "GGIAL", "GVIAL")

# OH Summary_Dept department → the TP-overhead department of the P&L ("Enabling Overheads" blocks)
OH_TP = {"admin": "Admin", "corporate": "Corporate", "hr": "HR", "finance & accounts": "Finance & Accounts",
         "marketing": "Marketing", "internal it": "Internal IT", "quality & governance": "Quality & Governance",
         "quality": "Quality & Governance", "contract & legal": "Contract & Legal", "digital": "Digital",
         "procurement": "Procurement", "bd - international": "BD - International", "front end sales": "BD - International",
         "product & solutions": "Product & Solutions Overhead", "product development": "Product & Solutions Overhead",
         "innovation": "Product & Solutions Overhead", "partnership & alliances": "Marketing",
         "partnership & alliance": "Marketing", "cto office": "Others", "cybersecurity": "Others", "others": "Others"}

# Resource Cost Raw indirect function → the resource department of the P&L, and its geography
OH_RES = {"corporate - l1 management": "Corporate", "corporate - others": "Corporate", "finance & accounts": "Finance & Accounts",
          "innovation": "Pre-Sales", "hr": "HR", "admin": "Admin", "quality": "Quality", "procurement": "Procurement",
          "contract & legal": "Contract & Legal", "marketing & alliances india": "Marketing & Alliances India",
          "internal it": "Internal IT", "front end sales": "Front-End Sales", "front end sales - india": "Front-End Sales",
          "solutions": "Solutions", "marketing & alliances international": "Marketing & Alliances Intt.",
          "partnerships & ir": "Partnerships & IR"}
INTERNATIONAL_RES = {"front end sales", "marketing & alliances international"}

PL_LINES = [("depreciation", "depreciation"), ("interest & finance cost- prior period", "interest"),
            ("interest & finance cost", "interest"), ("other income", "interest_income"),
            ("deferred tax", "deferred_tax"), ("tax", "taxes")]


def _s(v: Any) -> str:
    return str(v).strip() if v not in (None, "") else ""


def _date_cols(row, plan_fy: str) -> List[Tuple[int, str]]:
    out = []
    for i, c in enumerate(row):
        if c in (None, "") or isinstance(c, bool):
            continue
        if hasattr(c, "year") or (isinstance(c, str) and len(c.strip()) >= 7 and c.strip()[:4].isdigit()):
            p = to_period(c)
            if p and fy_of_period(p) == plan_fy:
                out.append((i, p))
    return out


def _act_columns(rows, i: int, plan_fy: str) -> List[Tuple[int, str]]:
    """Columns of row i that are plan-year months flagged "Act" in the flag row just above (first match per month)."""
    dates = _date_cols(rows[i], plan_fy)
    if len(dates) < 3:
        return []
    for j in (i - 1, i - 2):
        if j < 0:
            continue
        flags = rows[j]
        if not any(_s(c).lower() == "act" for c in flags):
            continue
        out, seen = [], set()
        for c, p in dates:
            if c < len(flags) and _s(flags[c]).lower() == "act" and p not in seen:
                out.append((c, p))
                seen.add(p)
        return out
    return []


def _sections(rows, plan_fy: str):
    """[(header row index, act columns)] for every month header row with an "Act" flag row above it."""
    out = []
    for i in range(len(rows)):
        cols = _act_columns(rows, i, plan_fy)
        if cols:
            out.append((i, cols))
    return out


def _month_runs(cols: List[Tuple[int, str]], min_len: int = 6) -> List[List[Tuple[int, str]]]:
    """Blocks of adjacent month columns (Apr, May, … in neighbouring columns); stray month headers (a "YTD 2026-09"
    column) are not part of a block."""
    runs: List[List[Tuple[int, str]]] = []
    for c, p in sorted(cols):
        if runs and runs[-1][-1][0] == c - 1 and runs[-1][-1][1] < p:
            runs[-1].append((c, p))
        else:
            runs.append([(c, p)])
    return [r for r in runs if len(r) >= min_len]


def _vals(r, cols) -> Dict[str, float]:
    return {p: num(r[c]) * CR for c, p in cols if c < len(r) and isinstance(r[c], (int, float)) and not isinstance(r[c], bool)}


def _refs(sheet: str, row_index: int, cols) -> Dict[str, str]:
    """period → the package cell the amount was read from (e.g. "Project Summary!K14"; row_index is 0-based)."""
    return {p: f"{sheet}!{get_column_letter(c + 1)}{row_index + 1}" for c, p in cols}


class _Out:
    def __init__(self, months: Optional[set]):
        self.months = months
        self.items: List[Dict[str, Any]] = []
        self.by_block: Dict[str, float] = defaultdict(float)

    def add(self, block: str, domain: str, dims: Dict[str, Any], values: Dict[str, float], qty: Optional[Dict[str, float]] = None,
            refs: Optional[Dict[str, str]] = None):
        for p, v in values.items():
            if self.months is not None and p not in self.months:
                continue
            q = (qty or {}).get(p)
            if not v and not q:
                continue
            self.items.append({"domain": domain, "period": p, "amount": v, "dims": {k: x for k, x in dims.items() if x not in (None, "")},
                               "qty": q, "block": block, "ref": (refs or {}).get(p)})
            self.by_block[block] += v


# ---------------------------------------------------------------------------------------------- months
def actual_months(book: Book, plan_fy: str) -> List[str]:
    """Plan-year months the package flags "Act" (Revenue Analysis header, else the P&L sheet's filled months)."""
    sheet = book.find("Revenue Analysis", required=False)
    if sheet:
        rows = book.rows(sheet, max_col=60, max_row=8)
        for _, cols in _sections(rows, plan_fy):
            return sorted({p for _, p in cols})
    sheet = book.find("P&L", required=False)
    if sheet:
        rows = book.rows(sheet, max_col=20, max_row=20)
        hi = next((i for i, r in enumerate(rows) if len(_date_cols(r, plan_fy)) >= 6), None)
        if hi is not None:
            cols = _date_cols(rows[hi], plan_fy)
            rev = next((r for r in rows if "revenue from operations" in norm(_s(r[1]) if len(r) > 1 else "")), None)
            if rev:
                return [p for c, p in cols if c < len(rev) and isinstance(rev[c], (int, float)) and rev[c]]
    return []


# ---------------------------------------------------------------------------------------------- revenue
def _revenue_analysis(book: Book, plan_fy: str, out: _Out):
    sheet = book.find("Revenue Analysis", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=60, max_row=80)
    secs = _sections(rows, plan_fy)
    for k, (hi, cols) in enumerate(secs):
        end = secs[k + 1][0] - 2 if k + 1 < len(secs) else len(rows)
        title = " ".join(_s(c) for r in rows[max(0, hi - 3):hi] for c in r if isinstance(c, str)).lower()
        body = [(i, r) for i, r in enumerate(rows[hi + 1:end], start=hi + 1) if len(r) > 2 and _s(r[1]) and _s(r[2])]
        if "cute revenue" in title and "non" not in title:
            locs: Dict[str, Dict[str, Any]] = defaultdict(dict)
            for i, r in body:
                loc, typ = _s(r[1]), _s(r[2])
                if norm(loc) in ("total", "grand total"):
                    continue
                locs[loc][typ] = (i, r)
            for loc, by in locs.items():
                split = {t: x for t, x in by.items() if norm(t) in ("domestic", "international")}
                for typ, (i, r) in (split.items() if len(split) == 2 else [("Combined", by.get("Combined") or next(iter(by.values())))]):
                    out.add("CUTE revenue", "rev_cute", {"stream": "CUTE", "geo": "India", "tag": loc, "pax_type": typ,
                                                         "source": "Revenue Analysis"}, _vals(r, cols), refs=_refs(sheet, i, cols))
        elif "revenue share" in title:
            for i, r in body:
                loc = _s(r[2])
                if norm(loc) in ("total", "grand total") or not norm(_s(r[1])).startswith("rev"):
                    continue
                out.add("Revenue share", "rev_share", {"stream": "Rev Share", "geo": "India", "tag": loc,
                                                       "source": "Revenue Analysis"}, _vals(r, cols), refs=_refs(sheet, i, cols))


def _noncute(book: Book, plan_fy: str, out: _Out):
    sheet = book.find("Non Cute Full Break up", "Non Cute Full Breakup", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=60, max_row=80)
    secs = _sections(rows, plan_fy)
    if not secs:
        return
    hi, cols = secs[0]
    for i, r in enumerate(rows[hi + 1:], start=hi + 1):
        if len(r) < 4:
            continue
        typ, loc = _s(r[2]), _s(r[3])
        if not loc:
            continue
        if norm(loc) == "total":
            break
        if "non" not in norm(typ) or "cute" not in norm(typ):
            continue
        out.add("Non-CUTE revenue", "rev_noncute", {"stream": "Non-CUTE", "geo": "India", "tag": loc,
                                                    "source": "Non Cute Full Break up"}, _vals(r, cols), refs=_refs(sheet, i, cols))


def _cr(book: Book, plan_fy: str, out: _Out):
    sheet = book.find("CR Breakup", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=60, max_row=60)
    secs = _sections(rows, plan_fy)
    if not secs:
        return
    hi, cols = secs[0]
    for i, r in enumerate(rows[hi + 1:], start=hi + 1):
        if len(r) < 5:
            continue
        key, loc = _s(r[1]), _s(r[4])
        if not loc:
            if out.by_block.get("Change request revenue"):
                break
            continue
        if norm(loc) in ("total", "grand total") or not norm(key).startswith("change request"):
            if norm(loc) in ("total", "grand total"):
                break
            continue
        out.add("Change request revenue", "rev_projects", {"stream": "Change Request", "geo": "India", "tag": loc,
                                                           "source": "CR Breakup"}, _vals(r, cols), refs=_refs(sheet, i, cols))


# ---------------------------------------------------------------------------------------------- projects
def _project_tags(book: Book) -> Dict[str, Dict[str, Any]]:
    """Rev_Project_Raw data: project id → reporting tag, P&L head (India / International) and region."""
    sheet = book.find("Rev_Project_Raw data", required=False)
    out: Dict[str, Dict[str, Any]] = {}
    if not sheet:
        return out
    rows = book.rows(sheet, max_col=20, max_row=400)
    hi = next((i for i, r in enumerate(rows[:10]) if any(_s(c) == "Project ID" for c in r)), None)
    if hi is None:
        return out
    h = {_s(c): i for i, c in enumerate(rows[hi]) if _s(c)}
    g = lambda r, k: _s(r[h[k]]) if k in h and h[k] < len(r) else ""
    for r in rows[hi + 1:]:
        pid = g(r, "Project ID")
        if pid:
            out.setdefault(pid, {"tag": g(r, "For P&L Filter(Reporting Tag)"), "head": g(r, "P&L Head"),
                                 "region": g(r, "P&L Region"), "wbs": g(r, "WBS Code")})
    return out


def _project_summary(book: Book, plan_fy: str, out: _Out):
    sheet = book.find("Project Summary", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=140, max_row=400)
    hi = next((i for i, r in enumerate(rows[:12]) if any(_s(c) == "Project Name" for c in r)), None)
    if hi is None:
        return
    head = {_s(c).split("\n")[0].strip(): i for i, c in enumerate(rows[hi]) if _s(c)}
    groups_row = rows[hi - 2] if hi >= 2 else []
    flags = rows[hi - 1] if hi >= 1 else []
    group_at, cur = {}, ""
    for i in range(len(rows[hi])):
        if i < len(groups_row) and _s(groups_row[i]):
            cur = _s(groups_row[i]).lower()
        group_at[i] = cur
    blocks = {"rev": [], "opex": [], "res": []}
    for c, p in _date_cols(rows[hi], plan_fy):
        if c >= len(flags) or _s(flags[c]).lower() != "act":
            continue
        g = group_at.get(c, "")
        kind = "rev" if g.startswith("revenue") else "opex" if g.startswith("opex") else "res" if "resource" in g else None
        if kind and p not in {x[1] for x in blocks[kind]}:
            blocks[kind].append((c, p))
    tags = _project_tags(book)
    col = lambda name: next((i for k, i in head.items() if norm(k).startswith(norm(name))), None)
    c_pid, c_name, c_wbs = col("Project ID"), col("Project Name"), col("WBS")
    c_region, c_geo, c_gmr = col("Geography"), col("India"), col("GMR")
    for i, r in enumerate(rows[hi + 1:], start=hi + 1):
        name = _s(r[c_name]) if c_name is not None and c_name < len(r) else ""
        if not name or norm(name) in ("total", "grand total"):
            continue
        pid = _s(r[c_pid]) if c_pid is not None and c_pid < len(r) else ""
        t = tags.get(pid, {})
        intl = "int" in norm(_s(r[c_geo]) if c_geo is not None and c_geo < len(r) else t.get("head"))
        gmr = _s(r[c_gmr]) if c_gmr is not None and c_gmr < len(r) else ""
        tag = t.get("tag") or ("Other GMR Projects" if norm(gmr) == "gmr" else "Other Non-GMR Projects")
        dims = {"geo": "International" if intl else "India", "tag": tag, "project_id": pid or None, "project": name,
                "region": (_s(r[c_region]) if c_region is not None and c_region < len(r) else "") or t.get("region"),
                "wbs": (_s(r[c_wbs]) if c_wbs is not None and c_wbs < len(r) else "") or t.get("wbs"),
                "gmr": gmr or None, "source": "Project Summary"}
        out.add("Project revenue", "rev_projects", {**dims, "stream": "Projects"}, _vals(r, blocks["rev"]),
                refs=_refs(sheet, i, blocks["rev"]))
        out.add("Opex — Projects", "opex", {**dims, "category": "Projects"}, _vals(r, blocks["opex"]),
                refs=_refs(sheet, i, blocks["opex"]))
        out.add("Employee cost — direct Projects", "payroll",
                {**dims, "category": "Projects", "project_code": pid or None}, _vals(r, blocks["res"]),
                refs=_refs(sheet, i, blocks["res"]))


# ---------------------------------------------------------------------------------------------- CA+CR costs
def _airport_costs(book: Book, plan_fy: str, out: _Out, fte: Dict[str, Dict[str, float]]):
    """Airport rows of this sheet already carry their share of shared services (Shared Service Allocation %); the
    shared-services row is a memo. The P&L keeps shared services on its own line (allocated to an airport only when
    one is selected), so each airport is booked net of its allocated share and shared services on their own."""
    sheet = book.find("Opex & Dir Resource Airportwsie", "Opex & Dir Resource Airportwise", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=60, max_row=120)
    alloc: Dict[str, float] = {}
    blocks: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(dict)
    block_refs: Dict[str, Dict[str, Dict[str, str]]] = defaultdict(dict)
    block, cols = None, []
    for i, r in enumerate(rows):
        text = " ".join(_s(c) for c in r if isinstance(c, str)).lower()
        if "without cr" in text:
            block = "opex_ca"
        elif "cr only" in text:
            block = "opex_cr"
        elif "resource cost" in text and "direct" in text:
            block = "res"
        elif re.search(r"\bsection [a-z]\s*[—–-]", text):
            block = None  # §A is opex incl. CR — read from the two split blocks instead
        elif "allocation" in text:
            block = "alloc"
        c = _act_columns(rows, i, plan_fy)
        if c:
            cols = c
            continue
        if block == "alloc":  # "DIAL | 0.667" in any two neighbouring cells
            for j, cell in enumerate(r[:-1]):
                nxt = r[j + 1]
                if _s(cell).upper() in AIRPORTS and isinstance(nxt, (int, float)) and 0 <= nxt <= 1:
                    alloc[_s(cell).upper()] = float(nxt)
            continue
        if not block or not cols or len(r) < 3:
            continue
        loc = _s(r[2])
        if not loc or not isinstance(r[2], str) or norm(loc) in ("total", "grand total"):
            continue
        slot = loc.upper() if loc.upper() in AIRPORTS else "Shared services"
        blocks[block][slot] = _vals(r, cols)
        block_refs[block][slot] = _refs(sheet, i, cols)
    for block, by in blocks.items():
        shared = by.get("Shared services", {})
        for tag, v in by.items():
            refs = dict(block_refs[block].get(tag, {}))
            if tag != "Shared services":
                v = {p: x - shared.get(p, 0.0) * alloc.get(tag, 0.0) for p, x in v.items()}
                srefs = block_refs[block].get("Shared services", {})
                refs = {p: f"{ref} − {srefs[p].split('!')[-1]} × {alloc.get(tag, 0.0):.3f}" if p in srefs and alloc.get(tag) else ref
                        for p, ref in refs.items()}
            if block == "opex_ca":
                out.add("Opex — CA", "opex", {"category": "CA", "geo": "India", "tag": tag, "source": "Opex & Dir Resource"}, v, refs=refs)
            elif block == "opex_cr":
                out.add("Opex — CR", "opex", {"category": "Change Request", "geo": "India", "tag": tag, "source": "Opex & Dir Resource"}, v, refs=refs)
            elif block == "res":
                out.add("Employee cost — direct CA+CR", "payroll",
                        {"category": "CA", "geo": "India", "tag": tag, "source": "Opex & Dir Resource"}, v, qty=fte.get(tag), refs=refs)


def _resource_raw(book: Book, plan_fy: str, out: _Out) -> Dict[str, Dict[str, float]]:
    """Indirect resources (enabling → CA+CR, pursuit → Solutions) with FTE; returns direct CA FTE by airport."""
    sheet = book.find("Resource Cost Raw", required=False)
    fte_ca: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    if not sheet:
        return fte_ca
    rows = book.rows(sheet, max_col=50, max_row=200)
    hi = next((i for i, r in enumerate(rows[:12]) if len(_date_cols(r, plan_fy)) >= 12), None)
    if hi is None:
        return fte_ca
    runs = _month_runs(_date_cols(rows[hi], plan_fy))
    cost_cols = runs[0] if runs else []
    fte_cols = runs[1] if len(runs) > 1 else []
    section, seg = None, None
    for ri, r in enumerate(rows[hi + 1:], start=hi + 1):
        if len(r) < 4:
            continue
        label = norm(_s(r[3]))
        if label.startswith("total direct") or label.startswith("operations"):
            section = "direct"
        elif label.startswith("solutions") and "project" in label:
            section = "projects"
        elif label.startswith("total indirect"):
            section = "indirect"
        elif label.startswith("enabling"):
            seg = "CA+CR"
        elif label.startswith("pursuit"):
            seg = "Solutions"
        elif label.startswith("total capitali") or label.startswith("capitali"):
            section = "capex"
        leaf = _s(r[1])
        if not leaf or norm(leaf) in ("for actuals", "particulars"):
            continue
        fte = {p: num(r[c]) for c, p in fte_cols if c < len(r) and isinstance(r[c], (int, float))}
        if section == "direct":
            text = f"{_s(r[1])} {_s(r[2])} {_s(r[3])}".upper()
            tag = next((a for a in AIRPORTS if a in text), "Shared services")
            for p, q in fte.items():
                fte_ca[tag][p] += q
        elif section == "indirect" and seg:
            key = norm(leaf)
            dept = OH_RES.get(key, leaf)
            out.add("Employee cost — indirect", "payroll",
                    {"category": "Overheads", "tag": dept, "segment": seg, "function": leaf,
                     "geo": "International" if key in INTERNATIONAL_RES else "India", "source": "Resource Cost Raw"},
                    {p: num(r[c]) * CR for c, p in cost_cols if c < len(r) and isinstance(r[c], (int, float))}, qty=fte,
                    refs=_refs(sheet, ri, cost_cols))
    return fte_ca


def _overheads(book: Book, plan_fy: str, out: _Out):
    sheet = book.find("OH Summary_Dept", required=False)
    if not sheet:
        return
    rows = book.rows(sheet, max_col=60, max_row=120)
    cols = []
    for i, r in enumerate(rows):
        c = _act_columns(rows, i, plan_fy)
        if c:
            cols = c
            continue
        if not cols or len(r) < 5:
            continue
        seg, dept = _s(r[3]), _s(r[4])
        if not dept or norm(dept) in ("total", "grand total") or norm(seg) not in ("ca+cr", "solutions"):
            continue
        out.add("Overheads (SG&A)", "overhead",
                {"pl_tag": OH_TP.get(norm(dept), dept), "segment": "Solutions" if norm(seg) == "solutions" else "CA+CR",
                 "nature": dept, "department": dept, "geo": "India", "source": "OH Summary_Dept"}, _vals(r, cols),
                refs=_refs(sheet, i, cols))


# ---------------------------------------------------------------------------------------------- below EBITDA
def _pl_sheet(book: Book, plan_fy: str, out: _Out) -> Dict[str, Dict[str, float]]:
    """P&L sheet: below-EBITDA lines as actuals; the monthly revenue / cost / EBITDA totals as the check."""
    sheet = book.find("P&L", required=False)
    check: Dict[str, Dict[str, float]] = {}
    if not sheet:
        return check
    rows = book.rows(sheet, max_col=20, max_row=40)
    hi = next((i for i, r in enumerate(rows) if len(_date_cols(r, plan_fy)) >= 6), None)
    if hi is None:
        return check
    cols = _date_cols(rows[hi], plan_fy)
    lines: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    line_refs: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))
    for ri, r in enumerate(rows[hi + 1:], start=hi + 1):
        lab = norm(_s(r[1]) if len(r) > 1 else "")
        if not lab:
            continue
        vals = _vals(r, cols)
        for key in ("revenue from operations", "o/m cost", "employee cost", "revenue share", "overheads", "ebitda"):
            if lab.startswith(key) and key not in check:
                check[key] = vals
        for needle, line in PL_LINES:
            if lab.startswith(needle):
                for p, v in vals.items():
                    lines[line][p] += v
                for p, ref in _refs(sheet, ri, cols).items():
                    if p in vals:
                        line_refs[line][p].append(ref)
                break
    for line, vals in lines.items():
        out.add("Below EBITDA", "pl_other", {"line": line, "source": "P&L"}, dict(vals),
                refs={p: " + ".join([x.split("!")[-1] if k else x for k, x in enumerate(rs)]) for p, rs in line_refs[line].items()})
    return check


# ---------------------------------------------------------------------------------------------- entry point
def package_actuals(book: Book, plan_fy: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """All P&L actuals of the package's closed months → ([actual], meta). Each actual: domain, period, amount (₹),
    dims, qty (FTE where the package has it)."""
    months = actual_months(book, plan_fy)
    out = _Out(set(months) if months else None)
    _revenue_analysis(book, plan_fy, out)
    _noncute(book, plan_fy, out)
    _cr(book, plan_fy, out)
    _project_summary(book, plan_fy, out)
    fte = _resource_raw(book, plan_fy, out)
    _airport_costs(book, plan_fy, out, {k: dict(v) for k, v in fte.items()})
    _overheads(book, plan_fy, out)
    check_src = _pl_sheet(book, plan_fy, out)
    # reconciliation: the package's own monthly P&L vs what was read line by line
    got: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for a in out.items:
        dom = a["domain"]
        key = ("revenue from operations" if dom in ("rev_cute", "rev_noncute", "rev_projects") else
               "revenue share" if dom == "rev_share" else "o/m cost" if dom == "opex" else
               "employee cost" if dom == "payroll" else "overheads" if dom == "overhead" else None)
        if key:
            got[key][a["period"]] += a["amount"]
    check = []
    for key, src in check_src.items():
        if key == "ebitda":
            continue
        for p in months:
            want, have = src.get(p, 0.0), got[key].get(p, 0.0)
            check.append({"line": key, "period": p, "package": round(want / CR, 4), "read": round(have / CR, 4),
                          "diff": round((have - want) / CR, 4)})
    meta = {"actual_months": months, "cutoff": max(months) if months else None,
            "by_block": {k: round(v / CR, 3) for k, v in out.by_block.items()},
            "check": check, "mismatches": [c for c in check if abs(c["diff"]) > 0.05]}
    return out.items, meta


# ---------------------------------------------------------------------------------------------- source precedence
PACKAGE = "package"


def prefer_package(actuals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The package is the reconciled MIS: for a domain and month it covers, its actuals replace the other sources'
    (SAP dumps, resource file) so nothing is counted twice. Other months keep every source."""
    covered = {(a.get("domain"), a.get("period")) for a in actuals if a.get("source") == PACKAGE}
    if not covered:
        return actuals
    return [a for a in actuals if a.get("source") == PACKAGE or (a.get("domain"), a.get("period")) not in covered]
