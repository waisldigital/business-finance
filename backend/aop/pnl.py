"""WAISL P&L engine — a line-by-line rewrite of the ``WAISL P&L`` sheet formulas.

Column layout (mirrors the sheet)::

    B <base> | 12 base-FY months (actual ≤ cut-off, else forecast) | A <base> | 12 plan-FY months (budget) | B <plan> | Growth %

Filters mirror the sheet's selectors: ``geo`` (All / India / International — C1), ``tag`` (All / an
airport or reporting tag — C2) and ``exclude`` (reporting tags to leave out — AD1/AD2).

Every leaf line reads the single actuals source for actual months and the plan datasets for forecast
and budget months, with the same SUMIFS criteria as the workbook:

* CUTE → ``rev_cute`` (zero when geo = International)
* Non-CUTE / Rev share → ``rev_noncute`` by location
* Change Request / Projects revenue → ``rev_projects`` by Category-1
* Resource cost → ``payroll_lines`` by Category-1 and reporting tag (Shared Services allocated to an
  airport with the Assumptions allocation % when an airport is selected)
* TP opex → ``opex_lines`` by Category-1 (Projects budget from ``project_master`` TP cost / 12)
* Enabling overheads → payroll (Category "Overheads", department in reporting tag) + ``overhead_lines``
  by P&L tag (department), filtered by geo only
* Below EBITDA → ``pl_other``; tax in forecast/budget months = tax rate × PBT (as in the sheet)
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable, Dict, Iterable, List, Optional

from .datasets import norm, vkey
from .periods import fy_months, period_label

# Department blocks of "Enabling Overheads": (label, [(kind, key, row label)])
OH_BLOCKS = [
    ("Product & Solutions", [("res", "Solutions", "Solutions - Resources"),
                             ("tp", "Product & Solutions Overhead", "Product & Solutions Overhead - TP Overheads")]),
    ("Front-End Sales", [("res", "Front-End Sales", "Front-End Sales - Resources"),
                         ("tp", "BD - International", "BD - International - TP Overheads"),
                         ("res", "Pre-Sales", "Pre-Sales - Resources")]),
    ("Corporate", [("res", "Corporate", "Corporate - Resources"), ("tp", "Corporate", "Corporate - TP Overheads")]),
    ("Finance & Accounts", [("res", "Finance & Accounts", "Finance & Accounts - Resources"),
                            ("tp", "Finance & Accounts", "Finance & Accounts - TP Overheads")]),
    ("Admin", [("res", "Admin", "Admin - Resources"), ("tp", "Admin", "Admin - TP Overheads")]),
    ("HR", [("res", "HR", "HR - Resources"), ("tp", "HR", "HR - TP Overheads")]),
    ("Marketing & Alliances", [("res", "Marketing & Alliances Intt.", "Marketing & Alliances Intt. - Resources"),
                               ("res", "Marketing & Alliances India", "Marketing & Alliances India - Resources"),
                               ("tp", "Marketing", "Marketing - TP Overheads")]),
    ("Internal IT", [("res", "Internal IT", "Internal IT - Resources"), ("tp", "Internal IT", "Internal IT - TP Overheads")]),
    ("Quality & Governance", [("res", "Quality", "Quality - Resources"), ("tp", "Quality & Governance", "Quality & Governance - TP Overheads")]),
    ("Contract & Legal", [("res", "Contract & Legal", "Contract & Legal - Resources"), ("tp", "Contract & Legal", "Contract & Legal - TP Overheads")]),
    ("Procurement", [("res", "Procurement", "Procurement - Resources"), ("tp", "Procurement", "Procurement - TP Overheads")]),
    ("Partnerships & IR", [("res", "Partnerships & IR", "Partnerships & IR - Resources")]),
    ("Others", [("tp", "Digital", "Digital - TP Overheads"), ("tp", "Others", "Others - TP Overheads")]),
]

SHARED = "shared services"


class Filters:
    def __init__(self, geo: str = "All", tag: str = "All", exclude: Optional[Iterable[str]] = None):
        self.geo = geo or "All"
        self.tag = tag or "All"
        self.exclude = {norm(x) for x in (exclude or []) if x and norm(x) != "all"}

    @property
    def unfiltered(self) -> bool:
        return norm(self.geo) == "all" and norm(self.tag) == "all" and not self.exclude

    def geo_ok(self, v) -> bool:
        return norm(self.geo) == "all" or norm(v) == norm(self.geo)

    def tag_ok(self, v, *, apply_exclusions: bool = True) -> bool:
        t = norm(v)
        if apply_exclusions and t in self.exclude:
            return False
        return norm(self.tag) == "all" or t == norm(self.tag)


class Series(dict):
    """period/total → value, with arithmetic helpers."""

    def __add__(self, other: "Series") -> "Series":
        out = Series(self)
        for k, v in other.items():
            out[k] = out.get(k, 0.0) + v
        return out

    def __sub__(self, other: "Series") -> "Series":
        out = Series(self)
        for k, v in other.items():
            out[k] = out.get(k, 0.0) - v
        return out

    def scale(self, f: float) -> "Series":
        return Series({k: v * f for k, v in self.items()})


def ssum(items: Iterable[Series]) -> Series:
    out = Series()
    for s in items:
        out = out + s
    return out


class PnLEngine:
    def __init__(self, data: Dict[str, List[Dict[str, Any]]], actuals: List[Dict[str, Any]],
                 base_fy: str, plan_fy: str, cutoffs: Dict[str, str], tax_rate: float = 0.25,
                 approved_fy: Optional[str] = None):
        # approved_fy = the plan year of the imported, approved AOP. Year-specific sources (project
        # master TP budget, the frozen B<base> snapshot) only apply to that cycle.
        self.approved_fy = approved_fy or plan_fy
        self.data = data
        self.base_fy, self.plan_fy = base_fy, plan_fy
        self.base_m, self.plan_m = fy_months(base_fy), fy_months(plan_fy)
        self.F = "F" + base_fy[2:]
        self.B = "B" + plan_fy[2:]
        self.BB = "B" + base_fy[2:]
        self.cutoffs = cutoffs
        self.tax_rate = tax_rate
        self.act: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for a in actuals:
            if a.get("period") in self.base_m:
                self.act[a["domain"]].append(a)
        self.oh_by_head = {f.get("aop_head"): f for f in data.get("overhead_lines", [])}
        self.alloc = self._allocations()
        self.snapshot = {r.get("row_id"): r.get("value") for r in data.get("pl_snapshot", [])}
        self.overrides: Dict[str, float] = {}  # plan-total overrides (e.g. tax from the tax computation)

    # ------------------------------------------------------------------ helpers
    def _allocations(self) -> Dict[str, float]:
        out = {}
        for a in self.data.get("assumptions", []):
            name = str(a.get("name") or "")
            if "shared services cost allocation" in name.lower():
                airport = name.split("·")[-1].strip()
                val = a.get("value")
                if val is None:
                    idx = int(a.get("scenario") or 2)
                    val = [a.get("low"), a.get("base"), a.get("high")][max(0, min(2, idx - 1))]
                if isinstance(val, (int, float)):
                    out[norm(airport)] = float(val)
        return out

    def alloc_factor(self, f: Filters) -> float:
        if norm(f.tag) == "all":
            return 1.0
        return self.alloc.get(norm(f.tag), 0.0)

    def cutoff(self, domain: str) -> str:
        return self.cutoffs.get(domain) or self.cutoffs.get("default") or self.base_m[0]

    def line_series(self, dataset: str, domain: Optional[str], pred_row: Callable[[Dict[str, Any]], bool],
                    pred_act: Optional[Callable[[Dict[str, Any]], bool]] = None, plan_ver: Optional[str] = None,
                    plan_fn: Optional[Callable[[Dict[str, Any], str], float]] = None,
                    b_base_fn: Optional[Callable[[Dict[str, Any]], float]] = None,
                    fcst_fn: Optional[Callable[[Dict[str, Any], str], float]] = None) -> Series:
        rows = [r for r in self.data.get(dataset, []) if pred_row(r)]
        s = Series()
        cut = self.cutoff(domain or dataset)
        if domain:
            pa = pred_act or pred_row
            for a in self.act.get(domain, []):
                if a["period"] <= cut and pa(a.get("dims") or {}):
                    s[a["period"]] = s.get(a["period"], 0.0) + a["amount"]
        for p in self.base_m:
            if p > cut:  # forecast; a line without a forecast for the month falls back to that year's budget
                s[p] = s.get(p, 0.0) + (sum(fcst_fn(r, p) for r in rows) if fcst_fn else
                                        sum(_n(r[vkey(self.F, p)]) if vkey(self.F, p) in r else _n(r.get(vkey(self.BB, p)))
                                            for r in rows))
        ver = plan_ver or self.B
        for p in self.plan_m:
            s[p] = s.get(p, 0.0) + (sum(plan_fn(r, p) for r in rows) if plan_fn else sum(_n(r.get(vkey(ver, p))) for r in rows))
        if b_base_fn:
            s["b_base"] = sum(b_base_fn(r) for r in rows)
        return s

    # ------------------------------------------------------------------ leaves
    def rev_cute(self, f: Filters) -> Series:
        if norm(f.geo) == "international":
            return Series()
        return self.line_series("rev_cute", "rev_cute", lambda r: f.tag_ok(r.get("airport") or r.get("tag")),
                                b_base_fn=lambda r: _n(r.get(vkey(self.BB, "total"))))

    def rev_noncute(self, f: Filters, stream: str) -> Series:
        dom = "rev_noncute" if stream == "Non-CUTE" else "rev_share"
        pred = lambda r: norm(r.get("stream")) == norm(stream) and f.tag_ok(r.get("location") or r.get("tag")) and f.geo_ok(r.get("geo"))
        return self.line_series("rev_noncute", dom, pred, pred_act=lambda d: norm(d.get("stream")) == norm(stream) and f.tag_ok(d.get("tag")) and f.geo_ok(d.get("geo")),
                                b_base_fn=lambda r: _n(r.get(vkey(self.BB, "total"))))

    def rev_projects(self, f: Filters, category: str) -> Series:
        pred = lambda r: norm(r.get("category")) == norm(category) and f.geo_ok(r.get("geo")) and f.tag_ok(r.get("tag"))
        s = self.line_series("rev_projects", "rev_projects", pred,
                             pred_act=lambda d: norm(d.get("stream")) == norm(category) and f.geo_ok(d.get("geo")) and f.tag_ok(d.get("tag")))
        if category == "Projects":
            s["b_base"] = sum(_n(r.get("revenue_b_base")) for r in self.data.get("project_master", [])
                              if norm(r.get("category")) == "projects" and f.tag_ok(r.get("tag"), apply_exclusions=False))
        return s

    def payroll(self, f: Filters, category: str, *, shared: Optional[bool] = None, dept: Optional[str] = None,
                ver: Optional[str] = None, zero_base: bool = False) -> Series:
        def ok(r):
            if norm(r.get("category")) != norm(category) or not f.geo_ok(r.get("geo")):
                return False
            t = norm(r.get("tag"))
            if dept is not None:
                return t == norm(dept)
            if shared is True:
                return t == SHARED
            if shared is False and t == SHARED:
                return False
            return f.tag_ok(r.get("tag"))
        ver = ver or self.B
        fcst_fn = None
        if ver.endswith("A"):    # active headcount; plans without the split treat the whole budget as active
            plan_fn = lambda r, p: _n(r.get(vkey(ver, p), r.get(vkey(self.B, p))))
            fcst_fn = lambda r, p: _n(r[vkey(self.BB + "A", p)]) if vkey(self.BB + "A", p) in r else \
                _n(r[vkey(self.F, p)]) if vkey(self.F, p) in r else _n(r.get(vkey(self.BB, p)))
        elif ver.endswith("T"):  # to be hired: only exists where the year's budget has the split
            plan_fn = lambda r, p: _n(r.get(vkey(ver, p)))
            fcst_fn = lambda r, p: _n(r.get(vkey(self.BB + "T", p)))
        else:
            plan_fn = None
        s = self.line_series("payroll_lines", "payroll", ok, plan_ver=ver, plan_fn=plan_fn, fcst_fn=fcst_fn,
                             b_base_fn=lambda r: _n(r.get(vkey(self.BB, "total"))))
        if zero_base:  # nothing "to be hired" in actual months or the prior-year budget column
            cut = self.cutoff("payroll")
            s = Series({k: (0.0 if ((k in self.base_m and k <= cut) or k == "b_base") else v) for k, v in s.items()})
        if shared:
            s = s.scale(self.alloc_factor(f))
        return s

    def opex(self, f: Filters, category: str, *, shared: Optional[bool] = None, projects_budget: bool = False) -> Series:
        def ok(r):
            if norm(r.get("category")) != norm(category) or not f.geo_ok(r.get("geo")):
                return False
            t = norm(r.get("tag"))
            if shared is True:
                return t == SHARED
            if shared is False and t == SHARED:
                return False
            return f.tag_ok(r.get("tag"))
        s = self.line_series("opex_lines", "opex", ok)
        if projects_budget:  # the plan uses project master TP cost / 12 instead of PO lines
            pm = [r for r in self.data.get("project_master", [])
                  if norm(r.get("category")) == norm(category) and f.geo_ok(r.get("geo")) and f.tag_ok(r.get("tag"))]
            fld = "tp_cost_b_plan" if self.plan_fy == self.approved_fy else f"tp_cost_b{self.plan_fy[2:]}"
            if any(fld in r for r in pm):
                annual = sum(_n(r.get(fld)) for r in pm)
                for p in self.plan_m:
                    s[p] = annual / 12
            if self.base_fy == self.approved_fy:  # current-year forecast falls back to the approved master budget
                annual = sum(_n(r.get("tp_cost_b_plan")) for r in pm)
                cut = self.cutoff("opex")
                for p in self.base_m:
                    if p > cut:
                        s[p] = annual / 12
        if shared:
            s = s.scale(self.alloc_factor(f))
        return s

    def overhead_tp(self, f: Filters, dept: Optional[str]) -> Series:
        ok = lambda r: (dept is None or norm(r.get("pl_tag")) == norm(dept)) and f.geo_ok(r.get("geo"))

        def act_ok(d):
            line = self.oh_by_head.get(d.get("aop_head"))
            return bool(line) and ok(line)
        s = self.line_series("overhead_lines", "overhead", ok, pred_act=act_ok,
                             b_base_fn=lambda r: _n(r.get("b_fy" + self.base_fy[2:])))
        # next-year overheads are planned on Cost centre + GL (overhead_plan); add them to the plan months
        plan_rows = [r for r in self.data.get("overhead_plan", [])
                     if (dept is None or norm(r.get("department")) == norm(dept)) and f.geo_ok(r.get("geo") or "India")]
        for p in self.plan_m:
            add = 0.0
            for r in plan_rows:
                add += _n(r[vkey(self.B, p)]) if vkey(self.B, p) in r else _n(r.get("annual_" + self.B.lower())) / 12
            if add:
                s[p] = s.get(p, 0.0) + add
        return s

    def pl_other(self, line: str) -> Series:
        s = self.line_series("pl_other", "pl_other", lambda r: r.get("line") == line,
                             pred_act=lambda d: d.get("line") == line)
        tot = [r.get(vkey(self.B, "total")) for r in self.data.get("pl_other", []) if r.get("line") == line]
        if tot and tot[0] is not None:
            self.overrides[line] = float(tot[0])
        return s

    # ------------------------------------------------------------------ assemble
    def compute(self, f: Filters) -> Dict[str, Any]:
        rows: List[Dict[str, Any]] = []

        def add(rid, label, s, *, level=2, kind="line", sensitive=False, pct=False, snap=None):
            # percentage rows receive (numerator, denominator) so every column — totals included —
            # is computed as a ratio of the rendered sums, exactly like IFERROR(x/y, 0) in the sheet
            rows.append({"id": rid, "label": label, "series": s, "level": level, "kind": kind,
                         "sensitive": sensitive, "pct": pct, "snap": snap})
            return s

        cute = self.rev_cute(f)
        noncute = self.rev_noncute(f, "Non-CUTE")
        cr = self.rev_projects(f, "Change Request")
        proj = self.rev_projects(f, "Projects")
        if norm(f.geo) != "international":
            cr["b_base"] = self.snapshot.get("change_request", 0.0) or 0.0
        revenue = cute + noncute + cr + proj
        add("revenue", "Revenue", revenue, level=0, kind="total", snap="revenue")
        add("cute", "CUTE", cute, snap="cute")
        add("non_cute", "Non CUTE", noncute, snap="non_cute")
        add("change_request", "Change Request", cr, snap="change_request")
        add("projects", "Project based Revenue", proj, snap="project_based_revenue")

        rev_share = self.rev_noncute(f, "Rev Share")
        res_active = self.payroll(f, "CA", shared=False, ver=self.B + "A")
        res_tbh = self.payroll(f, "CA", shared=False, ver=self.B + "T", zero_base=True)
        res_direct = res_active + res_tbh
        res_shared = self.payroll(f, "CA", shared=True)
        res_ca = res_direct + res_shared
        opex_ca = self.opex(f, "CA", shared=False)
        opex_sh = self.opex(f, "CA", shared=True)
        tp_ca = opex_ca + opex_sh
        opex_cr = self.opex(f, "Change Request")
        res_cr = self.payroll(f, "CR")
        tot_cr = opex_cr + res_cr
        opex_pj = self.opex(f, "Projects", projects_budget=True)
        res_pj = self.payroll(f, "Projects")
        tot_pj = opex_pj + res_pj
        direct = rev_share + res_ca + tp_ca + tot_cr + tot_pj
        add("direct_cost", "Direct Cost", direct, level=0, kind="total", snap="direct_cost")
        add("revenue_share", "Revenue Share", rev_share, snap="revenue_share")
        add("resource_cost_ca", "Resource Cost - CA", res_ca, level=1, kind="subtotal", sensitive=True, snap="resource_cost_ca")
        add("direct_resource_cost", "Direct Resource Cost", res_direct, level=2, kind="subtotal", sensitive=True, snap="direct_resource_cost")
        add("active_headcount", "- Active Headcount", res_active, level=3, sensitive=True, snap="active_headcount")
        add("to_be_hired", f"- To be hired (for B {self.plan_fy} only)", res_tbh, level=3, sensitive=True, snap="to_be_hired_for_b_fy_27_only")
        add("shared_resources", "Shared cost across location", res_shared, level=2, sensitive=True, snap="shared_cost_across_location")
        add("tp_opex_ca", "TP Cost (Opex) - CA", tp_ca, level=1, kind="subtotal", snap="tp_cost_opex_ca")
        add("opex_cost", "Opex Cost", opex_ca, level=2, snap="opex_cost")
        add("opex_shared", "Shared Services", opex_sh, level=2, snap="shared_services")
        add("total_cost_cr", "Total Cost - Change request", tot_cr, level=1, kind="subtotal", snap="total_cost_change_request")
        add("tp_opex_cr", "TP Cost (Opex) - Change request", opex_cr, level=2, snap="tp_cost_opex_change_request")
        add("resource_cost_cr", "Resource Cost - CR", res_cr, level=2, sensitive=True, snap="resource_cost_cr")
        add("total_cost_projects", "Total Cost - Projects", tot_pj, level=1, kind="subtotal", snap="total_cost_projects")
        add("tp_opex_projects", "TP Cost (Opex) - Projects", opex_pj, level=2, snap="tp_cost_opex_projects")
        add("resource_cost_projects", "Resource Cost - Projects", res_pj, level=2, sensitive=True, snap="resource_cost_projects")

        gm = revenue - direct
        add("gross_margin", "Gross Margin", gm, level=0, kind="total", snap="gross_margin")
        add("gm_pct", "Gross Margin% - Overall", (gm, revenue), pct=True, snap="gross_margin_overall")
        ca_rev = cute + noncute
        add("gm_pct_ca", "Gross Margin% - CA", (ca_rev - (rev_share + res_ca + tp_ca), ca_rev), pct=True, snap="gross_margin_ca")
        add("gm_pct_cr", "Gross Margin% - Change Request", (cr - tot_cr, cr), pct=True, snap="gross_margin_change_request")
        cacr = ca_rev + cr
        add("gm_pct_cacr", "Gross Margin% - CA + CR", (cacr - (rev_share + res_ca + tp_ca + tot_cr), cacr), pct=True, snap="gross_margin_ca_cr")
        add("gm_pct_projects", "Gross Margin% - Projects", (proj - tot_pj, proj), pct=True, snap="gross_margin_projects")
        add("total_direct_tp", "Total - Direct TP Cost", tp_ca + opex_cr + opex_pj, level=1, kind="memo", snap="total_direct_tp_cost")
        add("total_direct_res", "Total - Direct Resource Cost", res_ca + res_cr + res_pj, level=1, kind="memo", sensitive=True, snap="total_direct_resource_cost")

        oh_rows = []
        blocks = []
        for block, parts in OH_BLOCKS:
            leaves = []
            for kind, key, label in parts:
                s = self.payroll(f, "Overheads", dept=key) if kind == "res" else self.overhead_tp(f, key)
                leaves.append((kind, label, s))
            tot = ssum(s for _, _, s in leaves)
            blocks.append(tot)
            oh_rows.append((block, tot, leaves))
        enabling = ssum(blocks)
        add("enabling_overheads", "Enabling Overheads", enabling, level=0, kind="total", snap="enabling_overheads")
        for block, tot, leaves in oh_rows:
            add("oh_" + _id(block), block, tot, level=1, kind="subtotal", snap=_id(block))
            for kind, label, s in leaves:
                add("oh_" + _id(label), label, s, level=2, sensitive=(kind == "res"), snap=_id(label))

        ebitda = gm - enabling
        add("ebitda", "EBITDA", ebitda, level=0, kind="total", snap="ebitda")
        add("ebitda_pct", "EBITDA %", ("ebitda", "revenue"), pct=True, snap="ebitda#2")

        res_oh = self._payroll_all_overheads(f)
        tp_oh = self.overhead_tp(f, None)
        add("total_enabling_fyi", "Total Enabling Cost (FYI only)", res_oh + tp_oh, level=1, kind="memo", snap="total_enabling_cost_fyi_only")
        add("total_resource_fyi", "Total Resource Cost", res_oh, level=2, kind="memo", sensitive=True, snap="total_resource_cost")
        add("total_tp_oh_fyi", "Total TP Overhead Cost", tp_oh, level=2, kind="memo", snap="total_tp_overhead_cost")

        dep = self.pl_other("depreciation")
        intr = self.pl_other("interest")
        inc = self.pl_other("interest_income")
        pbt = ebitda - (dep + intr) + inc
        tax = self.pl_other("taxes")
        # tax in forecast / budget months follows the sheet: tax rate × PBT of that month
        cut = self.cutoff("pl_other")
        for p in [p for p in self.base_m if p > cut] + self.plan_m:
            tax[p] = pbt.get(p, 0.0) * self.tax_rate
        dtax = self.pl_other("deferred_tax")
        add("depreciation", "Less: Depreciation", dep, snap="less_depreciation")
        add("interest", "Less: Interest", intr, snap="less_interest")
        add("interest_income", "Add: Interest Income", inc, snap="add_interest_income")
        add("pbt", "PBT", pbt, level=0, kind="total", snap="pbt")
        add("taxes", "Less: Taxes", tax, snap="less_taxes")
        add("deferred_tax", "Less: Deferred Tax", dtax, snap="less_deferred_tax")
        pat = pbt - (tax + dtax)
        add("pat", "PAT", pat, level=0, kind="total", snap="pat")
        add("pat_pct", "PAT Margin", ("pat", "revenue"), pct=True, snap="pat_margin")
        cash = pat + dep + dtax
        add("cash_profit", "Cash Profit", cash, level=0, kind="total", snap="cash_profit")
        add("cash_pct", "Cash Profit Margin", ("cash_profit", "revenue"), pct=True, snap="cash_profit_margin")

        return self._render(rows, f)

    def _payroll_all_overheads(self, f: Filters) -> Series:
        ok = lambda r: norm(r.get("category")) == "overheads" and f.geo_ok(r.get("geo"))
        return self.line_series("payroll_lines", "payroll", ok, b_base_fn=lambda r: _n(r.get(vkey(self.BB, "total"))))

    # ------------------------------------------------------------------ output
    def columns(self) -> List[Dict[str, Any]]:
        cols = [{"key": "b_base", "label": f"B {self.base_fy}", "kind": "budget"}]
        for p in self.base_m:
            kind = "actual" if p <= self.cutoff("default") else "forecast"
            cols.append({"key": p, "label": period_label(p), "kind": kind, "fy": self.base_fy})
        cols.append({"key": "af_base", "label": f"A {self.base_fy}", "kind": "total"})
        for p in self.plan_m:
            cols.append({"key": p, "label": period_label(p), "kind": "budget", "fy": self.plan_fy})
        cols.append({"key": "b_plan", "label": f"B {self.plan_fy}", "kind": "total"})
        cols.append({"key": "growth", "label": "Growth %", "kind": "pct"})
        return cols

    def _values(self, s: Series, f: Filters) -> Dict[str, Any]:
        vals = {p: s.get(p, 0.0) for p in self.base_m + self.plan_m}
        vals["af_base"] = sum(s.get(p, 0.0) for p in self.base_m)
        vals["b_plan"] = sum(s.get(p, 0.0) for p in self.plan_m)
        vals["b_base"] = s.get("b_base", 0.0)
        vals["growth"] = (vals["b_plan"] - vals["af_base"]) / abs(vals["af_base"]) if vals["af_base"] else None
        return vals

    # Totals the sheet derives from other rows' totals rather than summing the months
    DERIVED = {
        "pbt": lambda t: t["ebitda"] - (t["depreciation"] + t["interest"]) + t["interest_income"],
        "pat": lambda t: t["pbt"] - (t["taxes"] + t["deferred_tax"]),
        # Cash Profit's plan total is SUM of its months in the sheet (not PAT + Dep + DT totals)
    }

    def _render(self, rows, f: Filters) -> Dict[str, Any]:
        out, by_id = [], {}
        for r in rows:
            vals = None if r["pct"] else self._values(r["series"], f)
            if vals is not None:
                if f.unfiltered and r["id"] in self.overrides:
                    vals["b_plan"] = self.overrides[r["id"]]
                # B <base> is a frozen historical budget — use the approved snapshot when unfiltered
                if f.unfiltered and self.plan_fy == self.approved_fy and r["snap"] and r["snap"] in self.snapshot:
                    vals["b_base"] = self.snapshot[r["snap"]]
            row = {k: r[k] for k in ("id", "label", "level", "kind", "sensitive", "pct")} | {"values": vals}
            out.append(row)
            by_id[r["id"]] = (row, r)
        for rid, fn in self.DERIVED.items():
            if rid in by_id:
                v = by_id[rid][0]["values"]
                v["b_plan"] = fn({k: by_id[k][0]["values"]["b_plan"] for k in ("ebitda", "depreciation", "interest", "interest_income",
                                                                                "pbt", "taxes", "deferred_tax", "pat") if k in by_id})
                v["growth"] = (v["b_plan"] - v["af_base"]) / abs(v["af_base"]) if v["af_base"] else None
        for row in out:
            if not row["pct"]:
                continue
            src = by_id[row["id"]][1]
            num_s, den_s = src["series"]
            n = by_id[num_s][0]["values"] if isinstance(num_s, str) else self._values(num_s, f)
            d = by_id[den_s][0]["values"] if isinstance(den_s, str) else self._values(den_s, f)
            vals = {k: (n[k] / d[k] if d.get(k) else 0.0) for k in n if k != "growth"}
            if f.unfiltered and self.plan_fy == self.approved_fy and src["snap"] in self.snapshot:
                vals["b_base"] = self.snapshot[src["snap"]] / 1e7  # snapshot stores ratios ×1e7 like amounts
            vals["growth"] = None
            row["values"] = vals
        return {"columns": self.columns(), "rows": out,
                "meta": {"base_fy": self.base_fy, "plan_fy": self.plan_fy, "cutoffs": self.cutoffs}}


def _n(v) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _id(label: str) -> str:
    import re
    return re.sub(r"[^0-9a-z]+", "_", label.lower()).strip("_")
