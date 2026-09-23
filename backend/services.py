"""Workflow + Approval engine + Audit logging services."""
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import uuid

STAGE_ORDER = ["Pipeline", "Deal P&L", "Customer PO", "Operations", "Closure"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_id() -> str:
    return str(uuid.uuid4())


def can_transition(current: str, target: str) -> bool:
    """Allow forward transitions one step at a time, or backward from any to Pipeline."""
    if current == target:
        return False
    try:
        cur_idx = STAGE_ORDER.index(current)
        tgt_idx = STAGE_ORDER.index(target)
    except ValueError:
        return False
    # Forward by 1, or backward to a previous stage (rework/correction allowed)
    return tgt_idx == cur_idx + 1 or tgt_idx < cur_idx


async def write_audit(db, *, entity_type: str, entity_id: str, action: str,
                      user: Optional[dict] = None, field_changes: Optional[Dict[str, Any]] = None,
                      reason: str = "") -> None:
    # Strip mongo internal _id (ObjectId is not JSON serializable)
    fc = field_changes or {}
    if isinstance(fc, dict) and "_id" in fc:
        fc = {k: v for k, v in fc.items() if k != "_id"}
    doc = {
        "id": gen_id(),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "field_changes": fc,
        "user_email": (user or {}).get("email"),
        "user_id": (user or {}).get("id"),
        "reason": reason or "",
        "timestamp": now_iso(),
    }
    await db.audit_logs.insert_one(doc)


def compute_margin(po_value: float, revenue_total: float, cost_total: float) -> Dict[str, float]:
    revenue = revenue_total or po_value or 0.0
    margin = (revenue or 0.0) - (cost_total or 0.0)
    pct = (margin / revenue * 100.0) if revenue else 0.0
    return {"margin_total": round(margin, 2), "margin_pct": round(pct, 2)}


async def find_matching_rule(db, project: dict, target_stage: str) -> Optional[dict]:
    """Find first active approval rule that matches the project for the given target stage."""
    rules = await db.approval_rules.find({"is_active": True}, {"_id": 0}).to_list(500)
    revenue = project.get("revenue_total") or project.get("po_value") or 0.0
    margin_pct = project.get("margin_pct") or 0.0
    biz = project.get("business_category") or "Non-GMR"
    for r in rules:
        if r.get("target_stage") and r.get("target_stage") != target_stage:
            continue
        if r.get("business_category") and r.get("business_category") not in (None, "Any") and r["business_category"] != biz:
            continue
        if r.get("min_revenue") is not None and revenue < r["min_revenue"]:
            continue
        if r.get("max_revenue") is not None and revenue > r["max_revenue"]:
            continue
        if r.get("min_margin_pct") is not None and margin_pct < r["min_margin_pct"]:
            continue
        if r.get("max_margin_pct") is not None and margin_pct > r["max_margin_pct"]:
            continue
        return r
    return None


async def create_approval_request(db, project: dict, rule: dict, target_stage: str, user: dict) -> dict:
    req = {
        "id": gen_id(),
        "project_id": project["id"],
        "project_name": project.get("project_name"),
        "target_stage": target_stage,
        "rule_id": rule.get("id"),
        "rule_name": rule.get("name"),
        "approver_emails": rule.get("approver_emails") or [],
        "approver_role": rule.get("approver_role"),
        "status": "Pending",
        "comment": "",
        "requested_by": user.get("email") if user else None,
        "requested_at": now_iso(),
        "actioned_at": None,
        "actioned_by": None,
    }
    await db.approval_requests.insert_one(req)
    return req
