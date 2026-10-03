"""AOP reports built on the same datasets and single actual source as the P&L."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List

from .datasets import norm, vkey
from .periods import fy_months, shift_fy
from .pnl import Filters, PnLEngine

MARGIN_ROWS = ["revenue", "cute", "non_cute", "change_request", "projects", "direct_cost", "revenue_share",
               "resource_cost_ca", "tp_opex_ca", "total_cost_cr", "total_cost_projects", "gross_margin"]
AIRPORTS = ["DIAL", "GHIAL", "GGIAL", "GVIAL"]


def _block_engine(block: str, data, actuals, cfg):
    base, plan = cfg["base_fy"], cfg["plan_fy"]
    draft = cfg.get("draft_fy") or shift_fy(plan, 1)
    if block in ("a_base", "b_plan"):
        eng = PnLEngine(data, actuals, base, plan, cfg["cutoffs"], cfg.get("tax_rate", 0.25), approved_fy=plan)
        key = "af_base" if block == "a_base" else "b_plan"
        label = f"A {base}" if block == "a_base" else f"B {plan}"
    else:
        eng = PnLEngine(data, actuals, plan, draft, cfg["cutoffs"], cfg.get("tax_rate", 0.25), approved_fy=plan)
        key = "af_base" if block == "af_plan" else "b_plan"
        label = f"{plan} A/F" if block == "af_plan" else f"B {draft}"
    return eng, key, label


def margin_profile(data, actuals, cfg, block: str, tags: List[str], payroll_visible: bool) -> Dict[str, Any]:
    """Revenue, direct cost and gross margin per airport / reporting tag (overheads are not allocated)."""
    eng, key, label = _block_engine(block, data, actuals, cfg)
    out = []
    for t in tags + ["All"]:
        res = eng.compute(Filters(tag=t))
        vals = {r["id"]: (r["values"] or {}).get(key) for r in res["rows"] if r["id"] in MARGIN_ROWS}
        rev = vals.get("revenue") or 0.0
        vals["gm_pct"] = (vals.get("gross_margin") or 0.0) / rev if rev else None
        if not payroll_visible:
            vals["resource_cost_ca"] = None
        out.append({"tag": "Total" if t == "All" else t, **vals})
    return {"block": block, "label": label, "rows": out}


def opex_forecast(tracker: List[Dict[str, Any]], plan_fy: str, group_by: str) -> Dict[str, Any]:
    """Tracker lines grouped: budget (Budgeted FY'<plan>), forecast, and how many lines have a new PO linked or are
    not migrated (mapping status)."""
    F = "F" + plan_fy[2:]
    months = fy_months(plan_fy)
    groups: Dict[str, Dict[str, Any]] = {}
    for r in tracker:
        g = str(r.get(group_by) or "(blank)")
        fc = sum(float(r.get(vkey(F, p)) or 0) for p in months)
        bud = float(r.get(vkey("B" + plan_fy[2:], "annual"), r.get("budget_plan")) or 0)
        e = groups.setdefault(g, {"group": g, "lines": 0, "budget": 0.0, "forecast": 0.0, "new_po_mapped": 0,
                                  "not_migrated": 0, "recurring": 0, "one_time": 0, "items": []})
        e["lines"] += 1
        e["budget"] += bud
        e["forecast"] += fc
        status = str(r.get("mapping_status") or "")
        if (r.get("active_po_count") or 0) > 0:
            e["new_po_mapped"] += 1
        if status.lower().startswith("not migrated"):
            e["not_migrated"] += 1
        if str(r.get("recurring") or "").lower().startswith("recurring"):
            e["recurring"] += 1
        else:
            e["one_time"] += 1
        e["items"].append({"line_id": r.get("line_id"), "old_po": r.get("previous_po") or r.get("po"),
                           "new_po": r.get("latest_po") if (r.get("active_po_count") or 0) > 0 else None,
                           "vendor": r.get("vendor") or r.get("supplier_name"), "aop_code": r.get("aop_code"),
                           "category": r.get("category"), "tag": r.get("tag"), "recurring": r.get("recurring"),
                           "mapping_status": status or None, "budget": bud, "forecast": fc,
                           "override": bool(r.get("override_amount"))})
    rows = sorted(groups.values(), key=lambda x: -x["budget"])
    for e in rows:
        e["variance"] = e["budget"] - e["forecast"]
        e["items"].sort(key=lambda x: -x["budget"])
    return {"rows": rows, "group_by": group_by}


def overheads_by_department(data, actuals, cfg) -> Dict[str, Any]:
    base, plan = cfg["base_fy"], cfg["plan_fy"]
    draft = cfg.get("draft_fy") or shift_fy(plan, 1)
    B, T = "B" + plan[2:], "B" + draft[2:]
    heads = {r.get("aop_head"): r for r in data.get("overhead_lines", [])}
    base_m = set(fy_months(base))
    dept: Dict[str, Dict[str, Any]] = {}

    def e(name):
        return dept.setdefault(name or "Unmapped", {"department": name or "Unmapped", "a_base": 0.0, "b_plan": 0.0,
                                                     "b_draft": 0.0, "plan_lines": []})
    for a in actuals:
        if a.get("domain") == "overhead" and a.get("period") in base_m:
            line = heads.get((a.get("dims") or {}).get("aop_head"))
            if line:
                e(line.get("pl_tag"))["a_base"] += float(a.get("amount") or 0)
    # the base year's forecast months (after the actual cut-off) come from the overhead lines
    cut = cfg["cutoffs"].get("overhead") or cfg["cutoffs"].get("default")
    for r in data.get("overhead_lines", []):
        x = e(r.get("pl_tag"))
        x["a_base"] += sum(float(r.get(vkey("F" + base[2:], p)) or 0) for p in base_m if p > cut)
        x["b_plan"] += float(r.get(vkey(B, "annual")) or 0)
    for r in data.get("overhead_plan", []):
        amt = sum(float(r.get(vkey(T, p)) or 0) for p in fy_months(draft)) or float(r.get(f"annual_{T.lower()}") or 0)
        x = e(r.get("department"))
        x["b_draft"] += amt
        x["plan_lines"].append({"line_id": r.get("line_id"), "cost_centre": r.get("cost_centre"), "gl": r.get("gl"),
                                "description": r.get("description"), "amount": amt})
    rows = sorted(dept.values(), key=lambda x: -(x["b_draft"] or x["b_plan"]))
    for x in rows:
        x["growth"] = (x["b_draft"] - x["b_plan"]) / x["b_plan"] if x["b_plan"] else None
        x["plan_lines"].sort(key=lambda y: -y["amount"])
    return {"rows": rows}


def wbs_report(data, actuals, cfg, master: List[Dict[str, Any]]) -> Dict[str, Any]:
    plan = cfg["plan_fy"]
    draft = cfg.get("draft_fy") or shift_fy(plan, 1)
    B, T = "B" + plan[2:], "B" + draft[2:]
    m = {str(w.get("wbs_element") or "").strip(): w for w in master if w.get("wbs_element")}
    agg: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"opex_budget": 0.0, "opex_draft": 0.0, "actual_opex": 0.0,
                                                          "actual_overhead": 0.0, "actual_capex": 0.0, "lines": 0})
    for r in data.get("opex_lines", []):
        w = str(r.get("wbs") or "").strip()
        if not w:
            continue
        a = agg[w]
        a["opex_budget"] += float(r.get(vkey(B, "annual")) or 0)
        a["opex_draft"] += sum(float(r.get(vkey(T, p)) or 0) for p in fy_months(draft))
        a["lines"] += 1
        a.setdefault("name", r.get("wbs_name") or r.get("wbs_desc"))
    for x in actuals:
        w = str((x.get("dims") or {}).get("wbs") or "").strip()
        if not w or w.lower() == "unbudgeted":
            continue
        k = {"opex": "actual_opex", "overhead": "actual_overhead", "capex": "actual_capex"}.get(x.get("domain"))
        if k:
            agg[w][k] += float(x.get("amount") or 0)
    rows = []
    for w, a in agg.items():
        mm = m.get(w) or m.get(".".join(w.split(".")[:3])) or {}
        rows.append({"wbs": w, "name": a.get("name") or mm.get("name") or mm.get("description"),
                     "in_master": bool(mm), "master_budget": mm.get("original_budget"), **{k: v for k, v in a.items() if k != "name"},
                     "actual_total": a["actual_opex"] + a["actual_overhead"] + a["actual_capex"]})
    rows.sort(key=lambda x: -(x["opex_budget"] + x["actual_total"]))
    return {"rows": rows, "master_count": len(m), "not_in_master": sum(1 for r in rows if not r["in_master"])}


def tags_for_margin(data) -> List[str]:
    tags = set()
    for ds in ("rev_cute", "rev_noncute", "rev_projects", "opex_lines"):
        for f in data.get(ds, []):
            t = f.get("tag") or f.get("airport")
            if t and norm(t) != "shared services":
                tags.add(str(t).strip())
    first = [a for a in AIRPORTS if a in tags]
    return first + sorted(tags - set(first), key=str.lower)


