"""MIS report formats (WAISL Monthly Financial MIS pack) built on the same P&L engine.

* ``full_pnl``            — Detailed P&L, CA+CR · Solutions · Total (MIS slides 5a / 5c; YTD / MTD / full-year
                            is chosen on screen from the monthly vectors returned here)
* ``revenue_performance`` — Revenue by stream vs AOP (slide 4), with PAX drivers
* ``regional_pnl``        — Solutions P&L by region (slide 5b)

Every value is a 13-slot vector: 12 fiscal months (Apr..Mar) followed by the full-year total. The screen
sums months for YTD / MTD and uses slot 12 for the full year, so the full year keeps the engine's own
totals (e.g. the tax-computation override) while YTD and MTD add up months.

Measures (year columns): A <base>, B <plan>, <plan> A/F, B <draft>; <draft> A/F becomes available once the
cycle rolls forward (the admin moves the plan year).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .datasets import norm
from .periods import fy_months, period_label
from .pnl import OH_BLOCKS, Filters, PnLEngine, Series, _id

N = 13  # 12 months + full year
MEASURES = ["a_base", "b_plan", "af_plan", "b_draft"]

# Default department-block → segment mapping for indirect costs. "common" is apportioned between CA+CR and
# Solutions (and across regions) in proportion to revenue. Admin can override per block (config mis_segments).
DEFAULT_SEGMENTS = {
    "Product & Solutions": "solutions",
    "Front-End Sales": "solutions",
    "Marketing & Alliances": "solutions",
}
# Non-CUTE locations reported under Solutions in the segment view (non-GMR airports; config mis_solutions_noncute)
DEFAULT_SOLUTIONS_NONCUTE = ["Kuwait", "Kannur"]
SALES_BLOCKS = {"Front-End Sales"}
MARKETING_BLOCKS = {"Marketing & Alliances"}
REGIONS = ["ME", "SEA", "Europe", "ANZ", "Americas"]


class Vec(list):
    def __add__(self, o):
        return Vec(a + b for a, b in zip(self, o))

    def __sub__(self, o):
        return Vec(a - b for a, b in zip(self, o))

    def __mul__(self, o):
        if isinstance(o, (int, float)):
            return Vec(a * o for a in self)
        return Vec(a * b for a, b in zip(self, o))


def zero() -> Vec:
    return Vec([0.0] * N)


def vsum(items) -> Vec:
    out = zero()
    for v in items:
        out = out + v
    return out


def share(num: Vec, den: Vec) -> Vec:
    return Vec((a / b) if b else 0.0 for a, b in zip(num, den))


def measure_labels(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    base, plan, draft = cfg["base_fy"], cfg["plan_fy"], cfg["draft_fy"]
    q = lambda fy: "FY'" + fy[2:]
    return [
        {"key": "a_base", "label": f"{q(base)} A", "fy": base, "kind": "actual", "available": True},
        {"key": "b_plan", "label": f"{q(plan)} B", "fy": plan, "kind": "budget", "available": True},
        {"key": "af_plan", "label": f"{q(plan)} A/F", "fy": plan, "kind": "actual", "available": True},
        {"key": "b_draft", "label": f"{q(draft)} B", "fy": draft, "kind": "budget", "available": True},
        {"key": "af_draft", "label": f"{q(draft)} A/F", "fy": draft, "kind": "actual", "available": False,
         "note": f"Available once {draft} starts (admin rolls the plan cycle forward)"},
    ]


def months_meta(cfg: Dict[str, Any]) -> Dict[str, Any]:
    plan = cfg["plan_fy"]
    cut = (cfg.get("cutoffs") or {}).get("default") or ""
    pm = fy_months(plan)
    # default YTD / MTD month: the latest actual month of the current year, else the first month
    idx = max([i for i, p in enumerate(pm) if p <= cut], default=0)
    return {"labels": [period_label(p).split("-")[0] for p in pm], "plan_months": pm, "default_month": idx,
            "cutoff": cut}


# ---------------------------------------------------------------------------------------------- full P&L
def _pnl_vectors(pnl: Dict[str, Any]) -> Dict[str, Dict[str, Vec]]:
    """rows of the /pnl payload (unmasked) → {row_id: {measure: Vec}}."""
    months = {}
    for b in pnl["blocks"]:
        if b["key"] in MEASURES:
            months[b["key"]] = [c["key"] for c in b["columns"] if c.get("month")]
    out: Dict[str, Dict[str, Vec]] = {}
    for r in pnl["rows"]:
        if r.get("pct"):
            continue
        vals = r.get("values") or {}
        out[r["id"]] = {m: Vec([float(vals.get(k) or 0.0) for k in months[m]] + [float(vals.get(f"{m}:total") or 0.0)])
                        for m in MEASURES}
    return out


def segment_rules(cfg: Dict[str, Any]) -> Dict[str, str]:
    rules = dict(DEFAULT_SEGMENTS)
    rules.update({k: v for k, v in (cfg.get("mis_segments") or {}).items() if v in ("solutions", "ca_cr", "common")})
    return {b: rules.get(b, "common") for b, _ in OH_BLOCKS}


def solutions_noncute(data, actuals, cfg, flt: Filters) -> Dict[str, Vec]:
    """Non-CUTE revenue of the locations that belong to Solutions in the segment view."""
    locs = cfg.get("mis_solutions_noncute")
    locs = DEFAULT_SOLUTIONS_NONCUTE if locs is None else locs
    locs = [l for l in locs if flt.tag_ok(l)]
    if not locs:
        return {m: zero() for m in MEASURES}
    e0, e1 = engines(data, actuals, cfg)
    return measures_of(e0, e1, lambda e: _ssum(e.rev_noncute(Filters(flt.geo, l, flt.exclude), "Non-CUTE") for l in locs))


def full_pnl(pnl: Dict[str, Any], cfg: Dict[str, Any], payroll_visible: bool,
             noncute_sol: Optional[Dict[str, Vec]] = None) -> Dict[str, Any]:
    V = _pnl_vectors(pnl)
    ncs = noncute_sol or {m: zero() for m in MEASURES}
    for m in MEASURES:  # move the Solutions part of Non-CUTE into its own pseudo line
        V.setdefault("non_cute", {m2: zero() for m2 in MEASURES})
        V["non_cute"][m] = V["non_cute"][m] - ncs[m]
        V.setdefault("non_cute_sol", {})[m] = ncs[m]
    rules = segment_rules(cfg)
    rows: List[Dict[str, Any]] = []

    def get(rid, m):
        return V.get(rid, {}).get(m) or zero()

    def add(rid, label, seg_fn, *, parent=None, level=0, kind="line", sign=-1, sensitive=False, key_row=False):
        vals = {m: {k: list(v) for k, v in seg_fn(m).items()} for m in MEASURES}
        rows.append({"id": rid, "label": label, "parent": parent, "level": level, "kind": kind, "sign": sign,
                     "sensitive": sensitive, "key": key_row, "values": vals})

    def ratio(rid, label, num, den, parent=None):
        rows.append({"id": rid, "label": label, "parent": parent, "level": 0 if parent is None else 1, "kind": "pct",
                     "sign": 1, "ratio": [num, den], "sensitive": False, "key": False, "values": None})

    def seg(cacr_ids=(), sol_ids=()):
        def fn(m):
            c = vsum(get(i, m) for i in cacr_ids)
            s = vsum(get(i, m) for i in sol_ids)
            return {"cacr": c, "sol": s, "total": c + s}
        return fn

    def combine(*parts, signs=None):
        signs = signs or [1] * len(parts)

        def fn(m):
            out = {"cacr": zero(), "sol": zero(), "total": zero()}
            for p, sg in zip(parts, signs):
                v = p(m)
                for k in out:
                    out[k] = out[k] + v[k] * sg
            return out
        return fn

    # Revenue
    rev = seg(["cute", "non_cute", "change_request"], ["projects", "non_cute_sol"])
    add("rev", "Revenue from Operations", rev, kind="total", sign=1, key_row=True)
    add("rev_cute", "CUTE", seg(["cute"]), parent="rev", level=1, sign=1)
    add("rev_noncute", "Non CUTE", seg(["non_cute"]), parent="rev", level=1, sign=1)
    add("rev_cr", "Change Request", seg(["change_request"]), parent="rev", level=1, sign=1)
    add("rev_projects", "Project Revenue", seg([], ["projects"]), parent="rev", level=1, sign=1)
    if any(any(v) for v in ncs.values()):
        add("rev_noncute_sol", "Non CUTE - Solutions", seg([], ["non_cute_sol"]), parent="rev", level=1, sign=1)

    rev_share = seg(["revenue_share"])
    add("rev_share", "Revenue Share", rev_share)
    opex = seg(["tp_opex_ca", "tp_opex_cr"], ["tp_opex_projects"])
    add("opex_tp", "Operating Expenses (TP)", opex, kind="subtotal")
    add("opex_ca", "Opex Cost - CA", seg(["opex_cost"]), parent="opex_tp", level=1)
    add("opex_shared", "Shared Services - CA", seg(["opex_shared"]), parent="opex_tp", level=1)
    add("opex_cr", "TP Cost - Change Request", seg(["tp_opex_cr"]), parent="opex_tp", level=1)
    add("opex_pj", "TP Cost - Projects", seg([], ["tp_opex_projects"]), parent="opex_tp", level=1)
    emp_d = seg(["resource_cost_ca", "resource_cost_cr"], ["resource_cost_projects"])
    add("emp_direct", "Employee Cost — Direct", emp_d, kind="subtotal", sensitive=True)
    add("emp_active", "Active Headcount - CA", seg(["active_headcount"]), parent="emp_direct", level=1, sensitive=True)
    add("emp_tbh", "To be hired - CA", seg(["to_be_hired"]), parent="emp_direct", level=1, sensitive=True)
    add("emp_shared", "Shared cost across location - CA", seg(["shared_resources"]), parent="emp_direct", level=1, sensitive=True)
    add("emp_cr", "Resource Cost - CR", seg(["resource_cost_cr"]), parent="emp_direct", level=1, sensitive=True)
    add("emp_pj", "Resource Cost - Projects", seg([], ["resource_cost_projects"]), parent="emp_direct", level=1, sensitive=True)
    direct = combine(rev_share, opex, emp_d)
    add("total_direct", "Total Direct Expense", direct, kind="subtotal", key_row=True)
    gm = combine(rev, direct, signs=[1, -1])
    add("gm", "Gross Margin", gm, kind="total", sign=1, key_row=True)
    ratio("gm_pct", "GM %", "gm", "rev")

    # Indirect: department blocks split by segment rule; "common" apportioned by revenue
    def block_fn(block, kind):
        ids = ["oh_" + _id(label) for k, _key, label in dict(OH_BLOCKS)[block] if k == kind]
        rule = rules[block]

        def fn(m):
            amt = vsum(get(i, m) for i in ids)
            r = rev(m)
            if rule == "solutions":
                sol = amt
            elif rule == "ca_cr":
                sol = zero()
            else:
                sol = amt * share(r["sol"], r["total"])
            return {"cacr": amt - sol, "sol": sol, "total": amt}
        return fn

    res_blocks = [(b, block_fn(b, "res")) for b, parts in OH_BLOCKS if any(k == "res" for k, *_ in parts)]
    tp_blocks = [(b, block_fn(b, "tp")) for b, parts in OH_BLOCKS if any(k == "tp" for k, *_ in parts)]
    emp_i = combine(*[f for _, f in res_blocks])
    add("emp_indirect", "Employee Cost — Indirect", emp_i, kind="subtotal", sensitive=True)
    for b, f in res_blocks:
        add("ei_" + _id(b), b, f, parent="emp_indirect", level=1, sensitive=True)
    sga = combine(*[f for _, f in tp_blocks])
    add("sga", "Overhead Cost (SG&A)", sga, kind="subtotal")
    for b, f in tp_blocks:
        add("sga_" + _id(b), b, f, parent="sga", level=1)
    indirect = combine(emp_i, sga)
    add("total_indirect", "Total Indirect Expense", indirect, kind="subtotal", key_row=True)
    ebitda = combine(gm, indirect, signs=[1, -1])
    add("ebitda", "EBITDA", ebitda, kind="total", sign=1, key_row=True)
    ratio("ebitda_pct", "EBITDA %", "ebitda", "rev")

    dep, fin, inc = seg(["depreciation"]), seg(["interest"]), seg(["interest_income"])
    add("dep", "Depreciation", dep)
    add("fin", "Finance Costs", fin)
    add("oth_inc", "Other Income", inc, sign=1)
    pbt = combine(ebitda, dep, fin, inc, signs=[1, -1, -1, 1])
    add("pbt", "Profit / (Loss) Before Tax", pbt, kind="total", sign=1, key_row=True)
    tax, dtax = seg(["taxes"]), seg(["deferred_tax"])
    add("tax", "Tax", tax)
    add("dtax", "Deferred Tax", dtax)
    pat = combine(pbt, tax, dtax, signs=[1, -1, -1])
    add("pat", "PAT", pat, kind="total", sign=1, key_row=True)
    ratio("pat_pct", "PAT %", "pat", "rev")
    cash = combine(pat, dep, dtax)
    add("cash", "Cash Profit", cash, kind="total", sign=1, key_row=True)
    ratio("cash_pct", "Cash Profit %", "cash", "rev")

    _mask(rows, payroll_visible)
    return {"segments": [{"key": "cacr", "label": "CA+CR"}, {"key": "sol", "label": "Solutions"},
                         {"key": "total", "label": "Total"}],
            "measures": measure_labels(cfg), "months": months_meta(cfg), "rows": rows,
            "segment_rules": rules}


def _mask(rows, payroll_visible):
    if payroll_visible:
        return
    for r in rows:
        if r.get("sensitive"):
            r["values"] = None
            r["masked"] = True


# ---------------------------------------------------------------------------------------------- engines
def engines(data, actuals, cfg) -> Tuple[PnLEngine, PnLEngine]:
    base, plan, draft = cfg["base_fy"], cfg["plan_fy"], cfg["draft_fy"]
    tr = cfg.get("tax_rate", 0.25)
    return (PnLEngine(data, actuals, base, plan, cfg["cutoffs"], tr, approved_fy=plan),
            PnLEngine(data, actuals, plan, draft, cfg["cutoffs"], tr, approved_fy=plan))


def _vec(s: Series, months: List[str]) -> Vec:
    v = [float(s.get(p, 0.0)) for p in months]
    return Vec(v + [sum(v)])


def measures_of(e0: PnLEngine, e1: PnLEngine, fn) -> Dict[str, Vec]:
    """fn(engine) → Series; returns the four measures as 13-slot vectors."""
    s0, s1 = fn(e0), fn(e1)
    return {"a_base": _vec(s0, e0.base_m), "b_plan": _vec(s0, e0.plan_m),
            "af_plan": _vec(s1, e1.base_m), "b_draft": _vec(s1, e1.plan_m)}


# ---------------------------------------------------------------------------------------------- revenue
def revenue_performance(data, actuals, cfg, flt: Filters) -> Dict[str, Any]:
    e0, e1 = engines(data, actuals, cfg)
    rows: List[Dict[str, Any]] = []

    def sub(**kw):
        return Filters(kw.get("geo", flt.geo), kw.get("tag", flt.tag), flt.exclude, region=flt.region)

    def add(rid, label, vals, parent=None, kind="line"):
        rows.append({"id": rid, "label": label, "parent": parent, "level": 0 if parent is None else 1, "kind": kind,
                     "values": {m: list(v) for m, v in vals.items()}})
        return vals

    def distinct(ds, field, pred=lambda r: True):
        return sorted({str(r.get(field)).strip() for r in data.get(ds, []) if r.get(field) and pred(r)}, key=str.lower)

    streams = []
    cute = add("cute", "CUTE Revenue", measures_of(e0, e1, lambda e: e.rev_cute(flt)))
    for a in distinct("rev_cute", "airport"):
        if flt.tag_ok(a):
            add("cute_" + _id(a), a, measures_of(e0, e1, lambda e, a=a: e.rev_cute(sub(tag=a))), parent="cute")
    streams.append(cute)
    nc = add("non_cute", "Non-CUTE Revenue", measures_of(e0, e1, lambda e: e.rev_noncute(flt, "Non-CUTE")))
    for loc in distinct("rev_noncute", "location", lambda r: norm(r.get("stream")) == "non-cute"):
        if flt.tag_ok(loc):
            add("nc_" + _id(loc), loc, measures_of(e0, e1, lambda e, loc=loc: e.rev_noncute(sub(tag=loc), "Non-CUTE")),
                parent="non_cute")
    streams.append(nc)
    cr = add("cr", "Change Request", measures_of(e0, e1, lambda e: e.rev_projects(flt, "Change Request")))
    for t in distinct("rev_projects", "tag", lambda r: norm(r.get("category")) == "change request"):
        if flt.tag_ok(t):
            add("cr_" + _id(t), t, measures_of(e0, e1, lambda e, t=t: e.rev_projects(sub(tag=t), "Change Request")), parent="cr")
    streams.append(cr)
    pj = add("projects", "Project Revenue", measures_of(e0, e1, lambda e: e.rev_projects(flt, "Projects")))
    for g in ("India", "International"):
        if flt.geo_ok(g):
            add("pj_" + _id(g), g, measures_of(e0, e1, lambda e, g=g: e.rev_projects(sub(geo=g), "Projects")), parent="projects")
    streams.append(pj)
    add("total", "Total Revenue", {m: vsum(s[m] for s in streams) for m in MEASURES}, kind="total")
    return {"measures": measure_labels(cfg), "months": months_meta(cfg), "rows": rows, "pax": _pax(data, cfg, flt)}


def _pax(data, cfg, flt: Filters) -> List[Dict[str, Any]]:
    """Billable PAX from the CUTE drivers: <fy> PAX = plan (actual/forecast for the base year); rows whose metric
    mentions "actual" hold actual PAX for the current year."""
    fy_to_measure = {cfg["base_fy"]: "a_base", cfg["plan_fy"]: "b_plan", cfg["draft_fy"]: "b_draft"}
    out: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in data.get("rev_cute_drivers", []):
        metric = norm(r.get("metric"))
        if "pax" not in metric or not flt.tag_ok(r.get("airport")):
            continue
        fy = str(r.get("fy") or "")
        if "actual" in metric:
            m = "af_plan" if fy == cfg["plan_fy"] else "a_base" if fy == cfg["base_fy"] else None
        else:
            m = fy_to_measure.get(fy)
        if not m:
            continue
        vals = [float(r.get(f"m{i:02d}") or 0.0) for i in range(1, 13)]
        e = out.setdefault((r.get("airport"), r.get("pax_type") or "Combined"),
                           {"airport": r.get("airport"), "pax_type": r.get("pax_type") or "Combined", "measures": {}})
        e["measures"][m] = vals
    return list(out.values())


# ---------------------------------------------------------------------------------------------- regional
def regional_pnl(data, actuals, cfg, payroll_visible: bool) -> Dict[str, Any]:
    """Solutions P&L by region. Directly attributable costs are charged to their region (projects by region,
    payroll by location, overheads by India / International); common costs are apportioned by revenue."""
    e0, e1 = engines(data, actuals, cfg)
    rules = segment_rules(cfg)
    cols = ["india", "intl"] + [_id(r) for r in REGIONS] + ["total"]
    # geo decides India vs International; the region / location field only splits International further
    fl = {"india": Filters(geo="India"), "intl": Filters(geo="International"), "total": Filters()}
    for r in REGIONS:
        fl[_id(r)] = Filters(geo="International", region=r)

    def by_col(fn):  # fn(engine, filters) → Series  ⇒ {col: {measure: Vec}}
        return {c: measures_of(e0, e1, lambda e, c=c: fn(e, fl[c])) for c in cols}

    rev = by_col(lambda e, f: e.rev_projects(f, "Projects"))
    tp = by_col(lambda e, f: e.opex(f, "Projects", projects_budget=True))
    res = by_col(lambda e, f: e.payroll(f, "Projects"))
    all_rev = measures_of(e0, e1, lambda e: e.rev_projects(Filters(), "Projects") + e.rev_projects(Filters(), "Change Request")
                          + e.rev_cute(Filters()) + e.rev_noncute(Filters(), "Non-CUTE"))

    subs = [_id(r) for r in REGIONS]

    def intl_share(m):  # each sub-region's share of international revenue
        tot = vsum(rev[c][m] for c in subs)
        return {c: share(rev[c][m], tot) if any(tot) else Vec([1.0 / len(subs)] * N) for c in subs}

    def settle(v):
        """Direct amounts per column → international residual (not attributable to a sub-region) apportioned
        by revenue so the sub-regions add up to International."""
        out = {c: dict(v[c]) for c in cols}
        for m in MEASURES:
            resid = v["intl"][m] - vsum(v[c][m] for c in subs)
            sh = intl_share(m)
            for c in subs:
                out[c][m] = v[c][m] + resid * sh[c]
        return out

    def solutions_part(block, amounts):
        """Solutions' share of a department block (per the segment rules) spread across regions."""
        rule = rules[block]
        if rule == "ca_cr":
            return {c: {m: zero() for m in MEASURES} for c in cols}
        if rule == "solutions":
            return settle(amounts)
        out = {c: {} for c in cols}  # common: Solutions share of the total, apportioned by region revenue
        for m in MEASURES:
            sol_amt = amounts["total"][m] * share(rev["total"][m], all_rev[m])
            for c in cols:
                out[c][m] = sol_amt * share(rev[c][m], rev["total"][m])
        return out

    def oh_block(block):
        parts = dict(OH_BLOCKS)[block]
        res_keys = [k for kind, k, _ in parts if kind == "res"]
        tp_keys = [k for kind, k, _ in parts if kind == "tp"]
        r_amt = by_col(lambda e, f: _ssum(e.payroll(f, "Overheads", dept=k) for k in res_keys)) if res_keys else None
        t_amt = None
        if tp_keys:  # overhead lines only carry India / International
            geo_f = {"india": Filters(geo="India"), "intl": Filters(geo="International"), "total": Filters()}
            t_amt = {c: measures_of(e0, e1, lambda e, c=c: _ssum(e.overhead_tp(geo_f[c], k) for k in tp_keys))
                     if c in geo_f else {m: zero() for m in MEASURES} for c in cols}
        return (solutions_part(block, r_amt) if r_amt else None, solutions_part(block, t_amt) if t_amt else None)

    rows: List[Dict[str, Any]] = []

    def add(rid, label, v, parent=None, kind="line", sign=-1, sensitive=False, key_row=False):
        rows.append({"id": rid, "label": label, "parent": parent, "level": 0 if parent is None else 1, "kind": kind,
                     "sign": sign, "sensitive": sensitive, "key": key_row,
                     "values": {m: {c: list(v[c][m]) for c in cols} for m in MEASURES}})
        return v

    def ratio(rid, label, num, den):
        rows.append({"id": rid, "label": label, "parent": None, "level": 0, "kind": "pct", "sign": 1,
                     "ratio": [num, den], "values": None})

    def comb(*vs, signs=None):
        signs = signs or [1] * len(vs)
        return {c: {m: vsum(v[c][m] * s for v, s in zip(vs, signs)) for m in MEASURES} for c in cols}

    rev_s = add("rev", "Revenue Recognised", settle_rev(rev, subs, cols), kind="total", sign=1, key_row=True)
    tp_s, res_s = settle(tp), settle(res)
    direct = add("direct", "Direct Expenses", comb(tp_s, res_s), kind="subtotal")
    add("tp_opex", "TP Opex", tp_s, parent="direct")
    add("res_opex", "Resource Opex", res_s, parent="direct", sensitive=True)
    gm = add("gm", "Gross Margin", comb(rev_s, direct, signs=[1, -1]), kind="total", sign=1, key_row=True)
    ratio("gm_pct", "GM %", "gm", "rev")

    blocks = {b: oh_block(b) for b, _ in OH_BLOCKS}
    cm_less = []
    for grp, label in ((SALES_BLOCKS, "Sales"), (MARKETING_BLOCKS, "Marketing")):
        r_parts = [blocks[b][0] for b in grp if blocks[b][0]]
        t_parts = [blocks[b][1] for b in grp if blocks[b][1]]
        rp, tpp = comb(*r_parts) if r_parts else None, comb(*t_parts) if t_parts else None
        tot = add(_id(label), label, comb(*[x for x in (rp, tpp) if x]), kind="subtotal")
        if rp:
            add(_id(label) + "_payroll", "Payroll", rp, parent=_id(label), sensitive=True)
        if tpp:
            add(_id(label) + "_oh", "Overheads", tpp, parent=_id(label))
        cm_less.append(tot)
    cm = add("cm", "Contribution Margin", comb(gm, *cm_less, signs=[1] + [-1] * len(cm_less)), kind="total", sign=1, key_row=True)
    ratio("cm_pct", "Contribution Margin %", "cm", "rev")

    others = [b for b, _ in OH_BLOCKS if b not in SALES_BLOCKS | MARKETING_BLOCKS and rules[b] != "ca_cr"]
    tp_kids = [(b, blocks[b][1]) for b in others if blocks[b][1]]
    res_kids = [(b, blocks[b][0]) for b in others if blocks[b][0]]
    tp_oh = add("tp_oh", "TP Overheads", comb(*[v for _, v in tp_kids]), kind="subtotal")
    for b, v in tp_kids:
        add("tp_" + _id(b), b, v, parent="tp_oh")
    res_oh = add("res_oh", "Resource Overheads", comb(*[v for _, v in res_kids]), kind="subtotal", sensitive=True)
    for b, v in res_kids:
        add("ro_" + _id(b), b, v, parent="res_oh", sensitive=True)
    add("ebitda", "EBITDA", comb(cm, tp_oh, res_oh, signs=[1, -1, -1]), kind="total", sign=1, key_row=True)
    ratio("ebitda_pct", "EBITDA %", "ebitda", "rev")

    _mask(rows, payroll_visible)
    labels = {"india": "India", "intl": "International", "total": "Total", **{_id(r): r for r in REGIONS}}
    return {"columns": [{"key": c, "label": labels[c], "group": "india" if c == "india" else "total" if c == "total" else "intl",
                         "sub": c in subs} for c in cols],
            "measures": measure_labels(cfg), "months": months_meta(cfg), "rows": rows, "segment_rules": rules}


