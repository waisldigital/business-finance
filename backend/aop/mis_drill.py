"""Double-click detail for the Regional P&L (MIS 5b): the lines behind one cell.

The detail is built by running the *same* engine calls the report uses with line tracing on (``PnLEngine.traced``),
so the listed lines add up to the cell — nothing is re-derived or guessed:

* revenue            → the Financial Reporting Package rows (Project Summary) with the package cell each month was read
                       from; months after the actual cut-off list the forecast / plan lines
* TP opex            → the same package rows, plus the SAP expense dump (FBL3H lines of the MIS working file) that
                       belong to the clicked region and months, project by project
* resource cost      → package rows plus the resource cost file (cost by project / department; never by employee)
* overheads          → package rows (OH Summary_Dept / Resource Cost Raw) plus SAP overhead lines per department,
                       with the allocation rule that turns the department total into this cell
* derived lines      → (gross margin, EBITDA …) the lines they are made of

Amounts are in rupees; the screen applies the unit toggle.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from openpyxl.utils import column_index_from_string

from .mis import MARKETING_BLOCKS, REGIONS, SALES_BLOCKS, Vec, engines, regional_pnl
from .periods import period_label
from .pnl import OH_BLOCKS, Filters, PnLEngine, _id

LEDGER_LIMIT = 5000  # ledger lines returned per section (the rest is counted, not sent)

SOURCE_LABEL = {"package": "Financial Reporting Package", "mis": "MIS working file (SAP dump)",
                "resource": "Resource cost file", "upload": "Manual entry", "import": "AOP workbook",
                "forecast": "Forecast (plan lines)", "plan": "AOP plan lines"}

# derived Regional P&L lines → what they are made of: (row id, sign)
DERIVED = {"gm": [("rev", 1), ("direct", -1)],
           "cm": [("gm", 1), ("sales", -1), ("marketing", -1)],
           "ebitda": [("cm", 1), ("tp_oh", -1), ("res_oh", -1)]}
RATIOS = {"gm_pct": ("gm", "rev"), "cm_pct": ("cm", "rev"), "ebitda_pct": ("ebitda", "rev")}


class Denied(Exception):
    """The caller may not see this line (confidential payroll)."""


def _n(v) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def column_filter(col: str) -> Filters:
    """The report's own column → filters (see mis.regional_pnl)."""
    if col == "india":
        return Filters(geo="India")
    if col == "intl":
        return Filters(geo="International")
    for r in REGIONS:
        if _id(r) == col:
            return Filters(geo="International", region=r)
    return Filters()


# ---------------------------------------------------------------------------------------------- cell references
_CELL = re.compile(r"^(.*)!([A-Z]+)(\d+)$")


def compress_cells(refs: List[str]) -> str:
    """["Project Summary!K14", "…!L14", "…!M14"] → "Project Summary!K14:M14" (contiguous months of one row)."""
    runs: Dict[Tuple[str, str], List[Tuple[int, str]]] = defaultdict(list)
    other: List[str] = []
    for r in refs:
        m = _CELL.match(r or "")
        if not m:
            if r and r not in other:
                other.append(r)
            continue
        runs[(m.group(1), m.group(3))].append((column_index_from_string(m.group(2)), m.group(2)))
    out: List[str] = []
    for (sheet, row), cols in runs.items():
        cols = sorted(set(cols))
        start = prev = cols[0]
        for c in cols[1:] + [None]:
            if c is not None and c[0] == prev[0] + 1:
                prev = c
                continue
            out.append(f"{sheet}!{start[1]}{row}" + (f":{prev[1]}{row}" if prev != start else ""))
            if c is not None:
                start = prev = c
    return "; ".join(out + other)


