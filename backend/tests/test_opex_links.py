"""PO items from the ZMM, links, allocation, add-on lines and the forecast engine (§5–§8, tests 3–9)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aop import po as P  # noqa: E402
from aop.opex import forecast_line, fy_days  # noqa: E402

HEADER = P.REQUIRED + ["Currency", "GR Amount In LC", "Quantity", "Delivery Date", "Linked Old PO"]


def zrow(po, item, **kw):
    base = {"Purchase Order": po, "Purchase Order Item": item, "Created On": "2026-04-01", "Supplier": 1000001,
            "Supplier Name": "Vendor A", "Material": 9700000001, "Material Description": "AMC", "Currency": "INR",
            "Net Order Value": 365000, "WBS Element": "WOIN.001", "Start Date for Period of Performance": "2026-04-01",
            "End Date for Period of Performance": "2027-03-31", "MIGO No.": None, "MIGO Line Item No.": None,
            "GRN Posting Date": None, "Invoice No": None, "Deletion Indicator": None,
            "PO Net Price in Group Currency": 365000, "GRN Amount in Group Currency": None,
            "Invoice Amount in Group Currency": None}
    base.update(kw)
    return tuple(base.get(h) for h in P.REQUIRED) + (base.get("Currency 2"), base.get("GR Amount In LC"),
                                                    base.get("Quantity"), base.get("Delivery Date"), base.get("Linked Old PO"))


def items_of(rows, rates=None, fy="FY27"):
    _, raw = P.read_zmm([tuple([None] * len(HEADER)), tuple(HEADER)] + rows)
    return P.build_items(raw, lambda c, dt: ((rates or {})[c], P.FX_FALLBACK) if (rates or {}).get(c) else None, fy)


# ---------------------------------------------------------------------------------------------- 3. dedupe
def test_zmm_reader_normalises_and_dedupes_grn_and_invoices():
    rows = [  # one item, three GRN rows: MIGO 5001/1 repeated (pending is a running balance in the file)
        zrow(4200000049.0, 10, **{"MIGO No.": 5001, "MIGO Line Item No.": 1, "GRN Amount in Group Currency": 100000,
                                  "GRN Posting Date": "2026-05-01", "Invoice No": "INV1", "Invoice Amount in Group Currency": 90000}),
        zrow(4200000049.0, 10, **{"MIGO No.": 5001, "MIGO Line Item No.": 1, "GRN Amount in Group Currency": 100000,
                                  "Invoice No": "INV2", "Invoice Amount in Group Currency": 10000}),
        zrow(4200000049.0, 10, **{"MIGO No.": 5002, "MIGO Line Item No.": 1, "GRN Amount in Group Currency": 50000,
                                  "GRN Posting Date": "2026-06-01", "Invoice No": "INV2", "Invoice Amount in Group Currency": 10000}),
    ]
    header, raw = P.read_zmm([tuple(["subtotal"] + [None] * (len(HEADER) - 1)), tuple(HEADER)] + rows)
    assert raw[0]["purchase_order"] == "4200000049" and raw[0]["supplier"] == "1000001" and raw[0]["material"] == "9700000001"
    assert "currency_2" in raw[0] or "currency" in raw[0]
    it = P.build_items(raw, lambda c, dt: None, "FY27")["4200000049|10"]
    assert it["grn_inr"] == 150000 and it["invoiced_inr"] == 100000
    assert it["pending_inr"] == 365000 - 150000 and it["last_grn_date"] == "2026-06-01"
    P.register_rows(raw)
    assert [f["_key"] for f in raw] == ["4200000049|10|1", "4200000049|10|2", "4200000049|10|3"]
    P.final_values(raw)
    assert round(sum(f["final_value"] for f in raw)) == 365000


def test_zmm_missing_columns_rejected():
    import pytest
    with pytest.raises(ValueError, match="missing required columns"):
        P.read_zmm([("Purchase Order", "Purchase Order Item"), (1, 10)])


# ---------------------------------------------------------------------------------------------- 4. FX
def test_fx_converts_doc_amount_at_po_date_and_flags_fallback():
    from datetime import date
    from aop.po_pipeline import FxTable
    fx = FxTable({"EUR": {"2026-03-27": 100.0, "2026-04-01": 108.0}}, {"GBP": 110.0})
    assert fx.rate("EUR", date(2026, 4, 1)) == (108.0, "FX EUR on PO date 2026-04-01")
    assert fx.rate("EUR", date(2026, 3, 29))[0] == 100.0          # weekend → nearest earlier day
    assert fx.rate("EUR", date(2026, 5, 1)) is None               # > 10 days since the last rate, no fallback
    assert fx.rate("GBP", date(2026, 4, 1)) == (110.0, P.FX_FALLBACK)
    _, raw = P.read_zmm([tuple([None] * len(HEADER)), tuple(HEADER)] + [
        # SAP group-currency figure is ignored: INR = Net Order Value (document currency) × rate on the PO date
        zrow(4400000018, 10, Currency="EUR", **{"Net Order Value": 1000, "PO Net Price in Group Currency": 254.9,
                                                "GR Amount In LC": 500}),
        zrow(4400000099, 10, Currency="GBP", **{"Net Order Value": 1000, "PO Net Price in Group Currency": 1000}),
        zrow(4400000077, 10, Currency="CHF", **{"Net Order Value": 1000})])
    its = P.build_items(raw, fx.rate, "FY27")
    eur = its["4400000018|10"]
    assert eur["value_inr"] == 108000 and eur["fx_rate"] == 108.0 and not P.fx_flagged(eur["fx_source"])
    assert its["4400000099|10"]["value_inr"] == 110000 and P.fx_flagged(its["4400000099|10"]["fx_source"])
    assert its["4400000077|10"]["value_inr"] is None and P.fx_flagged(its["4400000077|10"]["fx_source"])
    assert P.to_inr("INR", 5, None, None) == (5.0, "INR")


# ---------------------------------------------------------------------------------------------- 5. tokens
def test_tokens_and_status_text():
    assert P.parse_po_tokens("4200000218, 2300000233")[0] == [("4200000218", None), ("2300000233", None)]
    assert P.parse_po_tokens("4400000018_9700001103, 4400000019")[0] == [("4400000018", "9700001103"), ("4400000019", None)]
    assert P.parse_po_tokens(4200000001.0)[0] == [("4200000001", None)]
    assert P.status_from_text("Not Migrated")[0].startswith("Not migrated")
    assert P.status_from_text("not required")[0] == "Not required"
    assert P.status_from_text("New PO yet to be issued")[0] == "New PO yet to be issued"
    assert P.status_from_text("Merged with 4200000111") == ("Merged into another PO", "4200000111")
    assert P.status_from_text("Not present in AOP")[0] == "Not in AOP – discuss"
    assert P.status_from_text("ARINC")[0] == "Agreement / outside SAP"
    assert P.status_from_text("")[0] == "Awaiting new PO"


def _links(*specs):
    out = []
    for lid, po, mat, item, pct in specs:
        out.append({"line_id": lid, "po": po, "material": mat or "", "po_item": item or "", "alloc_pct": pct,
                    "status": "Active", "_key": P.link_key(lid, po, mat, item)})
    return out


# ---------------------------------------------------------------------------------------------- 6. remainder rule
def test_remainder_rule_po_level_link_takes_unclaimed_items():
    its = items_of([zrow(4200000049, 10, Material=9700001384, **{"Net Order Value": 186611}),
                    zrow(4200000049, 20, Material=9700000002, **{"Net Order Value": 2000000}),
                    zrow(4200000049, 30, Material=9700000003, **{"Net Order Value": 364437})])
    links = _links(("TRK-00376", "4200000049", "9700001384", None, None), ("TRK-00382", "4200000049", None, None, None))
    cov = P.resolve(links, its)
    assert cov[links[0]["_key"]]["items"] == ["4200000049|10"]
    assert sorted(cov[links[1]["_key"]]["items"]) == ["4200000049|20", "4200000049|30"]
    val = lambda k: sum(its[i]["value_inr"] for i in cov[k]["items"])  # noqa: E731
    assert val(links[0]["_key"]) == 186611 and val(links[1]["_key"]) == 2364437
    flags = P.resolve(_links(("L", "4200000049", "123", None, None), ("M", "999", None, None, None)), its)
    assert "Material not on this PO" in flags[P.link_key("L", "4200000049", "123")]["flags"]
    assert "PO not in ZMM" in flags[P.link_key("M", "999")]["flags"]


def test_deleted_items_drop_out():
    its = items_of([zrow(4800000007, 10, **{"Deletion Indicator": "L"})])
    cov = P.resolve(_links(("A", "4800000007", None, None, None)), its)
    k = P.link_key("A", "4800000007")
    assert cov[k]["items"] == [] and "All items deleted/blocked" in cov[k]["flags"]


# ---------------------------------------------------------------------------------------------- 7. allocation
def test_auto_split_by_budget_reuse_and_user_values():
    its = items_of([zrow(4800000007, 10), zrow(4800000008, 10)])
    lines = {"A": {"budget": 100}, "B": {"budget": 300}, "C": {"budget": 600}}
    links = _links(("A", "4800000007", None, None, None), ("B", "4800000007", None, None, None),
                   ("C", "4800000007", None, None, None))
    cov = P.resolve(links, its)
    al = P.allocate(links, cov, lines)
    assert [al[ln["_key"]]["alloc_pct"] for ln in links] == [0.1, 0.3, 0.6]
    assert all(al[ln["_key"]]["alloc_auto"] for ln in links)
    # no double counting: the shared item is spent once across the three lines
    total = 0
    for lid in "ABC":
        segs, _, _ = P.segments({"recurring": "Recurring"}, [x for x in links if x["line_id"] == lid], cov, its, al)
        total += sum(a for a, _, _ in segs)
    assert round(total) == 365000
    # renewal on the same three lines reuses the last split even though budgets changed
    for ln in links:
        ln["alloc_pct"] = al[ln["_key"]]["alloc_pct"]
    renew = _links(("A", "4800000008", None, None, None), ("B", "4800000008", None, None, None),
                   ("C", "4800000008", None, None, None))
    all_links = links + renew
    cov2 = P.resolve(all_links, its)
    hist = {"A": [{"po": "4800000007", "items": ["4800000007|10"], "alloc_pct": 0.1}],
            "B": [{"po": "4800000007", "items": ["4800000007|10"], "alloc_pct": 0.3}],
            "C": [{"po": "4800000007", "items": ["4800000007|10"], "alloc_pct": 0.6}]}
    al2 = P.allocate(all_links, cov2, {"A": {"budget": 1}, "B": {"budget": 1}, "C": {"budget": 1}}, hist)
    assert [al2[ln["_key"]]["alloc_pct"] for ln in renew] == [0.1, 0.3, 0.6]
    # a user % is never overwritten; sums ≠ 100% → check
    user = _links(("A", "4800000007", None, None, 0.5), ("B", "4800000007", None, None, 0.2))
    al3 = P.allocate(user, P.resolve(user, its), lines)
    assert all("alloc_pct" not in al3[ln["_key"]] for ln in user)
    assert any("Allocation sums to 70.0%" in c for c in al3[user[0]["_key"]]["checks"])


def test_multi_item_po_shared_by_percent_flags_map_by_material():
    its = items_of([zrow(4200000201, 10), zrow(4200000201, 20, Material=9700000002)])
    links = _links(("A", "4200000201", None, None, None), ("B", "4200000201", None, None, None))
    al = P.allocate(links, P.resolve(links, its), {"A": {"budget": 1}, "B": {"budget": 1}})
    assert al[links[0]["_key"]]["alloc_pct"] == 0.5
    assert any("map each line by material" in c for c in al[links[0]["_key"]]["checks"])


# ---------------------------------------------------------------------------------------------- 8. add-on
def test_addon_line_id_and_period_nature():
    assert P.addon_line_id("TRK-00026", ["TRK-00026", "TRK-00026-A1"]) == "TRK-00026-A2"
    assert P.recurring_from_period("2026-04-01", "2026-12-31") == "Recurring"
    assert P.recurring_from_period("2026-04-01", "2026-04-30") == "One-Time"


def test_addon_keeps_old_po_days_on_parent():
    """The parent keeps its old PO; the add-on line carries only the new PO."""
    parent = {"po_start": "2026-04-01", "po_end": "2027-03-31", "net_po": 365 * 1000, "recurring": "Recurring"}
    assert forecast_line(parent, "FY27", [])["F27__2026-06"] == 30 * 1000
    addon = {"recurring": "Recurring", "B27__annual": 0}
    f = forecast_line(addon, "FY27", [(30 * 500, P.d("2026-06-01"), P.d("2026-06-30"))])
    assert f["F27__2026-06"] == 30 * 500 and f["F27__2026-07"] == 0


# ---------------------------------------------------------------------------------------------- 9. forecast
def test_forecast_segments_sequential_parallel_override():
    row = {"po_start": "2026-04-01", "po_end": "2026-06-30", "net_po": 91 * 1000, "recurring": "Recurring",
           "B27__annual": 365 * 100, "override_amount": 31 * 9000, "override_start": "2027-01-01", "override_end": "2027-01-31"}
    segs = [(31 * 2000, P.d("2026-07-01"), P.d("2026-07-31")),          # new PO 1 after the old PO
            (31 * 3000, P.d("2026-08-01"), P.d("2026-08-31")),          # new PO 2, sequential
            (31 * 500, P.d("2026-08-01"), P.d("2026-08-31"))]           # parallel PO adds up
    f = forecast_line(row, "FY27", segs)
    assert f["F27__2026-05"] == 31 * 1000
    assert f["F27__2026-07"] == 31 * 2000
    assert f["F27__2026-08"] == 31 * 3500
    assert f["F27__2026-09"] == 30 * 100                    # recurring gap at budget daily rate
    assert f["F27__2027-01"] == 31 * 9000                   # override wins
    row["mapping_status"] = "Not required"
    assert forecast_line(row, "FY27", segs)["F27__2026-09"] == 0   # no gap fill
    row["mapping_status"] = "Merged into another PO"
    assert forecast_line(row, "FY27", segs)["F27__2026-09"] == 0


def test_leap_fy_uses_366_days():
    assert len(fy_days("FY28")) == 366 and len(fy_days("FY27")) == 365
    f = forecast_line({"recurring": "Recurring", "B28__annual": 366 * 10.0}, "FY28")
    assert f["F28__2028-02"] == 29 * 10.0


def test_one_time_item_without_period_is_one_day_on_delivery():
    its = items_of([zrow(4200000300, 10, **{"Start Date for Period of Performance": None,
                                            "End Date for Period of Performance": None, "Delivery Date": "2026-09-15"})])
    links = _links(("A", "4200000300", None, None, None))
    cov = P.resolve(links, its)
    segs, _, flags = P.segments({"recurring": "One-Time"}, links, cov, its)
    assert segs[0][1] == segs[0][2] == P.d("2026-09-15")
    segs, _, flags = P.segments({"recurring": "Recurring"}, links, cov, its)
    assert segs == [] and any("no service period" in f for f in flags)


def test_latest_and_previous_po():
    detail = [{"po": "A", "amount": 10, "start": "2025-04-01", "end": "2026-03-31", "supplier_code": "1"},
              {"po": "B", "amount": 20, "start": "2026-04-01", "end": "2027-03-31", "supplier_code": "2", "pr_no": "PR9"}]
    lp = P.latest_previous({"po": "OLD", "supplier_code": "1"}, detail)
    assert lp["latest_po"] == "B" and lp["previous_po"] == "A" and lp["active_po_count"] == 2
    assert lp["supplier_changed"] == "Yes" and lp["latest_pr"] == "PR9"
    assert P.latest_previous({"po": "OLD"}, detail[1:])["previous_po"] == "OLD"


def test_changes_flagged_only_for_reviewed_fields():
    it = items_of([zrow(4200000400, 10)])["4200000400|10"]
    acc = P.merge_item(it, None, True)
    grn_only = dict(it, grn_inr=5000, pending_inr=1)
    assert P.diff_item(P.merge_item(grn_only, acc, True)) == []
    moved = dict(it, period_end="2027-06-30")
    d = P.diff_item(P.merge_item(moved, acc, True))
    assert [x["field"] for x in d] == ["period_end"]
    assert P.effective(P.merge_item(moved, acc, True))["period_end"] == "2027-03-31"   # held until accepted


def test_type_prefill_and_suggestions():
    assert P.type_from_wbs("WOIN.001") == "Opex" and P.type_from_wbs("WCIN.2") == "Capex"
    assert P.type_from_wbs("VHDC.1") == "Overheads" and P.type_from_wbs("XYZ") is None
    assert P.type_from_wbs("WOIN.1", nature="Capex") == "Capex"
    lines = [{"line_id": "L1", "wbs": "WOIN.001", "supplier_code": "1000001", "tag": "DIAL", "mapping_status": "Awaiting new PO"},
             {"line_id": "L2", "wbs": "WOIN.999"}]
    s = P.suggest_lines({"wbs": "WOIN.001", "supplier_code": "1000001", "location": "DIAL"}, lines)
    assert s[0]["line_id"] == "L1" and s[0]["score"] == 6 and len(s) == 1


def test_old_po_details_and_po_date_order():
    """Old PO comes with supplier, amount and service period; a PO without a service period is placed by its PO date."""
    detail = [{"po": "A", "amount": 10, "value": 10, "start": "2025-04-01", "end": "2026-03-31", "has_period": True,
               "supplier_name": "Old Co", "created_on": "2025-03-01"},
              {"po": "B", "amount": 0, "value": 30, "start": None, "end": None, "has_period": False, "no_segment": True,
               "supplier_name": "New Co", "created_on": "2026-05-01"}]
    lp = P.latest_previous({"po": "OWN"}, detail)
    assert lp["latest_po"] == "B" and lp["latest_po_value_inr"] == 30
    assert lp["previous_po"] == "A" and lp["previous_po_supplier"] == "Old Co" and lp["previous_po_value_inr"] == 10
    assert lp["previous_po_start"] == "2025-04-01" and lp["previous_po_end"] == "2026-03-31"
    own = P.latest_previous({"po": "OWN", "vendor": "V", "net_po": 5, "po_start": "2024-04-01", "po_end": "2025-03-31"}, detail[:1])
    assert own["previous_po"] == "OWN" and own["previous_po_value_inr"] == 5 and own["previous_po_supplier"] == "V"


def test_suggestion_scores_zmm_aop_code():
    lines = [{"line_id": "1", "aop_code": "OPX-101", "tag": "HYD"}, {"line_id": "2", "aop_code": "OPX-202", "tag": "HYD"}]
    got = P.suggest_lines({"aop_code": "opx-202", "location": "HYD"}, lines)
    assert got[0]["line_id"] == "2" and "same AOP code" in got[0]["reason"]
