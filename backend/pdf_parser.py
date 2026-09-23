"""PDF parsing helper - extracts financial fields from a Customer/Vendor PO PDF.

WAISL is the host company.
- Customer PO: WAISL is the *vendor/seller* (someone else issues the PO to WAISL)
- Vendor   PO: WAISL is the *issuer/buyer* (WAISL issues the PO to a supplier)
"""
import re
from typing import Dict, Any, Optional, List

try:
    import pdfplumber
except Exception:  # pragma: no cover
    pdfplumber = None  # type: ignore


WAISL_ALIASES = [
    "waisl", "w.a.i.s.l", "wai s l", "waislt", "waisl ltd", "waisl limited",
    "waisl pvt", "waisl private",
]


def _has_waisl(text: str) -> bool:
    t = text.lower()
    return any(a in t for a in WAISL_ALIASES)


def _classify_po(text: str) -> Dict[str, Any]:
    """Best-effort classify whether the PDF is a Customer PO or Vendor PO.

    Heuristics:
      - Customer PO: WAISL appears under "Vendor" / "Bill To" / "Supplier"
      - Vendor   PO: WAISL appears under "From" / "Issued by" / "Buyer" / letterhead
                     and the PO has a different supplier in "To" / "Vendor"
    """
    out = {"po_type": "Unknown", "issuer": None, "recipient": None, "confidence": "low"}
    lower = text.lower()

    # Find blocks for buyer/seller/vendor/supplier/from/to
    def _block(label_patterns: List[str]) -> Optional[str]:
        for p in label_patterns:
            m = re.search(rf"{p}\s*[:\-]?\s*([^\n]{{2,200}}(?:\n[^\n]{{0,120}}){{0,4}})", text, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return None

    issuer_block = _block([r"from", r"issued\s*by", r"buyer", r"purchaser", r"bill\s*from"])
    recipient_block = _block([r"to(?:\s*[, ])", r"vendor", r"supplier", r"bill\s*to", r"deliver\s*to"])

    if issuer_block:
        out["issuer"] = issuer_block.split("\n")[0].strip()[:120]
    if recipient_block:
        out["recipient"] = recipient_block.split("\n")[0].strip()[:120]

    waisl_in_issuer = _has_waisl(issuer_block or "")
    waisl_in_recipient = _has_waisl(recipient_block or "")

    # Header / first lines often carry the issuer letterhead
    head = "\n".join(text.splitlines()[:8]).lower()
    waisl_in_head = any(a in head for a in WAISL_ALIASES)

    if waisl_in_recipient and not waisl_in_issuer:
        out["po_type"] = "Customer PO"
        out["confidence"] = "high"
    elif waisl_in_issuer and not waisl_in_recipient:
        out["po_type"] = "Vendor PO"
        out["confidence"] = "high"
    elif waisl_in_head and not waisl_in_recipient:
        out["po_type"] = "Vendor PO"
        out["confidence"] = "medium"
    elif _has_waisl(lower):
        # WAISL mentioned but role unclear — fall back to keyword cues
        if re.search(r"vendor\s*po|purchase\s*order\s*to\s*supplier", lower):
            out["po_type"] = "Vendor PO"
            out["confidence"] = "medium"
        else:
            out["po_type"] = "Customer PO"
            out["confidence"] = "medium"
    else:
        # No WAISL found at all
        out["po_type"] = "Unknown"
        out["confidence"] = "low"

    return out


def _amount(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", ""))
    except Exception:
        return None


def parse_customer_po(file_bytes: bytes) -> Dict[str, Any]:
    """Best-effort extraction of common fields from a PO PDF.

    Returns a dict with extracted fields, classification, and the raw text (truncated)."""
    out: Dict[str, Any] = {
        "po_type": "Unknown",
        "po_classification": {},
        "issuer": None,
        "recipient": None,
        "customer_name": None,
        "vendor_name": None,
        "customer_po_number": None,
        "po_date": None,
        "po_value": None,
        "currency": None,
        "start_date": None,
        "end_date": None,
        "billing_type": None,
        "description": None,
        "vendor_references": [],
        "milestones": [],
        "raw_text_excerpt": "",
        "warnings": [],
    }
    if pdfplumber is None:
        out["warnings"].append("pdfplumber not installed")
        return out
    try:
        import io as _io
        with pdfplumber.open(_io.BytesIO(file_bytes)) as pdf:
            text = "\n".join((page.extract_text() or "") for page in pdf.pages)
    except Exception as e:
        out["warnings"].append(f"failed to read pdf: {e}")
        return out

    out["raw_text_excerpt"] = text[:6000]

    # Classify
    cls = _classify_po(text)
    out["po_classification"] = cls
    out["po_type"] = cls.get("po_type") or "Unknown"
    out["issuer"] = cls.get("issuer")
    out["recipient"] = cls.get("recipient")

    # Map customer / vendor names based on classification
    if out["po_type"] == "Customer PO":
        out["customer_name"] = cls.get("issuer")
        out["vendor_name"] = cls.get("recipient")  # WAISL
    elif out["po_type"] == "Vendor PO":
        out["customer_name"] = cls.get("issuer")  # WAISL
        out["vendor_name"] = cls.get("recipient")

    # PO number
    m = re.search(
        r"(?:purchase\s*order(?:\s*no\.?)?|p\.?o\.?\s*(?:number|no\.?)|order\s*no\.?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/_]{3,40})",
        text, re.IGNORECASE,
    )
    if m:
        out["customer_po_number"] = m.group(1).strip()

    # PO Date
    m = re.search(
        r"(?:p\.?o\.?\s*date|date\s*of\s*issue|order\s*date|issue\s*date|dated)\s*[:\-]?\s*([0-9]{1,2}[\-\/\s\.][A-Za-z0-9]{1,9}[\-\/\s\.][0-9]{2,4})",
        text, re.IGNORECASE,
    )
    if m:
        out["po_date"] = m.group(1).strip()

    # Start / End dates
    m = re.search(r"(?:start\s*date|commencement|effective\s*from|valid\s*from)\s*[:\-]?\s*([0-9]{1,2}[\-\/\s\.][A-Za-z0-9]{1,9}[\-\/\s\.][0-9]{2,4})",
                  text, re.IGNORECASE)
    if m:
        out["start_date"] = m.group(1).strip()
    m = re.search(r"(?:end\s*date|completion|valid\s*(?:till|until|upto)|expiry)\s*[:\-]?\s*([0-9]{1,2}[\-\/\s\.][A-Za-z0-9]{1,9}[\-\/\s\.][0-9]{2,4})",
                  text, re.IGNORECASE)
    if m:
        out["end_date"] = m.group(1).strip()

    # Total value
    val_match = re.search(
        r"(?:grand\s*total|total\s*(?:amount|value|order\s*value)|net\s*(?:amount|payable)|po\s*value|order\s*value)\s*[:\-]?\s*(?:₹|Rs\.?|INR|\$|USD|EUR|€|£|GBP)?\s*([\d,]+(?:\.\d+)?)",
        text, re.IGNORECASE,
    )
    if val_match:
        out["po_value"] = _amount(val_match.group(1))

    # Currency
    if re.search(r"₹|INR|Rupees", text, re.IGNORECASE):
        out["currency"] = "INR"
    elif re.search(r"\$|USD|US\s*Dollars?", text, re.IGNORECASE):
        out["currency"] = "USD"
    elif re.search(r"€|EUR|Euros?", text, re.IGNORECASE):
        out["currency"] = "EUR"
    elif re.search(r"£|GBP|Pounds?", text, re.IGNORECASE):
        out["currency"] = "GBP"

    # Billing type
    if re.search(r"milestone\s*(?:based|payment|billing)", text, re.IGNORECASE):
        out["billing_type"] = "Milestone"
    elif re.search(r"monthly\s*(?:billing|invoice)", text, re.IGNORECASE):
        out["billing_type"] = "Monthly"

    # Description / scope
    m = re.search(r"(?:scope\s*of\s*(?:work|supply)|description|subject)\s*[:\-]\s*([^\n]{8,300})",
                  text, re.IGNORECASE)
    if m:
        out["description"] = m.group(1).strip()

    # Vendor references
    for vm in re.finditer(
        r"(?:vendor\s*ref(?:erence)?|ref(?:erence)?\s*no\.?|rfq|quotation\s*no\.?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,30})",
        text, re.IGNORECASE,
    ):
        ref = vm.group(1).strip()
        if ref and ref not in out["vendor_references"]:
            out["vendor_references"].append(ref)

    # Milestones — rows like "Milestone 1 ... 25-Mar-2026 ... 10,00,000"
    seen_keys = set()
    for mm in re.finditer(
        r"(milestone\s*\d+|phase\s*\d+|m[ \-]?\d+|deliverable\s*\d+)[^\n]{0,150}?([0-9]{1,2}[\-\/\s\.][A-Za-z0-9]{1,9}[\-\/\s\.][0-9]{2,4})[^\n]{0,40}?([\d,]+(?:\.\d+)?)",
        text, re.IGNORECASE,
    ):
        name = mm.group(1).strip()
        date = mm.group(2).strip()
        key = (name.lower(), date)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        out["milestones"].append({
            "milestone_name": name,
            "due_date": date,
            "value": _amount(mm.group(3)) or 0.0,
            "is_billed": False,
        })

    if not any([out["customer_po_number"], out["po_date"], out["po_value"]]):
        out["warnings"].append("Could not detect any PO fields — please review manually")

    return out
