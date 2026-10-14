"""Opex forecast engine for the PO tracker (rewrite of the Opex_Forecast monthly formula).

Every day of the forecast year is costed once, in priority order:

  1. manual override  — override amount spread over override start → end
  2. new PO(s)        — the line's linked SAP PO items (segments), each over its own period; parallel POs add up
  3. old PO           — the line's own PO (net PO, else PO amount INR) over its period
  4. recurring gap    — a Recurring line's uncovered days at the budget daily rate (Budgeted FY / days in the FY),
                         except when its mapping status says no renewal is coming (Not required, Merged)

Each block uses its own daily rate (amount ÷ its period days), exactly like the workbook.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from .datasets import vkey
from .opex_schema import NO_GAP_STATUSES
from .periods import fy_start_year

Span = Optional[Tuple[date, date]]
Segment = Tuple[float, Optional[date], Optional[date]]

# tracker fields that change the forecast (edits to these trigger a recalculation)
INPUT_FIELDS = {"override_amount", "override_start", "override_end", "new_po_amount", "new_po_start", "new_po_end",
                "po_start", "po_end", "net_po", "po_amount", "recurring", "budget_plan", "mapping_status"}


def input_fields(plan_fy: str) -> set:
    return INPUT_FIELDS | {vkey("B" + plan_fy[2:], "annual")}


def _d(v) -> Optional[date]:
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _num(v) -> float:
    if isinstance(v, str):
        v = v.replace(",", "").strip()
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _span(start, end) -> Span:
    s, e = _d(start), _d(end)
    return (s, e) if s and e and e >= s else None


def fy_days(fy: str) -> List[date]:
    y = fy_start_year(fy)
    d, end = date(y, 4, 1), date(y + 1, 3, 31)
    out = []
    while d <= end:
        out.append(d)
        d += timedelta(days=1)
    return out  # 366 days in a leap FY


def _legacy_segment(row: Dict[str, Any]) -> List[Segment]:
    """Lines not yet on links: the old single new PO amount / start / end."""
    if _num(row.get("new_po_amount")):
        return [(_num(row["new_po_amount"]), _d(row.get("new_po_start")), _d(row.get("new_po_end")))]
    return []


def forecast_line(row: Dict[str, Any], fy: str, segments: Optional[List[Segment]] = None) -> Dict[str, float]:
    _len = lambda s: (s[1] - s[0]).days + 1  # noqa: E731
    days = fy_days(fy)
    ov = _span(row.get("override_start"), row.get("override_end")) if _num(row.get("override_amount")) else None
    old = _span(row.get("po_start"), row.get("po_end"))
    r_ov = _num(row.get("override_amount")) / _len(ov) if ov else 0.0
    r_old = _num(row.get("net_po") or row.get("po_amount")) / _len(old) if old else 0.0
    budget = row.get(vkey("B" + fy[2:], "annual"), row.get("budget_plan"))  # fallback during migration
    r_bud = _num(budget) / len(days)
    if segments is None:
        segments = _legacy_segment(row)
    segs = [(s, e, a / ((e - s).days + 1)) for a, s, e in segments if s and e and e >= s and a]
    recurring = str(row.get("recurring") or "").lower().startswith("recurring")
    no_gap = row.get("mapping_status") in NO_GAP_STATUSES
    out: Dict[str, float] = defaultdict(float)
    for d in days:
        if ov and ov[0] <= d <= ov[1]:
            v = r_ov
        elif any(s <= d <= e for s, e, _ in segs):
            v = sum(r for s, e, r in segs if s <= d <= e)  # parallel new POs add up
        elif old and old[0] <= d <= old[1]:
            v = r_old
        elif recurring and not no_gap:
            v = r_bud
        else:
            v = 0.0
        out[vkey("F" + fy[2:], f"{d.year}-{d.month:02d}")] += v
    return {k: round(v, 2) for k, v in out.items()}