# ---------------------------------------------------------------------------------------------- grouping
class Groups:
    """Lines grouped by project / department with one amount per month and the package cells they came from."""

    def __init__(self, months: List[str], kinds: Dict[str, str]):
        self.months, self.kinds = months, kinds
        self.items: Dict[str, Dict[str, Any]] = {}

    def add(self, key: str, label: str, sub: str, p: str, v: float, source: str, cell: Optional[str] = None, **extra):
        g = self.items.setdefault(key, {"id": key, "label": label, "sub": sub, "months": {}, "cells": [], "sources": set(), **extra})
        if label and (not g["label"] or g["label"] == key):
            g["label"] = label
        if sub and not g["sub"]:
            g["sub"] = sub
        m = g["months"].setdefault(p, 0.0)
        g["months"][p] = m + v
        if cell:
            g["cells"].append(cell)
        g["sources"].add(source)

    def out(self) -> List[Dict[str, Any]]:
        rows = []
        for g in self.items.values():
            rows.append({"id": g["id"], "label": g["label"], "sub": g["sub"],
                         "months": {p: round(v, 2) for p, v in g["months"].items()},
                         "total": round(sum(g["months"].values()), 2),
                         "cells": compress_cells(g["cells"]),
                         "source": " + ".join(sorted(SOURCE_LABEL.get(s, s) for s in g["sources"])),
                         **{k: v for k, v in g.items() if k not in ("id", "label", "sub", "months", "cells", "sources")}})
        rows.sort(key=lambda r: -abs(r["total"]))
        return rows


def _project_index(data) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    key = lambda v: re.sub(r"[^0-9a-z]+", "", str(v or "").lower())
    master = {r.get("project_id"): r for r in data.get("project_master", []) if r.get("project_id")}
    by_name = {key(r.get("project_name")): pid for pid, r in master.items() if r.get("project_name")}
    return master, by_name


def _project_of(src: Dict[str, Any], master, by_name) -> Tuple[str, str, str]:
    """(key, label, sub) of the project a line belongs to — a booking (dims), or a plan row."""
    d = src.get("dims") if isinstance(src.get("dims"), dict) else src
    key = lambda v: re.sub(r"[^0-9a-z]+", "", str(v or "").lower())
    name = d.get("project") or d.get("project_name") or src.get("project_name") or d.get("description") or d.get("tag")
    pid = d.get("project_id") or d.get("project_code") or by_name.get(key(name))
    m = master.get(pid, {}) if pid else {}
    label = m.get("project_name") or name or pid or "Unallocated"
    sub = " · ".join(x for x in (pid, d.get("region") or m.get("region") or d.get("geo")) if x)
    return (pid or f"name:{label}"), str(label), sub


def _dept_of(src: Dict[str, Any]) -> Tuple[str, str, str]:
    d = src.get("dims") if isinstance(src.get("dims"), dict) else src
    name = d.get("function") or d.get("department") or d.get("tag") or d.get("pl_tag") or src.get("aop_head") or src.get("description") or "Others"
    seg = d.get("segment") or src.get("segment") or ""
    return f"{name}|{seg}", str(name), str(seg)


def _ledger(src: Dict[str, Any], a: Dict[str, Any]) -> Dict[str, Any]:
    d = a.get("dims") or {}
    return {"period": a["period"], "date": a.get("date"), "doc": a.get("voucher"), "gl": d.get("gl"), "gl_text": d.get("gl_text"),
            "vendor": d.get("vendor"), "wbs": d.get("wbs"), "po": d.get("po"), "cost_centre": d.get("cost_centre"),
            "text": a.get("narration"), "amount": a["amount"], "category": d.get("category") or d.get("pl_tag"),
            "nature": d.get("nature"), "segment": d.get("segment"), "project": d.get("project"), "project_id": d.get("project_id"),
            "region": d.get("region")}


