"""Excel upload / download utilities for masters and projects."""
import io
import pandas as pd
from typing import List, Dict, Tuple, Any
from datetime import datetime, timezone
import uuid


def gen_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Field schemas (column_name -> required)
PROJECT_COLS = {
    "project_name": True, "wbs_element": False, "customer_po_number": False,
    "po_date": False, "start_date": False, "end_date": False,
    "billing_type": False, "customer_name": False, "description": False,
    "currency": False, "po_value": False, "revenue_total": False, "cost_total": False,
    "country": False, "pnl_location": False, "pnl_region": False,
    "airport_adjacency": False, "project_grouping": False, "location": False,
    "category1": False, "category2": False, "business_category": False,
    "ownership_email": False, "baseline_remarks": False, "finance_remarks": False,
}

CUSTOMER_COLS = {
    "customer_name": True, "sap_customer_code": False, "balance_outstanding_sap": False,
    "risk_notes": False, "contact_person": False, "email": False, "phone": False, "country": False,
}

EMPLOYEE_COLS = {
    "employee_code": True, "employee_name": True, "email_id": True,
    "designation": False, "department": False, "l1_manager_email": False, "location": False,
}

SUPPLIER_COLS = {
    "supplier_name": True, "supplier_code": False, "contact_person": False,
    "email": False, "phone": False, "address": False,
}

REVENUE_COLS = {
    "project_id": True, "amount": True, "revenue_code": False,
    "description": False, "recognition_date": False, "billing_date": False, "is_billed": False,
}

COST_COLS = {
    "project_id": True, "amount": True, "vendor_po_ref": False,
    "supplier_name": False, "description": False, "expense_date": False, "category": False,
}

SCHEMAS = {
    "project": PROJECT_COLS,
    "customer": CUSTOMER_COLS,
    "employee": EMPLOYEE_COLS,
    "supplier": SUPPLIER_COLS,
    "revenue": REVENUE_COLS,
    "cost": COST_COLS,
}


def build_template_xlsx(entity: str) -> bytes:
    cols = list(SCHEMAS[entity].keys())
    df = pd.DataFrame(columns=cols)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name=f"{entity}_template")
    return buf.getvalue()


def parse_xlsx(file_bytes: bytes, entity: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Returns (valid_rows, failures)."""
    schema = SCHEMAS[entity]
    # numeric/bool fields - everything else should be coerced to str to avoid
    # type mismatches (e.g., openpyxl reads numeric phone numbers as int).
    NUMERIC_FIELDS = {"po_value", "revenue_total", "cost_total", "amount", "balance_outstanding_sap"}
    BOOL_FIELDS = {"is_billed"}
    df = pd.read_excel(io.BytesIO(file_bytes))
    df = df.where(pd.notnull(df), None)
    valid: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []
    for idx, row in df.iterrows():
        rec: Dict[str, Any] = {}
        errors: List[str] = []
        for col, required in schema.items():
            val = row.get(col) if col in df.columns else None
            if val is None or (isinstance(val, float) and pd.isna(val)) or val == "":
                if required:
                    errors.append(f"Missing required field: {col}")
                continue
            # Type coercions
            if col in NUMERIC_FIELDS:
                try:
                    rec[col] = float(val)
                except Exception:
                    errors.append(f"Invalid number for {col}: {val}")
                    continue
            elif col in BOOL_FIELDS:
                rec[col] = str(val).strip().lower() in ("true", "yes", "1", "y")
            else:
                # Force string for all other schema columns to keep MongoDB types stable.
                if isinstance(val, float) and val.is_integer():
                    rec[col] = str(int(val))
                else:
                    rec[col] = str(val).strip()
        if errors:
            failures.append({"row": int(idx) + 2, "errors": errors, "data": rec})
        else:
            valid.append(rec)
    return valid, failures


def build_export_xlsx(rows: List[Dict[str, Any]], entity: str) -> bytes:
    if not rows:
        df = pd.DataFrame(columns=list(SCHEMAS[entity].keys()))
    else:
        df = pd.DataFrame(rows)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name=entity)
    return buf.getvalue()
