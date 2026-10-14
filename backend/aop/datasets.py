"""Registry of AOP datasets and the generic helpers the API uses for every one of them.

Every dataset is stored in the single collection ``aop_rows`` as documents shaped::

    {"dataset": "opex_lines", "key": "OPX-00042", "fields": {...}, "updated_at": ..., "updated_by": ...}

``key`` is the dataset's unique key. It is built from ``key_fields`` (joined with ``|``) or, for
datasets whose source has no natural unique key, auto-assigned from ``auto_prefix`` and kept in
the ``line_id`` field so it survives a download → edit → re-upload round trip.

Plan values live in ``fields`` as flat ``<VERSION>__<YYYY-MM>`` entries (e.g. ``B27__2026-04``)
plus optional ``<VERSION>__total`` overrides. Actuals never live here — they are all in the
single ``aop_actuals`` source (see ``ACTUALS``).

Column definitions (label, type, order, visibility, user-editable) live in ``aop_dataset_meta``
so admins can add, delete, rename and reorder columns without code changes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Permission sections for the AOP screens live in sections.py (AOP_SECTIONS)

ACTUALS = "actuals"  # pseudo-dataset backed by the aop_actuals collection


@dataclass
class DatasetSpec:
    key: str
    label: str
    section: str
    group: str
    key_fields: List[str] = field(default_factory=list)
    auto_prefix: Optional[str] = None
    sensitive: bool = False
    description: str = ""
    # plan versions this dataset carries monthly values for (e.g. ["F26", "B27", "B28"])
    versions: List[str] = field(default_factory=list)


SPECS: Dict[str, DatasetSpec] = {s.key: s for s in [
    # ---------- Revenue ----------
    DatasetSpec("rev_cute", "CUTE revenue", "aop_revenue", "Revenue",
                key_fields=["airport", "pax_type"],
                description="CUTE revenue per airport / passenger type (PAX × rate) — one line, every FY in columns.",
                versions=["F26", "B27", "B28"]),
    DatasetSpec("rev_cute_drivers", "CUTE drivers (PAX & rate)", "aop_revenue", "Revenue",
                key_fields=["airport", "pax_type", "metric"],
                description="Monthly PAX and rate per PAX by airport — one line per metric, every FY in columns "
                            "(A = actual, F = forecast, B = budget).",
                versions=["A27", "F26", "B27", "B28"]),
    DatasetSpec("rev_noncute", "Non-CUTE & revenue share", "aop_revenue", "Revenue",
                key_fields=["stream", "location"],
                description="Non-CUTE revenue by location and the airport revenue-share cost.",
                versions=["F26", "B27", "B28"]),
    DatasetSpec("rev_projects", "CR & project revenue", "aop_revenue", "Revenue",
                auto_prefix="REV",
                description="Customer PO-wise revenue for Change Requests and Projects.",
                versions=["B26", "F26", "B27", "B28"]),
    DatasetSpec("project_master", "CR & project master", "aop_revenue", "Revenue",
                key_fields=["project_id"],
                description="Project master: taxonomy, PO value, budgeted revenue and cost."),
    # ---------- Opex ----------
    DatasetSpec("opex_lines", "Opex lines (original budget)", "aop_opex", "Opex",
                auto_prefix="OPX",
                description="PO-wise direct third-party opex with FY accruals and the original budget.",
                versions=["F26", "B27", "B28"]),
    DatasetSpec("opex_tracker", "Opex forecast tracker", "aop_opex", "Opex",
                auto_prefix="TRK",
                description="Living Opex lines (one Opex layout): latest / previous PO from the PO links, overrides, mapping "
                            "status, the running FY forecast and next year's AOP inputs.",
                versions=["F27"]),
    DatasetSpec("po_register", "PO register (ZMM)", "aop_opex", "Opex",
                key_fields=["purchase_order", "purchase_order_item", "row_n"],
                description="SAP ZMM PO report — raw rows exactly as uploaded, replaced on every run (read-only)."),
    DatasetSpec("po_items", "PO items (from ZMM)", "aop_opex", "Opex", key_fields=["po", "item"],
                description="One row per SAP PO item, derived on each ZMM run: INR value, period, GRN / invoice totals; "
                            "latest_* (SAP now) and accepted_* (what the forecast uses). Read-only."),
    DatasetSpec("po_triage", "PO triage", "aop_opex", "Opex", key_fields=["po", "item"],
                description="Type and destination decided for each PO item (Review → To map). Survives every run."),
    DatasetSpec("po_links", "PO links", "aop_opex", "Opex", key_fields=["line_id", "po", "material", "po_item"],
                description="Opex line × SAP PO (× material × PO item): allocation % (only when one item feeds several "
                            "lines), coverage dates and link status."),
    DatasetSpec("po_changes", "PO changes", "aop_opex", "Opex", key_fields=["run_id", "po", "item", "field"],
                description="Flagged changes on mapped PO items (Review → PO changes)."),
    DatasetSpec("po_corrections", "PO corrections", "aop_opex", "Opex", auto_prefix="COR",
                description="POs that need a correction in SAP (Review → Corrections)."),
    DatasetSpec("zmm_runs", "ZMM upload log", "aop_opex", "Opex", key_fields=["run_id"],
                description="Every ZMM run, manual or e-mail: counts, changes flagged and the forecast Δ."),
    # ---------- Overheads ----------
    DatasetSpec("overhead_lines", "Overheads (original WBS/AOP-head budget)", "aop_overheads", "Overheads",
                key_fields=["aop_head"],
                description="Department overheads by AOP head — original budget kept as-is.",
                versions=["F26", "B27"]),
    DatasetSpec("overhead_plan", "Overhead plan (Cost centre + GL)", "aop_overheads", "Overheads",
                auto_prefix="OHP",
                description="Next-year overhead budget on Cost centre + GL; one combination can hold many lines.",
                versions=["B28"]),
    DatasetSpec("cc_gl_map", "Cost centre + GL mapping", "aop_overheads", "Masters",
                key_fields=["cost_centre", "gl"],
                description="Maps each Cost centre + GL combination to a department and AOP head."),
    # ---------- Payroll (confidential) ----------
    DatasetSpec("payroll_lines", "Payroll lines", "aop_payroll", "Payroll", auto_prefix="PAY", sensitive=True,
                description="Resource cost by project / department (active and to-be-hired).",
                versions=["B26", "F26", "B27", "B27A", "B27T", "B28"]),
    # ---------- Capex ----------
    DatasetSpec("capex_lines", "Capex lines", "aop_capex", "Capex", auto_prefix="CPX",
                description="Budgeted capex by department, location and sub-system (quarterly phasing) and next year's ask."),
    DatasetSpec("capex_tracker", "Capex tracker", "aop_capex", "Capex",
                key_fields=["location", "project"],
                description="Capex tracker per location and project / category: initial budget, capex till last year, "
                            "plan-year budget, monthly actuals (A<yy>__<month>), open PO and PR commitments.",
                versions=["A27"]),
    DatasetSpec("capex_history", "Capex history by location", "aop_capex", "Capex",
                key_fields=["location"],
                description="Initial budget, capex to date, prior-year budget and actuals per location (Capex_Summary)."),
    # ---------- Inputs ----------
    DatasetSpec("assumptions", "Assumptions", "aop_inputs", "Inputs",
                key_fields=["fy", "name"],
                description="Scenario drivers (Low/Base/High) — FX, escalation, PAX, rates, growth, allocation."),
    DatasetSpec("fx_rates", "FX rates by date", "aop_inputs", "Inputs", key_fields=["currency", "date"],
                description="INR per unit of each currency by date — PO values are converted at the rate on the PO date "
                            "Rates come from the internet automatically (each ZMM run, the daily job, or Fetch rates): ECB "
                            "reference rates, other currencies from daily market rates. Hand-entered rates are kept."),
    DatasetSpec("pl_other", "Below-EBITDA lines", "aop_inputs", "Inputs",
                key_fields=["line"],
                description="Depreciation, interest, interest income and tax.",
                versions=["F26", "B27", "B28"]),
    DatasetSpec("pl_snapshot", "P&L snapshot (B FY26)", "aop_reports", "Inputs",
                key_fields=["row_id"],
                description="Frozen FY26 budget column of the approved P&L."),
    # ---------- Masters ----------
    DatasetSpec("taxonomy_airports", "Airport & country mapping", "aop_revenue", "Masters",
                key_fields=["tag"],
                description="Reporting tag → airport name, city, country, domestic/international, GMR/Non-GMR."),
]}


def slug(label: Any) -> str:
    s = re.sub(r"[^0-9a-zA-Z]+", "_", str(label or "").strip().lower()).strip("_")
    return s or "col"


def vkey(version: str, period: str) -> str:
    return f"{version}__{period}"


def norm(v: Any) -> str:
    return str(v if v is not None else "").strip().lower()


def build_key(spec: DatasetSpec, fields: Dict[str, Any]) -> Optional[str]:
    if spec.key_fields:
        parts = [str(fields.get(k) if fields.get(k) is not None else "").strip() for k in spec.key_fields]
        if not any(parts):
            return None
        return "|".join(parts)
    lid = fields.get("line_id")
    return str(lid).strip() if lid not in (None, "") else None


def coerce(col_type: str, v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if v == "":
            return None
    if col_type in ("number", "percent", "money"):
        if isinstance(v, bool):
            return float(v)
        if isinstance(v, (int, float)):
            return float(v)
        s = str(v).replace(",", "").replace("₹", "").strip()
        pct = s.endswith("%")
        s = s.rstrip("%")
        if s.startswith("(") and s.endswith(")"):
            s = "-" + s[1:-1]
        try:
            n = float(s)
        except ValueError:
            return None
        return n / 100 if pct else n
    if col_type == "date":
        from .periods import to_iso_date
        return to_iso_date(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v if isinstance(v, (int, float, bool)) else str(v)


def column(key: str, label: str, ctype: str = "text", *, editable: bool = False, group: str = "",
           width: Optional[int] = None, hidden: bool = False) -> Dict[str, Any]:
    return {"key": key, "label": label, "type": ctype, "user_editable": editable, "group": group,
            "width": width, "hidden": hidden, "custom": False}


# ---------------------------------------------------------------------------------------------- wide FY layout
# CUTE revenue and drivers keep one line per airport / passenger type (and metric); each FY is a set of monthly
# columns keyed by version (A = actual, F = forecast, B = budget), e.g. F26__2026-01, B27__2026-04, A27__2026-05.
VERSION_KEY = re.compile(r"^([ABF]\d{2}[AT]?)__(\d{4}-\d{2}|total|annual)$")


def _fy_months(fy: str) -> List[str]:
    y = 2000 + int(fy[2:])
    return [f"{y - 1}-{m:02d}" for m in range(4, 13)] + [f"{y}-{m:02d}" for m in range(1, 4)]


def driver_metric(metric: Any) -> str:
    m = str(metric or "").strip()
    return "PAX" if "pax" in m.lower() else ("Rate (INR)" if "rate" in m.lower() else m)


def driver_version(fy: str, metric: Any, base_fy: str) -> str:
    """Long-format driver (fy, metric) → version: "PAX Actual" and years before the base year → A<yy>; the base
    year's plan metric is its actual / forecast (F<yy>); later years are budgets (B<yy>)."""
    yy = fy[2:]
    if "actual" in str(metric or "").lower() or fy < base_fy:  # earlier years are history (actuals)
        return "A" + yy
    return ("F" if fy == base_fy else "B") + yy