# ---------------------------------------------------------------------------------------------- the drill
class Ctx:
    """Everything one drill needs: engines, months, the clicked column."""

    def __init__(self, data, actuals, sap, resource, cfg, measure: str, idx: List[int], col: str):
        self.data, self.cfg, self.measure, self.col = data, cfg, measure, col
        e0, e1 = engines(data, actuals, cfg)
        self.eng, self.months_all = {"a_base": (e0, e0.base_m), "b_plan": (e0, e0.plan_m),
                                     "af_plan": (e1, e1.base_m), "b_draft": (e1, e1.plan_m)}[measure]
        self.idx = idx
        self.sel = [self.months_all[i] for i in idx]
        self.flt = column_filter(col)
        self.master, self.by_name = _project_index(data)
        cut = self.eng.cutoff("default")
        actual_year = measure in ("a_base", "af_plan")
        self.kinds = {p: ("A" if p <= cut else "F") if actual_year else "B" for p in self.months_all}
        # the same engine fed with the raw sources, so the same predicates pick their lines
        self._sap = PnLEngine(data, sap, *self._args()) if sap and actual_year else None
        self._res = PnLEngine(data, resource, *self._args()) if resource and actual_year else None

    def _args(self):
        e = self.eng
        return (e.base_fy, e.plan_fy, e.cutoffs, e.tax_rate, e.approved_fy)

    def trace(self, fn, engine: Any = "report", kinds: Tuple[str, ...] = ("a", "f", "p")) -> List[Dict[str, Any]]:
        e = self.eng if engine == "report" else engine
        if e is None:
            return []
        _, tr = e.traced(fn)
        return [t for t in tr if t["p"] in self.sel and t["k"] in kinds and t["v"]]

    def sap_trace(self, fn):
        return self.trace(fn, self._sap, ("a",))

    def res_trace(self, fn):
        return self.trace(fn, self._res, ("a",))

    def month_meta(self) -> List[Dict[str, str]]:
        return [{"p": p, "label": period_label(p), "kind": self.kinds[p]} for p in self.sel]


def _mk_section(ctx: Ctx, sid: str, title: str, trace: List[Dict[str, Any]], grouper, note: str = "",
                source: str = "") -> Dict[str, Any]:
    g = Groups(ctx.sel, ctx.kinds)
    for t in trace:
        key, label, sub = grouper(t["src"])
        src_name = (t["src"].get("source") or "upload") if t["k"] == "a" else ("forecast" if t["k"] == "f" else "plan")
        g.add(key, label, sub, t["p"], t["v"], src_name, t["src"].get("cell") if t["k"] == "a" else None)
    rows = g.out()
    return {"id": sid, "kind": "groups", "title": title, "note": note, "source": source, "rows": rows,
            "total": round(sum(r["total"] for r in rows), 2), "months": ctx.month_meta(),
            "monthly": {p: round(sum(r["months"].get(p, 0.0) for r in rows), 2) for p in ctx.sel}}


def _ledger_section(ctx: Ctx, sid: str, title: str, trace: List[Dict[str, Any]], note: str = "") -> Dict[str, Any]:
    lines = sorted((_ledger(t["src"], t["src"]) for t in trace), key=lambda x: (x["period"], -abs(x["amount"])))
    by_proj: Dict[str, float] = defaultdict(float)
    for t in trace:
        key, label, _ = _project_of(t["src"], ctx.master, ctx.by_name)
        by_proj[key] += t["v"]
        by_proj["label:" + re.sub(r"[^0-9a-z]+", "", label.lower())] += t["v"]  # fallback match by name
    return {"id": sid, "kind": "ledger", "title": title, "note": note, "lines": lines[:LEDGER_LIMIT], "count": len(lines),
            "truncated": len(lines) > LEDGER_LIMIT, "total": round(sum(x["amount"] for x in lines), 2),
            "by_project": {k: round(v, 2) for k, v in by_proj.items()}}


