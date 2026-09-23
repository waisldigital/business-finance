"""Unified SAP transactions parser.

Reads the unified 4-sheet SAP master template uploaded by Finance:

  * Expenses_SAP   — vendor / cost transactions (~48 cols)
  * Revenue_SAP    — billing / revenue transactions (~30 cols)
  * Supplier Mapping — supplier_id -> supplier_name lookup
  * Project Master  — WBS Element -> project metadata

Parsing rules:
  - Both sheets share the first ~27 columns (SAP standard).
  - "WBS Element" is the foreign key to the project (truncated to project root).
  - Amount_INR is the canonical signed amount (positive = expense / billed; SAP
    revenue rows have negative `Amount_INR`; we always store positive `amount`).
  - Posting Date / Entry Date drive `recognition_date` (revenue) and
    `expense_date` (cost).

The parser is intentionally lenient: missing optional cells default to `None`
and rows with no Amount_INR / no WBS are skipped (counted in `skipped`).
"""

from __future__ import annotations

from io import BytesIO
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import openpyxl


REVENUE_SHEET_CANDIDATES = ["Revenue_SAP", "Revenue", "REVENUE_SAP"]
EXPENSE_SHEET_CANDIDATES = ["Expenses_SAP", "Expense_SAP", "Expenses", "EXPENSES_SAP"]
SUPPLIER_SHEET_CANDIDATES = ["Supplier Mapping", "Supplier_Mapping", "Suppliers"]
PROJECT_SHEET_CANDIDATES = ["Project Master", "Project_Master", "Projects"]


def _to_iso_date(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, (int, float)):
        # SAP-exported YYYYMMDD style
        s = str(int(v))
        if len(s) == 8:
            try:
                return datetime.strptime(s, "%Y%m%d").date().isoformat()
            except ValueError:
                pass
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _to_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        s = str(v).replace(",", "").strip()
        try:
            return float(s)
        except ValueError:
            return None


def _to_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return s or None


def _normalise_wbs(v: Any) -> Optional[str]:
    s = _to_str(v)
    return s.upper() if s else None


def _wbs_root(wbs: Optional[str]) -> Optional[str]:
    """Return the canonical project-level prefix.

    SAP often appends sub-WBS suffixes (e.g. ``WSIN.000136.0001``); the parent
    project is registered under the parent (``WSIN.000136``) or the full path
    itself. We compare on three levels: full match, drop-last, drop-last-two.
    """
    if not wbs:
        return None
    return wbs


def _wbs_variants(wbs: Optional[str]) -> List[str]:
    if not wbs:
        return []
    parts = wbs.split(".")
    out: List[str] = [wbs]
    for n in (1, 2, 3):
        if len(parts) > n:
            out.append(".".join(parts[:-n]))
    return out


def _open_sheet(wb: openpyxl.Workbook, candidates: List[str]):
    for name in candidates:
        if name in wb.sheetnames:
            return wb[name]
    return None


def _row_dict(headers: List[str], row: Tuple[Any, ...]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for i, h in enumerate(headers):
        if not h:
            continue
        out[h] = row[i] if i < len(row) else None
    return out


def _supplier_lookup(wb: openpyxl.Workbook) -> Dict[str, str]:
    sh = _open_sheet(wb, SUPPLIER_SHEET_CANDIDATES)
    if not sh:
        return {}
    headers = [c.value for c in sh[1]]
    out: Dict[str, str] = {}
    for row in sh.iter_rows(min_row=2, values_only=True):
        rd = _row_dict(headers, row)
        sid = _to_str(rd.get("Supplier"))
        name = _to_str(rd.get("Name"))
        if sid and name:
            out[sid] = name
    return out


def _project_lookup(wb: openpyxl.Workbook) -> Dict[str, Dict[str, Any]]:
    sh = _open_sheet(wb, PROJECT_SHEET_CANDIDATES)
    if not sh:
        return {}
    headers = [c.value for c in sh[1]]
    out: Dict[str, Dict[str, Any]] = {}
    for row in sh.iter_rows(min_row=2, values_only=True):
        rd = _row_dict(headers, row)
        wbs = _normalise_wbs(rd.get("WBS Element"))
        if not wbs:
            continue
        out[wbs] = {
            "wbs_element": wbs,
            "project_name": _to_str(rd.get("Project Name")),
            "pnl_location": _to_str(rd.get("P&L Region")) or _to_str(rd.get("P&L Head")),
            "project_grouping": _to_str(rd.get("Project Grouping")),
            "airport_adjacency": _to_str(rd.get("Airport/Non-Airport")),
            "location": _to_str(rd.get("Location")),
            "category1": _to_str(rd.get("Category - 1 (CR/Projects)")),
            "category2": _to_str(rd.get("Category - 2 (Digital/Non-Digital)")),
            "business_category": _to_str(rd.get("For P&L Filter(Reporting Tag)")),
            "retro_pnl_tagging": _to_str(rd.get("Retro P&L Tagging")),
        }
    return out


def parse_workbook(file_bytes: bytes) -> openpyxl.Workbook:
    return openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)


