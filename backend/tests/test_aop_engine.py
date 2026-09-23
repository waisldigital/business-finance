"""Unit tests for the AOP P&L engine using small synthetic datasets (no workbook needed)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aop.datasets import coerce  # noqa: E402
from aop.periods import fy_months, fy_of_period, to_period  # noqa: E402
from aop.pnl import Filters, PnLEngine  # noqa: E402

BASE, PLAN = "FY26", "FY27"
CUT = "2025-12"


def _data():
    base_m, plan_m = fy_months(BASE), fy_months(PLAN)
    fc = {f"F26__{p}": 100.0 for p in base_m if p > CUT}
    bud = {f"B27__{p}": 200.0 for p in plan_m}
    return {
        "rev_cute": [
            {"airport": "DIAL", "stream": "CUTE", **fc, **bud},
            {"airport": "GHIAL", "stream": "CUTE", **fc, **bud},
        ],
        "opex_lines": [
            {"category": "CA", "geo": "India", "tag": "DIAL", **fc, **bud},
            {"category": "CA", "geo": "India", "tag": "Shared services", **fc, **bud},
        ],
        "assumptions": [
            {"name": "Shared Services Cost allocation · DIAL", "value": 0.75},
            {"name": "Shared Services Cost allocation · GHIAL", "value": 0.25},
        ],
    }


def _actuals():
    out = []
    for p in fy_months(BASE):
        if p <= CUT:
            out.append({"domain": "rev_cute", "period": p, "amount": 10.0, "dims": {"tag": "DIAL"}})
            out.append({"domain": "rev_cute", "period": p, "amount": 20.0, "dims": {"tag": "GHIAL"}})
            out.append({"domain": "opex", "period": p, "amount": 5.0,
                        "dims": {"category": "CA", "geo": "India", "tag": "Shared services"}})
    return out


def _row(out, rid):
    return next(r for r in out["rows"] if r["id"] == rid)["values"]


def test_periods():
    assert fy_months("FY27")[0] == "2026-04" and fy_months("FY27")[-1] == "2027-03"
    assert fy_of_period("2026-03") == "FY26" and fy_of_period("2026-04") == "FY27"
    assert to_period(45748) == "2025-04"


def test_coerce_excel_pastes():
    assert coerce("number", "1,25,000") == 125000
    assert coerce("number", "(1,000)") == -1000
    assert coerce("percent", "9%") == 0.09
    assert coerce("number", "") is None


def test_actual_then_forecast_and_budget():
    eng = PnLEngine(_data(), _actuals(), BASE, PLAN, {"default": CUT})
    v = _row(eng.compute(Filters()), "cute")
    assert v["2025-04"] == 30.0          # actuals (both airports)
    assert v["2026-01"] == 200.0         # forecast (2 lines × 100)
    assert v["af_base"] == 9 * 30 + 3 * 200
    assert v["b_plan"] == 12 * 400


def test_airport_filter_allocates_shared_services():
    eng = PnLEngine(_data(), _actuals(), BASE, PLAN, {"default": CUT})
    out = eng.compute(Filters(tag="DIAL"))
    assert _row(out, "cute")["2025-04"] == 10.0
    shared = _row(out, "opex_shared")
    assert shared["2025-04"] == 5.0 * 0.75       # DIAL share of shared services
    assert shared["2026-04"] == 200.0 * 0.75


def test_exclusion_and_geo():
    eng = PnLEngine(_data(), _actuals(), BASE, PLAN, {"default": CUT})
    assert _row(eng.compute(Filters(exclude=["GHIAL"])), "cute")["2025-04"] == 10.0
    assert _row(eng.compute(Filters(geo="International")), "cute")["af_base"] == 0


def test_opex_forecast_priority():
    from aop.opex import forecast_line
    row = {"po_start": "2026-04-01", "po_end": "2026-09-30", "net_po": 183 * 1000,  # old PO: 1,000/day Apr–Sep
           "new_po_amount": 90 * 2000, "new_po_start": "2026-08-01", "new_po_end": "2026-10-29",  # new PO: 2,000/day
           "override_amount": 31 * 5000, "override_start": "2026-10-01", "override_end": "2026-10-31",  # override: 5,000/day
           "budget_plan": 365 * 100, "recurring": "Recurring"}
    f = forecast_line(row, "FY27")
    assert f["F27__2026-04"] == 30 * 1000                  # old PO only
    assert f["F27__2026-08"] == 31 * 2000                  # new PO wins over old PO
    assert f["F27__2026-10"] == 31 * 5000                  # override wins over new PO
    assert f["F27__2026-11"] == 30 * 100                   # recurring gap at budget daily rate
    row["recurring"] = "One-Time"
    assert forecast_line(row, "FY27")["F27__2026-11"] == 0