def _residual(ctx: Ctx, section: Dict[str, Any], cell_vec: List[float], label: str) -> None:
    """Whatever the cell holds that the lines do not (apportioned shares): one explicit line, month by month."""
    diff = {p: cell_vec[i] - section["monthly"].get(p, 0.0) for p, i in zip(ctx.sel, ctx.idx)}
    if not any(abs(v) > 1.0 for v in diff.values()):
        return
    section["rows"].append({"id": "__residual", "label": label, "sub": "apportioned — not a booking", "residual": True,
                            "months": {p: round(v, 2) for p, v in diff.items()}, "total": round(sum(diff.values()), 2),
                            "cells": "", "source": "Allocation rule"})
    section["total"] = round(section["total"] + sum(diff.values()), 2)
    for p, v in diff.items():
        section["monthly"][p] = round(section["monthly"].get(p, 0.0) + v, 2)


def _tp_label(col: str) -> str:
    return ("International amounts not tagged to a region, apportioned by region revenue"
            if col in {_id(r) for r in REGIONS} else "Other (rounding / unmapped)")


# ---------------------------------------------------------------------------------------------- leaves
def revenue_detail(ctx: Ctx, cell_vec: List[float]) -> Dict[str, Any]:
    tr = ctx.trace(lambda e: e.rev_projects(ctx.flt, "Projects"))
    sec = _mk_section(ctx, "rev", "Project revenue", tr, lambda s: _project_of(s, ctx.master, ctx.by_name),
                      source="Financial Reporting Package — Project Summary, “Revenue” months flagged Act",
                      note="Each actual month is the package cell shown; forecast / plan months come from the revenue plan lines.")
    _residual(ctx, sec, cell_vec, _tp_label(ctx.col))
    return {"title": "Revenue", "sections": [sec]}


def tp_detail(ctx: Ctx, cell_vec: List[float]) -> Dict[str, Any]:
    fn = lambda e: e.opex(ctx.flt, "Projects", projects_budget=True)
    sec = _mk_section(ctx, "tp", "Project TP opex — as reported", ctx.trace(fn), lambda s: _project_of(s, ctx.master, ctx.by_name),
                      source="Financial Reporting Package — Project Summary, “Opex” months flagged Act",
                      note="Actual months: the package cell shown. Forecast months: project master TP cost ÷ 12.")
    _residual(ctx, sec, cell_vec, _tp_label(ctx.col))
    sections = [sec]
    if ctx.measure in ("a_base", "af_plan"):
        led = _ledger_section(ctx, "tp-sap", "SAP expense dump (FBL3H) — lines for this region and period",
                              ctx.sap_trace(fn),
                              note="Opex postings of the MIS working file (SAP_Expense) that the report's own rules assign to this "
                                   "region. The package is the reconciled MIS; the dump is the raw booking behind it.")
        if not led["count"]:
            led["note"] = ("No SAP expense lines are loaded for these months. Upload the MIS working file "
                           "(SAP_Expense) in Admin → Imports to see the FBL3H postings here.")
        # per project: package vs dump
        by_proj = led.pop("by_project")
        for r in sec["rows"]:
            if not r.get("residual"):
                r["sap_total"] = round(by_proj.get(r["id"], by_proj.get("label:" + re.sub(r"[^0-9a-z]+", "", r["label"].lower()), 0.0)), 2)
        sections.append(led)
    return {"title": "Direct expenses — TP opex", "sections": sections}


def res_detail(ctx: Ctx, cell_vec: List[float], payroll_visible: bool) -> Dict[str, Any]:
    if not payroll_visible:
        raise Denied("Employee cost is confidential for your role")
    fn = lambda e: e.payroll(ctx.flt, "Projects")
    sec = _mk_section(ctx, "res", "Project resource cost — as reported", ctx.trace(fn), lambda s: _project_of(s, ctx.master, ctx.by_name),
                      source="Financial Reporting Package — Project Summary, “Direct Resource” months flagged Act",
                      note="Actual months: the package cell shown. Forecast months: payroll plan lines by project.")
    _residual(ctx, sec, cell_vec, _tp_label(ctx.col))
    sections = [sec]
    if ctx.measure in ("a_base", "af_plan"):
        rs = _mk_section(ctx, "res-file", "Resource cost file — cost by project and department", ctx.res_trace(fn),
                         lambda s: _project_of(s, ctx.master, ctx.by_name),
                         source="Resource cost file (employee × WBS × month, summed — never listed by employee)",
                         note="Salary postings in the SAP dump are not split by project, so the resource cost file is the line source "
                              "of employee cost.")
        by_proj = {r["id"]: r["total"] for r in rs["rows"]}
        for r in sec["rows"]:
            if not r.get("residual"):
                r["file_total"] = by_proj.get(r["id"], 0.0)
        sections.append(rs)
    return {"title": "Direct expenses — resource cost", "sections": sections}


