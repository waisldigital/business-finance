"""Next-year AOP draft generator.

Seeds ``B<target>`` monthly budgets for every plan dataset from the source year's actual / forecast
(``F<src>`` when present, else ``B<src>``) and a small set of drivers. Users then refine the draft in
the grids (paste from Excel, approvals as configured). Existing target values are kept unless
``overwrite`` is set, so re-running never wipes user input.

Drivers default to the Assumptions tab (by code) and can be overridden in Plan settings:

  cute_growth         CUTE revenue growth (PAX × rate)            default 10%
  noncute_growth      Non-CUTE revenue growth                     Assumptions "Non-Cute Revenue Growth"
  cr_growth           Change Request revenue growth              Assumptions CR_Rev_Growth
  projects_growth     Project revenue & project TP cost growth   0%
  opex_escalation     Recurring opex escalation (one-time → 0)    Assumptions opex_escalation_india
  payroll_increment   Average increment                           Assumptions avg_increment_ind
  payroll_loading     CTC loading                                 Assumptions ctc_loading_india
  overhead_escalation Escalation on the CC+GL overhead run-rate   5%

Revenue share follows the location's CUTE + Non-CUTE growth (share % is unchanged).
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List, Tuple

from .datasets import norm, vkey
from .periods import fy_months, shift_fy

DEFAULTS = {"cute_growth": 0.10, "noncute_growth": 0.05, "cr_growth": 0.05, "projects_growth": 0.0,
            "opex_escalation": 0.07, "payroll_increment": 0.09, "payroll_loading": 0.027, "overhead_escalation": 0.05}
FROM_ASSUMPTIONS = {"opex_escalation": ["opex_escalation_india"], "payroll_increment": ["avg_increment_ind"],
                    "payroll_loading": ["ctc_loading_india"], "cr_growth": ["cr_rev_growth"]}


def default_drivers(assumptions: List[Dict[str, Any]]) -> Dict[str, float]:
    out = dict(DEFAULTS)
    by_code = {norm(a.get("code")): a for a in assumptions if a.get("code")}
    for k, codes in FROM_ASSUMPTIONS.items():
        for c in codes:
            a = by_code.get(norm(c))
            if a and isinstance(a.get("value"), (int, float)):
                out[k] = float(a["value"])
    for a in assumptions:  # "DIAL · Non-Cute Revenue Growth" → first one found
        if "non-cute revenue growth" in str(a.get("name", "")).lower() and isinstance(a.get("value"), (int, float)):
            out["noncute_growth"] = float(a["value"])
            break
    return out


class Draft:
    """Collects field updates per dataset/key and new rows; the router applies them."""

    def __init__(self, src_fy: str, target_fy: str, overwrite: bool):
        self.src, self.tgt = src_fy, target_fy
        self.S, self.T = "F" + src_fy[2:], "B" + target_fy[2:]
        self.SB = "B" + src_fy[2:]
        self.pairs = list(zip(fy_months(src_fy), fy_months(target_fy)))
        self.overwrite = overwrite
        self.updates: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
        self.new_rows: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.counts: Counter = Counter()

    def source(self, row: Dict[str, Any], p: str) -> float:
        k = vkey(self.S, p)
        v = row[k] if k in row else row.get(vkey(self.SB, p))
        return float(v) if isinstance(v, (int, float)) else 0.0

    def has_target(self, row: Dict[str, Any]) -> bool:
        return any(vkey(self.T, q) in row for _, q in self.pairs)

    def set_months(self, ds: str, key: str, row: Dict[str, Any], factor: float):
        if self.has_target(row) and not self.overwrite:
            self.counts[f"{ds}:kept"] += 1
            return
        upd = {vkey(self.T, q): round(self.source(row, p) * factor, 2) for p, q in self.pairs}
        self.updates[ds][key] = {**self.updates[ds].get(key, {}), **upd}
        self.counts[ds] += 1


def build_draft(rows: Dict[str, List[Tuple[str, Dict[str, Any]]]], actuals: List[Dict[str, Any]],
                src_fy: str, target_fy: str, drivers: Dict[str, float], overwrite: bool = False) -> Draft:
    d = Draft(src_fy, target_fy, overwrite)
    g = drivers

    # ---- CUTE: one new row per airport / passenger type for the target year
    cute_by_loc: Dict[str, Tuple[float, float]] = defaultdict(lambda: (0.0, 0.0))
    existing = {k for k, _ in rows.get("rev_cute", [])}
    for key, r in rows.get("rev_cute", []):
        if r.get("fy") != src_fy:
            continue
        src_total = sum(d.source(r, p) for p, _ in d.pairs)
        new = {k: r.get(k) for k in ("airport", "pax_type", "stream", "geo", "tag")}
        new["fy"] = target_fy
        new.update({vkey(d.T, q): round(d.source(r, p) * (1 + g["cute_growth"]), 2) for p, q in d.pairs})
        nkey = f"{new['airport']}|{new['pax_type']}|{target_fy}"
        if nkey in existing:
            if overwrite:
                d.updates["rev_cute"][nkey] = {k: v for k, v in new.items() if k.startswith(d.T)}
                d.counts["rev_cute"] += 1
        else:
            d.new_rows["rev_cute"].append(new)
            d.counts["rev_cute"] += 1
        a, b = cute_by_loc[norm(r.get("airport"))]
        cute_by_loc[norm(r.get("airport"))] = (a + src_total, b + src_total * (1 + g["cute_growth"]))

    # ---- Non-CUTE, then revenue share following the location's revenue growth
    for key, r in rows.get("rev_noncute", []):
        if norm(r.get("stream")) == "non-cute":
            d.set_months("rev_noncute", key, r, 1 + g["noncute_growth"])
            loc = norm(r.get("location"))
            a, b = cute_by_loc[loc]
            src_total = sum(d.source(r, p) for p, _ in d.pairs)
            cute_by_loc[loc] = (a + src_total, b + src_total * (1 + g["noncute_growth"]))
    for key, r in rows.get("rev_noncute", []):
        if norm(r.get("stream")) == "rev share":
            a, b = cute_by_loc.get(norm(r.get("location")), (0.0, 0.0))
            d.set_months("rev_noncute", key, r, (b / a) if a else 1.0)

    # ---- CR / project revenue lines
    for key, r in rows.get("rev_projects", []):
        cat = norm(r.get("category"))
        growth = g["cr_growth"] if cat == "change request" else g["projects_growth"]
        d.set_months("rev_projects", key, r, 1 + growth)

    # ---- project TP cost budget (annual, phased evenly by the engine)
    fld = f"tp_cost_b{target_fy[2:]}"
    for key, r in rows.get("project_master", []):
        if r.get(fld) is not None and not overwrite:
            continue
        base = r.get("tp_cost_b_plan")
        if isinstance(base, (int, float)):
            d.updates["project_master"][key] = {fld: round(base * (1 + g["projects_growth"]), 2)}
            d.counts["project_master"] += 1

    # ---- opex: recurring lines escalate, one-time lines drop out
    for key, r in rows.get("opex_lines", []):
        one_time = norm(r.get("recurring")) in ("non-recurring", "one-time", "one time")
        d.set_months("opex_lines", key, r, 0.0 if one_time else 1 + g["opex_escalation"])

    # ---- payroll
    for key, r in rows.get("payroll_lines", []):
        d.set_months("payroll_lines", key, r, 1 + g["payroll_increment"] + g["payroll_loading"])

    # ---- below EBITDA: carried forward, refined by finance
    for key, r in rows.get("pl_other", []):
        d.set_months("pl_other", key, r, 1.0)

    # ---- overheads: seed the Cost centre + GL plan from the ledger run-rate
    if overwrite or not rows.get("overhead_plan"):
        heads = {r.get("aop_head"): r for _, r in rows.get("overhead_lines", [])}
        agg: Dict[Tuple[str, str], Dict[str, Any]] = {}
        months = set()
        base_fy_months = set(fy_months(shift_fy(src_fy, -1)))
        for a in actuals:
            if a.get("domain") != "overhead" or a.get("entry_type") != "ledger" or a.get("period") not in base_fy_months:
                continue
            dm = a.get("dims") or {}
            cc, gl = str(dm.get("cost_centre") or "").strip(), str(dm.get("gl") or "").strip()
            if not cc and not gl:
                continue
            months.add(a["period"])
            line = heads.get(dm.get("aop_head")) or {}
            e = agg.setdefault((cc, gl), {"amount": 0.0, "dept": Counter(), "geo": Counter(), "head": Counter(), "desc": Counter()})
            e["amount"] += float(a.get("amount") or 0)
            e["dept"][line.get("pl_tag") or dm.get("department") or "Unmapped"] += 1
            e["geo"][line.get("geo") or "India"] += 1
            e["head"][dm.get("aop_head") or ""] += 1
            e["desc"][a.get("expense_head") or dm.get("vendor") or ""] += 1
        n_months = max(1, len(months))
        for (cc, gl), e in sorted(agg.items()):
            annual = round(e["amount"] * 12 / n_months * (1 + g["overhead_escalation"]), 2)
            row = {"cost_centre": cc, "gl": gl, "department": e["dept"].most_common(1)[0][0],
                   "geo": e["geo"].most_common(1)[0][0], "aop_head": e["head"].most_common(1)[0][0],
                   "description": e["desc"].most_common(1)[0][0], "basis": f"{shift_fy(src_fy, -1)} ledger run-rate × (1+{g['overhead_escalation']:.0%})",
                   f"annual_{d.T.lower()}": annual}
            row.update({vkey(d.T, q): round(annual / 12, 2) for _, q in d.pairs})
            d.new_rows["overhead_plan"].append(row)
        d.counts["overhead_plan"] = len(d.new_rows["overhead_plan"])
    return d