def settle_rev(rev, subs, cols):
    """Revenue is never apportioned; unmapped international revenue stays only in the International column."""
    return {c: dict(rev[c]) for c in cols}


def _ssum(items) -> Series:
    out = Series()
    for s in items:
        out = out + s
    return out


# ---------------------------------------------------------------------------------------------- catalogue
FORMATS = [
    {"key": "full_pnl", "label": "Full P&L — CA+CR & Solutions", "section": "aop_pnl", "ref": "MIS 5a / 5c",
     "description": "Detailed P&L by segment · FY / YTD / MTD toggle · collapsible"},
    {"key": "detailed_pnl", "label": "AOP P&L — WAISL format", "section": "aop_pnl", "ref": "AOP · WAISL P&L",
     "description": "The AOP workbook P&L, line by line, with monthly columns"},
    {"key": "revenue_performance", "label": "Revenue performance", "section": "aop_pnl", "ref": "MIS 4",
     "description": "Revenue by stream vs AOP (YTD & MTD) and billable PAX"},
    {"key": "regional_pnl", "label": "Regional P&L — Solutions", "section": "aop_pnl", "ref": "MIS 5b",
     "description": "Solutions P&L for India and international regions"},
    {"key": "margin_profile", "label": "Margin profile by airport", "section": "aop_reports", "ref": "AOP · Margin Profile"},
    {"key": "opex_forecast", "label": "Opex forecast", "section": "aop_reports", "ref": "Opex_Forecast"},
    {"key": "overheads", "label": "Overheads by department", "section": "aop_reports", "ref": "AOP · OH"},
    {"key": "wbs", "label": "WBS budget vs actual", "section": "aop_reports", "ref": "WBS"},
]


def formats_for(cfg: Dict[str, Any], allowed_sections: Optional[set], admin: bool) -> List[Dict[str, Any]]:
    enabled = cfg.get("report_formats") or {}
    out = []
    for f in FORMATS:
        on = enabled.get(f["key"], True)
        if not admin and (not on or (allowed_sections is not None and f["section"] not in allowed_sections)):
            continue
        out.append({**f, "enabled": on})
    return out