# ---------------------------------------------------------------------------------------------- overheads
def oh_parts(row: str, rules: Dict[str, str]) -> Optional[List[Tuple[str, str]]]:
    """Regional P&L overhead line → [(department block, "tp" | "res")]."""
    order = [b for b, _ in OH_BLOCKS]
    kinds_of = {b: {k for k, *_ in parts} for b, parts in OH_BLOCKS}
    others = [b for b in order if b not in SALES_BLOCKS | MARKETING_BLOCKS and rules[b] != "ca_cr"]
    pick = lambda blocks, kind: [(b, kind) for b in order if b in blocks and kind in kinds_of[b]]
    if row in ("sales", "marketing"):
        grp = SALES_BLOCKS if row == "sales" else MARKETING_BLOCKS
        return pick(grp, "res") + pick(grp, "tp")
    for name, grp in (("sales", SALES_BLOCKS), ("marketing", MARKETING_BLOCKS)):
        if row == f"{name}_payroll":
            return pick(grp, "res")
        if row == f"{name}_oh":
            return pick(grp, "tp")
    if row == "tp_oh":
        return pick(set(others), "tp")
    if row == "res_oh":
        return pick(set(others), "res")
    for b in order:
        if row == "tp_" + _id(b) and "tp" in kinds_of[b]:
            return [(b, "tp")]
        if row == "ro_" + _id(b) and "res" in kinds_of[b]:
            return [(b, "res")]
    return None


def oh_detail(ctx: Ctx, parts: List[Tuple[str, str]], blocks_out, rules, payroll_visible: bool, title: str) -> Dict[str, Any]:
    cards = []
    for block, kind in parts:
        if kind == "res" and not payroll_visible:
            continue
        keys = [k for kd, k, _ in dict(OH_BLOCKS)[block] if kd == kind]
        f_all = Filters()
        if kind == "tp":
            fns = [lambda e, k=k: e.overhead_tp(f_all, k) for k in keys]
        else:
            fns = [lambda e, k=k: e.payroll(f_all, "Overheads", dept=k) for k in keys]
        rep = [t for fn in fns for t in ctx.trace(fn)]
        sec = _mk_section(ctx, f"{block}-{kind}", "As reported", rep, _dept_of,
                          source=("Financial Reporting Package — OH Summary_Dept (department × segment)" if kind == "tp"
                                  else "Financial Reporting Package — Resource Cost Raw (indirect functions)"),
                          note="Actual months: the package cell shown. Forecast / plan months: the overhead and payroll plan lines.")
        total = sec["total"]
        res_part, tp_part = blocks_out[block]
        part = res_part if kind == "res" else tp_part
        cellv = part[ctx.col][ctx.measure] if part else Vec([0.0] * 13)
        to_cell = sum(cellv[i] for i in ctx.idx)
        card = {"block": block, "kind": kind, "rule": rules[block], "block_total": total, "to_cell": round(to_cell, 2),
                "share": (to_cell / total) if total else 0.0, "sections": [sec]}
        if kind == "tp" and ctx.measure in ("a_base", "af_plan"):
            led = _ledger_section(ctx, f"{block}-sap", "SAP expense dump (FBL3H) — overhead lines of this department",
                                  [t for fn in fns for t in ctx.sap_trace(fn)])
            led.pop("by_project", None)
            if not led["count"]:
                led["note"] = "No SAP expense lines are loaded for these months (MIS working file → SAP_Expense)."
            card["sections"].append(led)
        if kind == "res" and ctx.measure in ("a_base", "af_plan"):
            rs = _mk_section(ctx, f"{block}-file", "Resource cost file — by department", [t for fn in fns for t in ctx.res_trace(fn)],
                             _dept_of, source="Resource cost file (summed, never listed by employee)")
            card["sections"].append(rs)
        cards.append(card)
    if len(cards) > 1:  # a department with nothing booked, planned or allocated is noise next to the others
        cards = [c for c in cards if c["block_total"] or c["to_cell"] or any(s.get("count") or s.get("rows") for s in c["sections"])]
    return {"title": title, "cards": cards, "sections": []}


