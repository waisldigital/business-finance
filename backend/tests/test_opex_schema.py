"""The one Opex line layout: import from the refined format and the old Opex_Forecast, download → upload round trip,
and the migration of legacy keys (§3, tests 1–2)."""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aop import opex_schema as S  # noqa: E402
from aop import mis_reports as mr  # noqa: E402

CFG = {"base_fy": "FY26", "plan_fy": "FY27", "draft_fy": "FY28", "cutoffs": {"default": "2025-12"}}
FY26 = [datetime(2025, m, 1) for m in range(4, 13)] + [datetime(2026, m, 1) for m in range(1, 4)]
FY27 = [datetime(2026, m, 1) for m in range(4, 13)] + [datetime(2027, m, 1) for m in range(1, 4)]

REFINED_HEADER = (["AOP Code", "WBS Element", "WBS-L1", "WBS Description", "WBS L-1 Description", "Cost centre 1", "GL Code",
                   "GL Name", "Manual Project ID", "Project Name", "P&L Head", "P&L Region", "Project Grouping",
                   "Airport/Non-Airport", "Location", "Category - 1 (CA/CR/Others)", "Category - 2 (Digital/Non-Digital)",
                   "Retro P&L Tagging", "Retro P&L Location", "PO", "Date of PO issue ", "SAP Supplier Code",
                   "SAP Supplier Name", "Supplier Code Unique", "Supplier Name_Unique", "PO Expense Description",
                   "Material Type (GRN/SRN)", "PO Start Date", "PO End Date", "Nature of PO (Recurring/One-Time)",
                   "Expected Tech-Refresh Date", "Material Code", "SAP Material Description", "Package L-1", "Package L-2",
                   "Package L-3", "Nature of Expense", "Qty", "Rate", "Currency", "PO Amount", "PO AMOUNT (INR)", "PO Nature",
                   "PR No.", "New PR", "Old PO No.", "New PO No."] + FY26 + ["YTD Dec'25", "Total FY'26",
                   "Carry Forward in FY27 (Yes/No)", "Expected Start Date", "Expected Close Date", "% increment"] + FY27 +
                  ["Budgeted FY'27", "Variance", "Price Escalation", "Timing Difference", "Change in Scope/BOM/SLA",
                   "Renewal Post DLP Warranty", "Spares Requirement", "Increase due to ForEx", "Increase due to New CA",
                   "Increase due to PAX Count", "Wipro Optimization", "Optimization", "Others/Reduction",
                   "Ops team's Detailed Remarks", "Finance team Remarks", "Ops POC Tag", "PO Link"])


def refined_rows():
    h = REFINED_HEADER
    row = [None] * len(h)

    def put(label, v):
        row[h.index(label)] = v
    put("AOP Code", "OPA60"); put("WBS Element", "WOIN.001.12"); put("Location", "DIAL"); put("P&L Head", "India")
    put("Category - 1 (CA/CR/Others)", "CA"); put("PO", 4200000001.0); put("Supplier Name_Unique", "Oracle")
    put("PO Start Date", datetime(2025, 4, 1)); put("PO End Date", datetime(2026, 3, 31))
    put("Nature of Expense", "Software & Licenses"); put("PO Amount", 1000); put("PO AMOUNT (INR)", 1200000)
    put("PO Nature", "Non-Recurring"); put("Carry Forward in FY27 (Yes/No)", "yes"); put("Ops POC Tag", "Anguraj")
    put("Budgeted FY'27", 12e7)
    for i, d in enumerate(FY26):
        row[h.index(d)] = 100000.0
    for d in FY27:
        row[h.index(d)] = 1.0  # ₹ crore in the sample file
    return [tuple([None] * len(h)), tuple(["note"] + [None] * (len(h) - 1)), tuple(h), tuple(row)]


def test_refined_layout_reads_canonical_keys():
    res = S.read_lines(refined_rows(), "opex_lines")
    assert res["header_row"] == 3
    assert res["ignored"] == []
    assert res["dropped"] == ["Nature of PO (Recurring/One-Time)"]
    f = res["lines"][0]
    assert f["po_amount"] == 1200000 and f["po_amount_doc"] == 1000      # PO AMOUNT (INR), not "PO Amount"
    assert f["recurring"] == "One-Time"                                   # from "PO Nature"; Non-Recurring → One-Time
    assert f["tag"] == "DIAL"                                             # P&L tag from "Location"
    assert f["nature_of_expense"] == "Software & Licenses"
    assert f["po"] == "4200000001" and f["vendor"] == "Oracle" and f["owner"] == "Anguraj"
    assert f["carry_forward"] == "Yes" and f["B27__annual"] == 12e7
    assert f["po_start"] == "2025-04-01"
    w = S.crore_months_warning(res["lines"], "FY27")
    assert w and "crore" in w