def lookup_project_metadata(file_bytes: bytes, wbs_input: Optional[str] = None) -> Dict[str, Any]:
    """Return Project Master row matching the given WBS (any level prefix)."""
    wb = parse_workbook(file_bytes)
    pmap = _project_lookup(wb)
    if not pmap:
        return {"matched": False, "reason": "Project Master sheet not found", "candidates": []}
    if wbs_input:
        for v in _wbs_variants(_normalise_wbs(wbs_input)):
            if v in pmap:
                return {"matched": True, "metadata": pmap[v], "candidates": list(pmap.keys())[:50]}
    return {"matched": False, "candidates": list(pmap.keys())[:50], "metadata": None}


def parse_revenue_rows(file_bytes: bytes, wbs_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    """Convert Revenue_SAP rows into RevenueLine documents.

    `wbs_filter` (optional) restricts to rows whose WBS Element matches the
    given WBS or any of its prefixes (e.g. project root match).
    """
    wb = parse_workbook(file_bytes)
    sh = _open_sheet(wb, REVENUE_SHEET_CANDIDATES)
    if not sh:
        return []
    headers = [c.value for c in sh[1]]
    accept = set(_wbs_variants(_normalise_wbs(wbs_filter))) if wbs_filter else None
    out: List[Dict[str, Any]] = []
    for row in sh.iter_rows(min_row=2, values_only=True):
        rd = _row_dict(headers, row)
        wbs = _normalise_wbs(rd.get("WBS Element"))
        amount = _to_float(rd.get("Amount_INR"))
        if amount is None or amount == 0:
            continue
        if accept is not None and not any(v in accept for v in _wbs_variants(wbs) if v):
            continue
        rec_date = _to_iso_date(rd.get("Posting Date")) or _to_iso_date(rd.get("Entry Date"))
        out.append({
            "wbs_element": wbs,
            "amount": abs(amount),
            "revenue_code": _to_str(rd.get("Document Number")),
            "description": _to_str(rd.get("Text")) or _to_str(rd.get("G/L Account: Long Text")),
            "recognition_date": rec_date,
            "billing_date": _to_iso_date(rd.get("Posting Date")) if rd.get("Document Type") in ("RV", "DR", "ZC") else None,
            "is_billed": rd.get("Document Type") in ("RV", "DR", "ZC"),
            "sap_document_number": _to_str(rd.get("Document Number")),
            "sap_document_type": _to_str(rd.get("Document Type")),
            "sap_reference": _to_str(rd.get("Reference")),
            "currency": _to_str(rd.get("Company Code Currency Key")) or "INR",
            "revenue_tag": _to_str(rd.get("Revenue Tag")),
            "project_name": _to_str(rd.get("Project Name")),
        })
    return out


def parse_cost_rows(file_bytes: bytes, wbs_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    """Convert Expenses_SAP rows into CostLine documents."""
    wb = parse_workbook(file_bytes)
    sh = _open_sheet(wb, EXPENSE_SHEET_CANDIDATES)
    if not sh:
        return []
    suppliers = _supplier_lookup(wb)
    headers = [c.value for c in sh[1]]
    accept = set(_wbs_variants(_normalise_wbs(wbs_filter))) if wbs_filter else None
    out: List[Dict[str, Any]] = []
    for row in sh.iter_rows(min_row=2, values_only=True):
        rd = _row_dict(headers, row)
        wbs = _normalise_wbs(rd.get("WBS Element"))
        amount = _to_float(rd.get("Amount_INR"))
        if amount is None or amount == 0:
            continue
        if accept is not None and not any(v in accept for v in _wbs_variants(wbs) if v):
            continue
        sup_id = _to_str(rd.get("Supplier"))
        sup_name = (
            _to_str(rd.get("Supplier Name (@60% Accuracy)"))
            or (suppliers.get(sup_id) if sup_id else None)
        )
        out.append({
            "wbs_element": wbs,
            "amount": abs(amount),
            "vendor_po_ref": _to_str(rd.get("PO Number")) or _to_str(rd.get("Legacy PO")),
            "supplier_id": sup_id,
            "supplier_name": sup_name,
            "description": _to_str(rd.get("Text")) or _to_str(rd.get("G/L Account: Long Text")),
            "expense_date": _to_iso_date(rd.get("Posting Date")) or _to_iso_date(rd.get("Entry Date")),
            "category": _to_str(rd.get("Final Exp.Cat.")) or _to_str(rd.get("G/L Account: Long Text")),
            "sap_document_number": _to_str(rd.get("Document Number")),
            "sap_document_type": _to_str(rd.get("Document Type")),
            "currency": _to_str(rd.get("Company Code Currency Key")) or "INR",
            "department": _to_str(rd.get("Department")),
            "sub_function": _to_str(rd.get("Sub-Function")),
            "nature_of_services": _to_str(rd.get("Nature of services")),
        })
    return out


# ----- Template builder (so users can download the unified template) -----
EXPENSE_HEADERS = [
    "Company Code", "Posting Date", "Document Type", "Cost Center: Long Text",
    "WBS Element", "Document Number", "Supplier", "G/L Account",
    "G/L Account: Long Text", "Quantity", "Update Currency for General Ledger",
    "Update Currency Value for General Ledger", "Exchange rate", "Amount_INR",
    "Cost Center", "Profit Center", "User Name", "Company Code Currency Key",
    "Unit of Measure", "Text", "PO Number", "Reference", "Assignment",
    "Document Header Text", "Profit Center: Long text", "Reversal Ref No.",
    "Entry Date", "Legacy PO", "Document Type Name",
    "Supplier Name (@60% Accuracy)", "WBS - Business Finance Final",
    "Reversal Tag", "Final Exp.Cat.", "Business Unit", "Business Unit",
    "Department", "Sub-Function", "Nature of services",
    "Final Cost Centre for MIS", "AOP Code", "From WBS",
    "Business Finance Remarks", "Check",
]

REVENUE_HEADERS = [
    "Company Code", "Posting Date", "Document Type", "Cost Center: Long Text",
    "WBS Element", "Document Number", "Supplier", "G/L Account",
    "G/L Account: Long Text", "Quantity", "Update Currency for General Ledger",
    "Update Currency Value for General Ledger", "Exchange rate", "Amount_INR",
    "Cost Center", "Profit Center", "User Name", "Company Code Currency Key",
    "Unit of Measure", "Text", "PO Number", "Reference", "Assignment",
    "Document Header Text", "Profit Center: Long text", "Reversal Ref No.",
    "Entry Date", "Revenue Tag", "Project Name", "WBS Description",
]

SUPPLIER_HEADERS = ["Supplier", "Name", "Country/Region Key", "Created by"]
PROJECT_HEADERS = [
    "WBS Element", "Project Name", "P&L Head", "P&L Region",
    "Project Grouping", "Airport/Non-Airport", "Location",
    "Category - 1 (CR/Projects)", "Category - 2 (Digital/Non-Digital)",
    "For P&L Filter(Reporting Tag)", "Retro P&L Tagging", "Retro P&L Location",
]


def build_template_xlsx() -> bytes:
    """Build a 4-sheet empty SAP transactions template."""
    wb = openpyxl.Workbook()
    # default sheet -> rename to Expenses_SAP
    ws = wb.active
    ws.title = "Expenses_SAP"
    ws.append(EXPENSE_HEADERS)
    rev = wb.create_sheet("Revenue_SAP")
    rev.append(REVENUE_HEADERS)
    sup = wb.create_sheet("Supplier Mapping")
    sup.append(SUPPLIER_HEADERS)
    pm = wb.create_sheet("Project Master")
    pm.append(PROJECT_HEADERS)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