# ---------------------------------------------------------------------------------------------- entry point
def regional_cell(data, actuals, sap, resource, cfg, *, row: str, col: str, measure: str, idx: List[int],
                  payroll_visible: bool) -> Dict[str, Any]:
    """What is behind one cell of the Regional P&L (row × column × measure, for the months in ``idx``)."""
    full = regional_pnl(data, actuals, cfg, True, keep_parts=True)
    rows = {r["id"]: r for r in full["rows"]}
    if row not in rows:
        raise KeyError(row)
    if measure not in ("a_base", "b_plan", "af_plan", "b_draft"):
        raise KeyError(measure)
    if col not in {c["key"] for c in full["columns"]}:
        raise KeyError(col)
    labels = {c["key"]: c["label"] for c in full["columns"]}
    meas = next(m for m in full["measures"] if m["key"] == measure)
    ctx = Ctx(data, actuals, sap, resource, cfg, measure, idx, col)
    R = rows[row]
    if R.get("sensitive") and not payroll_visible:
        raise Denied("Employee cost is confidential for your role")

    def vec_of(rid):
        r = rows[rid]
        return list(r["values"][measure][col]) if r.get("values") else [0.0] * 13

    cell_vec = vec_of(row) if R.get("values") else [0.0] * 13
    value = sum(cell_vec[i] for i in ctx.idx)
    out: Dict[str, Any] = {"row": {"id": row, "label": R["label"], "sign": R.get("sign", -1)}, "col": {"key": col, "label": labels[col]},
                           "measure": {"key": measure, "label": meas["label"]}, "months": ctx.month_meta(), "value": round(value, 2),
                           "cutoff": ctx.eng.cutoff("default")}
    rules = full["segment_rules"]

    if row in DERIVED or row in RATIOS:
        comp = DERIVED.get(row) or [(RATIOS[row][0], 1), (RATIOS[row][1], 1)]
        out.update(kind="derived", title=R["label"], ratio=row in RATIOS, components=[
            {"id": rid, "label": rows[rid]["label"], "sign": sg, "value": round(sum(vec_of(rid)[i] for i in ctx.idx), 2)}
            for rid, sg in comp])
        return out
    if row == "rev":
        out.update(kind="revenue", **revenue_detail(ctx, cell_vec))
    elif row == "tp_opex":
        out.update(kind="expense", **tp_detail(ctx, cell_vec))
    elif row == "res_opex":
        out.update(kind="expense", **res_detail(ctx, cell_vec, payroll_visible))
    elif row == "direct":
        t = tp_detail(ctx, vec_of("tp_opex"))
        parts = [{"title": t["title"], "value": round(sum(vec_of("tp_opex")[i] for i in ctx.idx), 2), "sections": t["sections"]}]
        if payroll_visible:
            r_ = res_detail(ctx, vec_of("res_opex"), payroll_visible)
            parts.append({"title": r_["title"], "value": round(sum(vec_of("res_opex")[i] for i in ctx.idx), 2), "sections": r_["sections"]})
        out.update(kind="expense", title="Direct expenses", parts=parts, sections=[])
    else:
        oh = oh_parts(row, rules)
        if oh is None:
            raise KeyError(row)
        out.update(kind="overhead", **oh_detail(ctx, oh, full["_blocks"], rules, payroll_visible, R["label"]))
    return out
