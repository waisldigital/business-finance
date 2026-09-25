"""Opex forecast engine for the PO tracker (rewrite of the Opex_Forecast monthly formula).

For every month of the forecast year, days are allocated in priority order:

  1. manual override  — override amount spread over override start → end
  2. new PO           — new PO amount spread over its period, minus days already on the override
  3. old PO           — net PO spread over its period, minus days on the override or the new PO
  4. recurring gap    — for Recurring lines, any day of the month still uncovered is costed at
                         the budget daily rate (Budgeted FY / 365)

Each block uses its own daily rate (amount ÷ its period days), exactly like the workbook.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Any, Dict, Optional, Tuple

from .datasets import vkey
from .periods import fy_months

Span = Optional[Tuple[date, date]]

# tracker fields that change the forecast (edits to these trigger a recalculation)
INPUT_FIELDS = {"override_amount", "override_start", "override_end", "new_po_amount", "new_po_start", "new_po_end",
                "po_start", "po_end", "net_po", "recurring", "budget_plan"}


def _d(v) -> Optional[date]:
    if not v:
        return None
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


def _overlap(a: Span, b: Span) -> int:
    if not a or not b:
        return 0
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return max(0, (hi - lo).days + 1)


def _span(start, end) -> Span:
    s, e = _d(start), _d(end)
    return (s, e) if s and e and e >= s else None


def forecast_line(row: Dict[str, Any], fy: str) -> Dict[str, float]:
    ov = _span(row.get("override_start"), row.get("override_end")) if _num(row.get("override_amount")) else None
    nw = _span(row.get("new_po_start"), row.get("new_po_end")) if _num(row.get("new_po_amount")) else None
    old = _span(row.get("po_start"), row.get("po_end"))
    rate_ov = _num(row.get("override_amount")) / ((ov[1] - ov[0]).days + 1) if ov else 0.0
    rate_nw = _num(row.get("new_po_amount")) / ((nw[1] - nw[0]).days + 1) if nw else 0.0
    rate_old = _num(row.get("net_po")) / ((old[1] - old[0]).days + 1) if old else 0.0
    rate_bud = _num(row.get("budget_plan")) / 365
    recurring = str(row.get("recurring") or "").lower().startswith("recurring")
    out = {}
    for p in fy_months(fy):
        y, m = (int(x) for x in p.split("-"))
        month = (date(y, m, 1), date(y, m, monthrange(y, m)[1]))
        d_ov = _overlap(month, ov)
        d_nw = max(0, _overlap(month, nw) - (_overlap(_intersect(month, nw), ov) if nw and ov else 0))
        d_old = max(0, _overlap(month, old) - (_overlap(_intersect(month, old), ov) if old and ov else 0)
                    - (_overlap(_intersect(month, old), nw) if old and nw else 0))
        gap = max(0, (month[1] - month[0]).days + 1 - d_ov - d_nw - d_old) if recurring else 0
        out[vkey("F" + fy[2:], p)] = round(d_ov * rate_ov + d_nw * rate_nw + d_old * rate_old + gap * rate_bud, 2)
    return out


def _intersect(a: Span, b: Span) -> Span:
    if not a or not b:
        return None
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return (lo, hi) if hi >= lo else None


