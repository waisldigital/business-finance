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

# Permission sections (added to WORKSPACE_SECTIONS so the existing roles screen manages them)
AOP_SECTIONS = [
    "aop_pnl",        # P&L views
    "aop_inputs",     # Assumptions / drivers for the next AOP
    "aop_revenue",    # CUTE / Non-CUTE / CR / Projects
    "aop_opex",       # Opex lines, PO tracker, PO register
    "aop_overheads",  # Department overheads (WBS original budget, CC+GL plan)
    "aop_payroll",    # Confidential
    "aop_capex",
    "aop_reports",
]

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
                key_fields=["airport", "pax_type", "fy"],
                description="CUTE revenue per airport / passenger type (PAX × rate).",
                versions=["F26", "B27", "B28"]),
    DatasetSpec("rev_cute_drivers", "CUTE drivers (PAX & rate)", "aop_revenue", "Revenue",
                key_fields=["airport", "pax_type", "fy", "metric"],
                description="Monthly PAX counts and rate per PAX that drive CUTE revenue.",
                versions=["A", "F26", "B27", "B28"]),
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
                description="Old PO ↔ new PO mapping, overrides and the running FY forecast.",
                versions=["F27"]),
    DatasetSpec("po_register", "PO register (ZMM)", "aop_opex", "Opex",
                key_fields=["purchase_order", "purchase_order_item", "migo_no", "migo_line_item_no", "invoice_no"],
                description="SAP ZMM PO report — header, GRN and invoice details per PO item."),
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
    DatasetSpec("capex_history", "Capex history by location", "aop_capex", "Capex",
                key_fields=["location"],
                description="Initial budget, capex to date, prior-year budget and actuals per location (Capex_Summary)."),
    # ---------- Inputs ----------
    DatasetSpec("assumptions", "Assumptions", "aop_inputs", "Inputs",
                key_fields=["fy", "name"],
                description="Scenario drivers (Low/Base/High) — FX, escalation, PAX, rates, growth, allocation."),
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
