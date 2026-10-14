"""Monthly actuals imports — the admin uploads these files and every report reads the resulting single actual source.

* MIS working file (SAP_Revenue + SAP_Expense, classified with its Mapping sheet)  → revenue, rev share, opex,
  overheads, below-EBITDA and capex actuals of the current plan year, line by line (the raw-data drill-downs
  show these bookings)
* Resource cost file (Final Resource Cost: employee × WBS × month)                  → payroll actuals with FTE
* Reporting package (PAX sheet, CAPEX Tracker)                                      → actual billable PAX and the
  capex tracker (initial budget, capex till last year, monthly actuals, open PO / PR)
* Project health tracker (project revenue master)                                    → TCV and owners on the project master

Each import replaces only its own source for the months it contains, so re-uploading a month-end file is safe.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Tuple

from .datasets import column, norm
from .importer import Book, Result, find_header_row, num, txt
from .periods import fy_of_period, to_period

# SAP_Expense "Nature of services" / AOP nature → the opex categories of the MIS pack
OPEX_CATEGORIES = ["AMC/CMC", "Software/Licenses", "Third Party Manpower", "Service Contract", "Consumables & Spares", "Overheads"]


# airports whose Non-CUTE billing the MIS pack reports as CUTE revenue
CUTE_FIXED_NONCUTE = {"ggial"}


def opex_category(v: Any) -> str:
    s = norm(v)
    if not s or s in ("0", "none", "null"):
        return "Overheads"
    if "amc" in s or "cmc" in s:
        return "AMC/CMC"
    if "software" in s or "licen" in s or "subscription" in s:
        return "Software/Licenses"
    if "manpower" in s or s in ("o&m",):
        return "Third Party Manpower"
    if "service contract" in s:
        return "Service Contract"
    if "consumable" in s or "spare" in s:
        return "Consumables & Spares"
    return "Overheads"


# SAP department names → P&L tags of the overhead lines
OH_DEPT_ALIASES = {"product & solutions": "Product & Solutions Overhead", "front end sales": "BD - International",
                   "bd - international": "BD - International", "quality": "Quality & Governance",
                   "quality & governance": "Quality & Governance", "marketing & alliances": "Marketing"}


def oh_dept(v: Any) -> str:
    s = str(v or "").strip()
    return OH_DEPT_ALIASES.get(s.lower(), s) if s and s not in ("0", "None") else "Others"


def _hdr(rows, must, scan=6):
    hi = find_header_row(rows, must, scan=scan)
    return hi, {str(c).strip(): i for i, c in enumerate(rows[hi]) if c not in (None, "")}


def _project_map(book: Book) -> List[Tuple[str, Dict[str, Any]]]:
    """Mapping sheet → [(WBS prefix, project info)] longest prefix first."""
    sheet = book.find("Mapping", required=False)
    if not sheet:
        return []
    rows = book.rows(sheet, max_col=32, max_row=800)
    hi = next((i for i, r in enumerate(rows[:6]) if any(str(c).strip() == "Project ID" for c in r if c)), None)
    if hi is None:
        return []
    h = {str(c).strip(): i for i, c in enumerate(rows[hi]) if c}
    out = []
    for r in rows[hi + 1:]:
        wbs = txt(r[h["WBS Element"]]) if "WBS Element" in h else None
        if not wbs or wbs in ("0",):
            continue
        g = lambda k: txt(r[h[k]]) if k in h else None
        out.append((wbs, {"project_id": g("Project ID"), "project_name": g("Project Name"), "geo": g("P&L Head"),
                          "region": g("P&L Region"), "category": g("Category - 1 (CR/Projects)"),
                          "tag": g("For P&L Filter(Reporting Tag)")}))
    out.sort(key=lambda x: -len(x[0]))
    return out


def _lookup(pm, wbs: Optional[str]) -> Dict[str, Any]:
    if not wbs:
        return {}
    for k, info in pm:
        if wbs.startswith(k):
            return info
    return {}


def _period(v) -> Optional[str]:
    return to_period(v) if v not in (None, "") else None


def import_mis_working(path, plan_fy: str) -> Result:
    book = Book(path)
    res = Result()
    pm = _project_map(book)
    periods = set()
    skipped: Counter = Counter()

    # ------------------------------------------------------------------ revenue
    sheet = book.find("SAP_Revenue")
    rows = book.rows(sheet, max_col=45)
    hi, h = _hdr(rows, ["Revenue Tag", "Group Currency Value"])
    g = lambda r, k: r[h[k]] if k in h and h[k] < len(r) else None
    agg: Dict[Tuple, Dict[str, Any]] = {}
    for n, r in enumerate(rows[hi + 1:]):
        if g(r, "Company Code") in (None, ""):
            continue
        p = _period(g(r, "Month")) or _period(g(r, "Posting Date"))
        if not p or fy_of_period(p) != plan_fy:
            skipped["revenue outside plan year"] += 1
            continue
        tag, cls, proj = txt(g(r, "Revenue Tag")) or "", txt(g(r, "Classification")) or "", txt(g(r, "Project Name")) or ""
        amt = -num(g(r, "Group Currency Value"))  # revenue is credit (negative) in SAP
        info = _lookup(pm, txt(g(r, "WBS Element")))
        if tag == "CA" and cls.lower().startswith("cute"):
            kind = cls.split("-")[-1].strip() if "-" in cls else "Combined"
            pax_type = {"domestic": "Domestic", "international": "International"}.get(kind.lower(), "Combined")
            dims = {"stream": "CUTE", "geo": "India", "tag": proj, "pax_type": pax_type}
            domain, qty = "rev_cute", (-num(g(r, "Quantity")) if txt(g(r, "Unit of Measure")) == "AU" else 0.0)
        elif tag == "CA" and norm(proj) in CUTE_FIXED_NONCUTE:
            # GGIAL's non-CUTE billing is its fixed CUTE fee — the MIS pack reports it under CUTE
            dims, domain, qty = {"stream": "CUTE", "geo": "India", "tag": proj, "pax_type": "Combined"}, "rev_cute", 0.0
        elif tag == "CA":
            dims, domain, qty = {"stream": "Non-CUTE", "geo": "India", "tag": proj}, "rev_noncute", 0.0
        elif tag == "Change Request":
            dims = {"stream": "Change Request", "geo": info.get("geo") or "India", "tag": proj or info.get("tag"),
                    "project_id": info.get("project_id")}
            domain, qty = "rev_projects", 0.0
        elif tag == "Solutions":
            dims = {"stream": "Projects", "geo": info.get("geo") or "India", "tag": info.get("tag") or proj,
                    "project_id": info.get("project_id"), "project": proj or info.get("project_name")}
            domain, qty = "rev_projects", 0.0
        elif tag == "Other Income":
            dims, domain, qty = {"line": "interest_income", "head": proj}, "pl_other", 0.0
        else:
            skipped[f"revenue tag {tag or 'blank'}"] += 1
            continue
        periods.add(p)
        # revenue is summarised per line / month (invoice detail stays in SAP); CUTE keeps billed PAX
        key = (domain, p) + tuple(sorted((k, str(v)) for k, v in dims.items()))
        e = agg.setdefault(key, {"domain": domain, "period": p, "dims": dims, "amount": 0.0, "qty": 0.0, "n": 0})
        e["amount"] += amt
        e["qty"] += qty
        e["n"] += 1
    for i, e in enumerate(agg.values()):
        res.actual(e["domain"], f"mis-rev-{i}", e["period"], e["amount"], e["dims"], qty=e["qty"] or None, lines=e["n"],
                   uid=f"mis|rev|{e['domain']}|{e['period']}|{i}")

    # ------------------------------------------------------------------ expenses
    sheet = book.find("SAP_Expense")
    rows = book.rows(sheet, max_col=46)
    hi, h = _hdr(rows, ["Final Exp.Cat.", "Amount_INR"])
    for n, r in enumerate(rows[hi + 1:]):
        if g(r, "Company Code") in (None, ""):
            continue
        if norm(g(r, "Reversal Tag")) == "reversal":
            skipped["reversed documents"] += 1
            continue
        p = _period(g(r, "Month")) or _period(g(r, "Posting Date"))
        if not p or fy_of_period(p) != plan_fy:
            skipped["expense outside plan year"] += 1
            continue
        cat, bu = txt(g(r, "Final Exp.Cat.")) or "", txt(g(r, "Business Unit")) or ""
        sub, dept, nature = txt(g(r, "Sub-Function")) or "", txt(g(r, "Department")) or "", txt(g(r, "Nature of services"))
        amt = num(g(r, "Amount_INR"))
        wbs = txt(g(r, "WBS Element"))
        info = _lookup(pm, wbs)
        base = {"vendor": txt(g(r, "Supplier Name")) or txt(g(r, "Supplier")), "gl": txt(g(r, "G/L Account")),
                "gl_text": txt(g(r, "G/L Account: Long Text")), "wbs": wbs, "po": txt(g(r, "PO Number")),
                "cost_centre": txt(g(r, "Cost Center: Long Text")) or txt(g(r, "Cost Centre Name"))}
        extra = {"date": str(g(r, "Posting Date"))[:10] if g(r, "Posting Date") else None,
                 "voucher": txt(g(r, "Document Number")), "narration": txt(g(r, "Text")) or txt(g(r, "Document Header Text"))}
        low = cat.lower()
        if low == "opex":
            if bu == "Solutions":
                dims = {"category": "Projects", "geo": info.get("geo") or "India", "region": info.get("region"),
                        "tag": info.get("tag") or sub, "project_id": info.get("project_id"), "project": sub}
            elif bu.lower().startswith("change"):
                dims = {"category": "Change Request", "geo": "India", "tag": sub}
            else:  # CA (CA+CR postings sit with shared services)
                dims = {"category": "CA", "geo": "India", "tag": sub if bu == "CA" and sub not in ("", "0") else "Shared services"}
            dims["nature"] = opex_category(nature)
            domain = "opex"
        elif low == "overheads":
            dims = {"pl_tag": oh_dept(dept), "nature": sub if sub not in ("", "0") else "Others",
                    "segment": "Solutions" if bu == "Solutions" else "CA+CR", "geo": "India", "detail": nature}
            domain = "overhead"
        elif low == "revenue share":
            dims, domain = {"stream": "Rev Share", "geo": "India", "tag": sub}, "rev_share"
        elif low == "below ebitda expenses":
            grp = f"{g(r, 'Financial Grouping')} {g(r, 'Financial Sub-Grouping')} {base['gl_text']}".lower()
            line = ("deferred_tax" if "deferred" in grp else "taxes" if "tax" in grp else
                    "depreciation" if "depreciation" in grp or "amortis" in grp else "interest")
            if line != "interest":
                # depreciation and tax are booked outside the monthly SAP dump (asset run / tax provision) — the
                # P&L keeps their AOP phasing (tax = rate × PBT) until an actual is loaded for the month
                skipped[f"below-EBITDA {line} (kept on AOP phasing)"] += 1
                continue
            dims, domain = {"line": line}, "pl_other"
        elif low == "capex":
            dims, domain = {"tag": sub or bu, "category": dept}, "capex_sap"
        elif low == "payroll":
            dims, domain = {"segment": bu, "department": dept, "head": sub}, "payroll_sap"  # reconciliation only
        else:
            skipped[f"expense category {cat or 'blank'}"] += 1
            continue
        periods.add(p)
        dims.update({k: v for k, v in base.items() if v})
        res.actual(domain, f"mis-exp-{n}", p, amt, dims, uid=f"mis|exp|{n}|{p}", **extra)

    res.meta = {"periods": sorted(periods), "cutoff": max(periods) if periods else None,
                "skipped": dict(skipped), "plan_fy": plan_fy,
                "by_domain": dict(Counter(a["domain"] for a in res.actuals))}
    return res


# ---------------------------------------------------------------------------------------------- resources
OVERHEAD_RES_DEPTS = {"corporate": "Corporate", "front-end sales": "Front-End Sales", "solutions - oh": "Solutions",
                      "finance & accounts": "Finance & Accounts", "hr": "HR", "admin": "Admin", "internal it": "Internal IT",
                      "quality": "Quality", "contract & legal": "Contract & Legal", "procurement": "Procurement",
                      "innovation & pre sales": "Pre-Sales", "partnerships & ir": "Partnerships & IR"}
AIRPORTS = {"dial", "ghial", "ggial", "gvial"}


def _res_dims(cat: str, syn: str, dept: str, proj: Optional[str]) -> Dict[str, Any]:
    c, s = norm(cat), norm(syn)
    if c == "ca+cr":
        if " cr" in f" {norm(dept)}" and s in AIRPORTS:
            return {"category": "CR", "tag": syn, "geo": "India"}
        return {"category": "CA", "tag": syn if s in AIRPORTS else "Shared Services", "geo": "India"}
    if c == "solutions":
        return {"category": "Projects", "tag": dept, "geo": "India", "project_code": proj}
    if c == "overheads":
        if s == "marketing":
            key = "Marketing & Alliances Intt." if "international" in norm(dept) else "Marketing & Alliances India"
        else:
            key = OVERHEAD_RES_DEPTS.get(s, syn)
        return {"category": "Overheads", "tag": key, "geo": "India"}
    if c == "capex":
        return {"category": "CA - Capex", "tag": dept, "geo": "India"}
    return {"category": cat or "Unclassified", "tag": syn, "geo": "India"}


def import_resource_cost(path, plan_fy: str) -> Result:
    book = Book(path)
    res = Result()
    sheet = book.find("Final Resource Cost")
    rows = book.rows(sheet, max_col=25)
    hi, h = _hdr(rows, ["EMP ID", "Monthly Cost"])
    g = lambda r, k: r[h[k]] if k in h and h[k] < len(r) else None
    recs = []
    for r in rows[hi + 1:]:
        if not g(r, "EMP ID"):
            continue
        p = _period(g(r, "Month"))
        if not p or fy_of_period(p) != plan_fy:
            continue
        recs.append({"p": p, "emp": txt(g(r, "EMP ID")), "fte": num(g(r, "%age Allocation")), "cost": num(g(r, "Monthly Cost")),
                     "cat": txt(g(r, "Category")), "syn": txt(g(r, "Category for Synergy")) or "",
                     "dept": txt(g(r, "Biz Fin Dept")) or "", "proj": txt(g(r, "Project Definition_for Project P&L only"))})
    # rows without a category (e.g. variable pay) take the category their department carries elsewhere in the file
    by_pair: Dict[Tuple[str, str], Counter] = defaultdict(Counter)
    for x in recs:
        if x["cat"]:
            by_pair[(x["syn"], x["dept"])][x["cat"]] += 1
    agg: Dict[Tuple, Dict[str, Any]] = {}
    for x in recs:
        cat = x["cat"] or (by_pair.get((x["syn"], x["dept"])) or Counter({"Unclassified": 1})).most_common(1)[0][0]
        dims = _res_dims(cat, x["syn"], x["dept"], x["proj"])
        dims.update({"department": x["dept"], "synergy": x["syn"]})
        key = (x["p"],) + tuple(sorted((k, str(v)) for k, v in dims.items()))
        e = agg.setdefault(key, {"p": x["p"], "dims": dims, "cost": 0.0, "fte": 0.0, "emps": set()})
        e["cost"] += x["cost"]
        if x["fte"]:  # headcount from staffed rows (an allocation %); cost-only rows such as variable pay carry none
            e["fte"] += x["fte"]
            e["emps"].add(x["emp"])
    for i, e in enumerate(agg.values()):
        res.actual("payroll", f"res-{i}", e["p"], e["cost"], e["dims"], qty=round(e["fte"], 2), headcount=len(e["emps"]),
                   uid=f"res|{e['p']}|{i}")
    periods = sorted({e["p"] for e in agg.values()})
    res.meta = {"periods": periods, "cutoff": periods[-1] if periods else None, "employees": len({x["emp"] for x in recs}),
                "cost": round(sum(x["cost"] for x in recs), 2)}
    return res


# ---------------------------------------------------------------------------------------------- reporting package
def import_reporting_package(path, plan_fy: str) -> Result:
    """PAX sheet → actual billable PAX rows for the CUTE drivers; CAPEX Tracker → capex_tracker dataset."""
    book = Book(path)
    res = Result()
    pax_rows: List[Dict[str, Any]] = []
    # Revenue Analysis "SECTION B — BILLABLE PAX COUNT": Act/Fct flag row, date row, then location × PAX type rows
    sheet = book.find("Revenue Analysis", required=False)
    if sheet:
        rows = book.rows(sheet, max_col=50, max_row=60)
        sb = next((i for i, r in enumerate(rows) if any("billable pax" in str(c).lower() for c in r if c)), None)
        if sb is not None:
            flags, dates = rows[sb + 1], rows[sb + 2]
            act_cols = [(i, to_period(dates[i])) for i in range(len(dates))
                        if str(flags[i] or "").strip().lower() == "act" and to_period(dates[i])
                        and fy_of_period(to_period(dates[i])) == plan_fy]
            months = {p: j for j, p in enumerate(sorted({p for _, p in act_cols}), start=1)}
            for r in rows[sb + 3:]:
                loc, typ = txt(r[1]), txt(r[2])
                if not loc or not typ:
                    if pax_rows:
                        break
                    continue
                if typ == "Combined":
                    continue
                f = {"airport": loc, "pax_type": typ, "metric": "PAX"}  # actual PAX = the A<yy> months of the PAX line
                for i, p in act_cols:
                    f[f"A{plan_fy[2:]}__{p}"] = num(r[i])
                pax_rows.append(f)
            res.meta["pax_months"] = sorted(months)
    cap_rows: List[Dict[str, Any]] = []
    sheet = book.find("CAPEX Tracker", required=False)
    if sheet:
        rows = book.rows(sheet, max_col=30, max_row=80)
        hi, h = _hdr(rows, ["Location", "Project / Initiative"])
        months = [(i, to_period(c)) for i, c in enumerate(rows[hi]) if to_period(c)]
        scale = 1e7  # the tracker is in ₹ Crore
        for r in rows[hi + 1:]:
            loc, proj = txt(r[h["Location"]]), txt(r[h["Project / Initiative"]])
            if not loc or not proj or norm(loc).startswith(("total", "grand")):
                continue
            f = {"location": loc, "project": proj, "phase": txt(r[h["Phase"]]) if "Phase" in h else None}
            for k, lbl in (("initial_budget", "Initial Budget"), ("capex_till_base", "CAPEX till FY'26"),
                           ("budget_plan", "AOP FY'27"), ("open_po", "Open PO"), ("open_pr", "Open PR")):
                col = next((i for name, i in h.items() if norm(name).replace("’", "'") == norm(lbl)), None)
                if col is None and k == "capex_till_base":
                    col = next((i for name, i in h.items() if norm(name).startswith("capex till")), None)
                if col is None and k == "budget_plan":
                    col = next((i for name, i in h.items() if norm(name).startswith("aop fy")), None)
                f[k] = num(r[col]) * scale if col is not None and isinstance(r[col], (int, float, str)) and num(r[col]) else None
            for i, p in months:
                if fy_of_period(p) == plan_fy and num(r[i]):
                    f[f"A{plan_fy[2:]}__{p}"] = num(r[i]) * scale
            cap_rows.append(f)
    if pax_rows:
        res.meta["pax_rows"] = len(pax_rows)
        res.datasets["_pax_actual"] = {"rows": pax_rows, "columns": []}  # merged into rev_cute_drivers by the router
    if cap_rows:
        cols = [column("location", "Location"), column("project", "Project / initiative"), column("phase", "Phase"),
                column("category", "Category (level 2)"), column("initial_budget", "Initial budget", "number"),
                column("capex_till_base", "Capex till last FY", "number"), column("budget_plan", "AOP (plan FY)", "number"),
                column("open_po", "Open PO commitment", "number"), column("open_pr", "Open PR commitment", "number")]
        res.add("capex_tracker", cap_rows, cols)
    res.meta.update({"capex_rows": len(cap_rows)})
    return res


def import_project_health(path) -> Dict[str, Dict[str, Any]]:
    """Project revenue master → {project_id: {tcv, sales_owner, customer, status}}."""
    book = Book(path)
    sheet = book.wb.sheetnames[0]
    rows = book.rows(sheet, max_col=30)
    hi, h = _hdr(rows, ["Project ID", "Project Name"])
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows[hi + 1:]:
        pid = txt(r[h["Project ID"]])
        if not pid:
            continue
        g = lambda k: r[h[k]] if k in h else None
        e = out.setdefault(pid, {"project_name": txt(g("Project Name")), "tcv": 0.0})
        e["tcv"] += num(g("INR PO Value"))
        for k, lbl in (("sales_owner", "Sales Owner"), ("customer", "Customers"), ("status", "Status of timelines"),
                       ("solution_offered", "Solution Offered")):
            if txt(g(lbl)) and not e.get(k):
                e[k] = txt(g(lbl))
    return out


def pax_driver_key(f: Dict[str, Any]) -> str:
    return re.sub(r"\s+", " ", f"{f['airport']}|{f['pax_type']}|{f['metric']}")