def widen_cute(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: Dict[tuple, Dict[str, Any]] = {}
    for r in rows:
        k = (str(r.get("airport") or "").strip(), str(r.get("pax_type") or "Combined").strip())
        cur = out.setdefault(k, {})
        for f, v in r.items():
            if f in ("fy", "_key"):
                continue
            if f not in cur or cur[f] in (None, "") or VERSION_KEY.match(f):
                cur[f] = v
    for (a, t), f in out.items():
        f["airport"], f["pax_type"] = a, t
    return list(out.values())


def widen_drivers(rows: List[Dict[str, Any]], base_fy: str) -> List[Dict[str, Any]]:
    """Long drivers (fy, metric, m01..m12 or <V>__<period>) → one row per airport / passenger type / metric."""
    out: Dict[tuple, Dict[str, Any]] = {}
    for r in rows:
        metric = driver_metric(r.get("metric"))
        k = (str(r.get("airport") or "").strip(), str(r.get("pax_type") or "Combined").strip(), metric)
        cur = out.setdefault(k, {"airport": k[0], "pax_type": k[1], "metric": metric})
        fy = r.get("fy")
        if fy:
            ver = driver_version(fy, r.get("metric"), base_fy)
            for i, p in enumerate(_fy_months(fy), start=1):
                v = r.get(f"m{i:02d}")
                if v not in (None, ""):
                    cur[vkey(ver, p)] = v
        for f, v in r.items():
            if VERSION_KEY.match(f):
                cur[f] = v
    return list(out.values())


def wide_columns(rows: List[Dict[str, Any]], lead: List[Dict[str, Any]], editable: bool = False) -> List[Dict[str, Any]]:
    """Descriptive columns, then each FY's columns: budget, actual, forecast (B, A, F)."""
    from .periods import period_label
    vers: Dict[str, set] = {}
    for r in rows:
        for f in r:
            m = VERSION_KEY.match(f)
            if m:
                vers.setdefault(m.group(1), set()).add(m.group(2))
    order = sorted(vers, key=lambda v: (int(v[1:3]), "BAF".index(v[0]), v))
    cols = list(lead)
    for v in order:
        ps = vers[v]
        for extra in ("total", "annual"):
            if extra in ps:
                cols.append(column(vkey(v, extra), f"FY'{v[1:3]} {v[0]} {extra}", "number", group=v, editable=editable))
        for p in sorted(x for x in ps if x[0].isdigit()):
            cols.append(column(vkey(v, p), f"{v} {period_label(p)}", "number", group=v,
                               editable=editable and not v.startswith("A")))
    return cols


CUTE_LEAD = [column("airport", "Airport"), column("pax_type", "Passenger"), column("stream", "Stream"),
             column("geo", "Geo"), column("tag", "Reporting tag")]
DRIVER_LEAD = [column("airport", "Airport"), column("pax_type", "Passenger"), column("metric", "Metric")]


def version_months(row: Dict[str, Any], version: str) -> Optional[List[float]]:
    """A wide row's 12 months for a version (FY order), or None when the row has none of them."""
    fy = "FY" + version[1:3]
    keys = [vkey(version, p) for p in _fy_months(fy)]
    if not any(k in row for k in keys):
        return None
    return [float(row.get(k) or 0.0) if isinstance(row.get(k), (int, float)) else 0.0 for k in keys]