def test_duplicate_nature_of_expense_resolved_by_content():
    """Opex_Forecast: two 'Nature of Expense' columns — one holds Recurring / One-Time."""
    h = ("S. No.", "AOP Code", "Old PO_Unique", "Nature of Expense", "Nature of Expense", "PO AMOUNT", "Reporting Tag", "Unknown col")
    rows = [h, (5, "OPA1", "1100001121", "Recurring", "AMC & CMC", 10, "GHIAL", "x"),
            (6, "OPA2", "1100001122", "One-Time", "Spares", 20, "DIAL", "y")]
    res = S.read_lines(rows, "opex_tracker")
    a, b = res["lines"]
    assert a["recurring"] == "Recurring" and a["nature_of_expense"] == "AMC & CMC"
    assert b["recurring"] == "One-Time" and b["nature_of_expense"] == "Spares"
    assert a["po"] == "1100001121" and a["po_amount"] == 10 and a["tag"] == "GHIAL"
    assert "Unknown col" in res["ignored"]
    assert S.line_id_from_sno(a["_sno"]) == "TRK-00005"


def test_layout_labels_follow_config():
    lay = S.layout("opex_tracker", CFG)
    labels = [c["label"] for c in lay]
    assert "Budgeted FY'28" in labels and "Budgeted FY'27 (current year)" in labels and "Carry Forward in FY28 (Yes/No)" in labels
    assert labels[0] == "Line ID" and labels.index("PO Link") < labels.index("Mapping status")
    lay2 = S.layout("opex_lines", CFG)
    assert "Total FY'26" in [c["label"] for c in lay2] and "YTD Dec'25" in [c["label"] for c in lay2]


def test_download_upload_round_trip():
    """Rows written in the download layout read back to the same input values."""
    lay = S.layout("opex_tracker", CFG)
    f = {"line_id": "TRK-00001", "aop_code": "OPA1", "po": "4200000001", "tag": "DIAL", "recurring": "Recurring",
         "po_amount": 1200.0, "B27__annual": 3650.0, "B28__annual": 2400.0, "carry_forward": "No", "br_scope": 10.0,
         "latest_po": "4200000099", "mapping_status": "Awaiting new PO", "F27__2026-04": 300.0}
    f.update(S.derive(f, "opex_tracker", CFG))
    header = [datetime(int(c["month"][:4]), int(c["month"][5:]), 1) if c.get("month") else c["label"] for c in lay]
    rows = [tuple(header), tuple(f.get(c["key"]) for c in lay)]
    back = S.read_lines(rows, "opex_tracker")
    assert back["ignored"] == [] and back["dropped"] == []
    g = back["lines"][0]
    for k in ("line_id", "aop_code", "po", "tag", "recurring", "po_amount", "B27__annual", "B28__annual", "carry_forward",
              "br_scope", "mapping_status"):
        assert g.get(k) == f[k], k
    assert "latest_po" not in g and "variance" not in g  # computed columns are not read


def test_migration_renames_and_drops():
    old = {"old_po": 4200000001.0, "vendor_name_override": "Oracle", "nature_of_expense_2": "AMC & CMC", "budget_plan": 100.0,
           "owner_name": "A", "reporting_tag": "DIAL", "head": "X", "new_po_fy27_auto_calc": 1, "F27__2026-04": 5.0,
           "saving_target": 3, "line_id": "TRK-00001"}
    new, dropped = S.migrate_fields(old, "opex_tracker", CFG)
    assert new["po"] == "4200000001" and new["vendor"] == "Oracle" and new["nature_of_expense"] == "AMC & CMC"
    assert new["B27__annual"] == 100.0 and new["owner"] == "A" and new["tag"] == "DIAL"
    assert new["F27__2026-04"] == 5.0 and new["saving_target"] == 3 and new["line_id"] == "TRK-00001"
    assert "nature_of_expense_2" not in new and set(dropped) == {"head", "new_po_fy27_auto_calc"}


def test_mis_opex_by_category_same_after_migration():
    def run(row):
        data = {"opex_lines": [row]}
        out = mr.opex_analysis(data, [], CFG)
        return {c["id"]: sum(c["values"]["b_plan"]) for c in out["by_category"]}
    b = {f"B27__{p}": 3.0 for p in ["2026-04", "2026-05"]}
    legacy = {"category": "CA", "geo": "India", "tag": "DIAL", "nature_of_expense_2": "AMC & CMC", **b}
    migrated, _ = S.migrate_fields(legacy, "opex_lines", CFG)
    assert run(legacy) == run(migrated)
    assert run(migrated)["AMC/CMC"] > 0
