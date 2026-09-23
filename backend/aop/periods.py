"""Fiscal-year helpers. WAISL's fiscal year runs April → March; FY27 = Apr-2026 … Mar-2027."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fy_start_year(fy: str) -> int:
    """'FY27' -> 2026 (the calendar year in which the fiscal year starts)."""
    return 2000 + int(str(fy).upper().replace("FY", "").strip("' ")) - 1


def fy_months(fy: str) -> List[str]:
    """Return the 12 period keys ('YYYY-MM') of a fiscal year, April first."""
    y = fy_start_year(fy)
    return [f"{y}-{m:02d}" for m in range(4, 13)] + [f"{y + 1}-{m:02d}" for m in range(1, 4)]


def period_label(period: str) -> str:
    y, m = period.split("-")
    return f"{MONTH_ABBR[int(m) - 1]}-{y[2:]}"


def fy_of_period(period: str) -> str:
    y, m = (int(x) for x in period.split("-"))
    start = y if m >= 4 else y - 1
    return f"FY{(start + 1) % 100:02d}"


def shift_fy(fy: str, delta: int) -> str:
    n = int(str(fy).upper().replace("FY", "")) + delta
    return f"FY{n:02d}"


def to_period(v) -> Optional[str]:
    """Excel serial / datetime / date / 'YYYY-MM[-DD]' → 'YYYY-MM'."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return f"{v.year}-{v.month:02d}"
    if isinstance(v, date):
        return f"{v.year}-{v.month:02d}"
    if isinstance(v, (int, float)):
        if 20000 < float(v) < 80000:  # Excel serial date
            d = date.fromordinal(date(1899, 12, 30).toordinal() + int(v))
            return f"{d.year}-{d.month:02d}"
        return None
    s = str(v).strip()
    if len(s) >= 7 and s[4] == "-" and s[:4].isdigit():
        return s[:7]
    return None


def to_iso_date(v) -> Optional[str]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, float)) and 20000 < float(v) < 80000:
        return date.fromordinal(date(1899, 12, 30).toordinal() + int(v)).isoformat()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d-%b-%y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None
