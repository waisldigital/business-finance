"""Pydantic models for CRacker Pro."""
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone
import uuid


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_id() -> str:
    return str(uuid.uuid4())


# ---------- USER ----------
ROLES = ["admin", "finance", "sales", "delivery", "leadership", "approver"]


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Literal["admin", "finance", "sales", "delivery", "leadership", "approver"]
    location: Optional[str] = None
    reporting_manager_email: Optional[str] = None
    role_id: Optional[str] = None  # workspace role


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    location: Optional[str] = None
    reporting_manager_email: Optional[str] = None
    is_active: Optional[bool] = None
    role_id: Optional[str] = None


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    location: Optional[str] = None
    reporting_manager_email: Optional[str] = None
    is_active: bool = True
    role_id: Optional[str] = None
    is_permanent_admin: bool = False
    created_at: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class PasswordChange(BaseModel):
    user_id: str
    new_password: str


# ---------- ROLE (workspace section permissions) ----------
WORKSPACE_SECTIONS = [
    "dashboard",
    "pipeline",
    "projects",
    "change_requests",
    "customer_profile",
    "wbs_budget",
]


class SectionPermission(BaseModel):
    can_view: bool = False
    can_edit: bool = False  # Edit includes create + modify (NOT delete)


class RoleIn(BaseModel):
    name: str
    description: Optional[str] = ""
    permissions: Dict[str, SectionPermission] = {}


class RoleOut(RoleIn):
    id: str
    is_system: bool = False  # built-in roles like "admin" can't be deleted
    created_at: str
    updated_at: str


# ---------- CUSTOMER ----------
class CustomerAddress(BaseModel):
    label: str = "Office"
    line1: Optional[str] = ""
    line2: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    pincode: Optional[str] = ""
    country: Optional[str] = ""


class CustomerContact(BaseModel):
    role: Optional[str] = "Influencer"  # Influencer / Procurement / Finance / Tech Evaluator / Other
    name: Optional[str] = ""
    designation: Optional[str] = ""
    department: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""


class CustomerIn(BaseModel):
    customer_name: str
    sap_customer_code: Optional[str] = None
    balance_outstanding_sap: float = 0.0
    risk_notes: Optional[str] = ""
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None
    # Enriched profile (BRD)
    industry: Optional[str] = None
    sector: Optional[str] = None
    address_billing: Optional[str] = None
    address_shipping: Optional[str] = None
    secondary_contact_person: Optional[str] = None
    secondary_email: Optional[str] = None
    secondary_phone: Optional[str] = None
    website: Optional[str] = None
    account_owner_email: Optional[str] = None
    # BRD Apr 2026 — full master
    parent_group: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None  # auto-derivable from country (e.g. APAC, EMEA)
    domestic_international: Optional[str] = None  # Domestic / International
    business_category: Optional[str] = None  # GMR / Non-GMR
    primary_designation: Optional[str] = None
    primary_department: Optional[str] = None
    addresses: List[CustomerAddress] = []
    additional_contacts: List[CustomerContact] = []


class CustomerOut(CustomerIn):
    id: str
    created_at: str


# ---------- EMPLOYEE ----------
class EmployeeIn(BaseModel):
    employee_no: str
    email_id: EmailStr
    status: str = "Active"  # Active / Inactive / Exited
    joining_date: Optional[str] = None  # DD-MM-YYYY or ISO
    exit_date: Optional[str] = None
    employment_type: str = "Employee"
    employee_name: str
    role_zoho: Optional[str] = None  # Role (as per Zoho)
    l1_manager: Optional[str] = None  # store as employee_no (or email if user enters that)
    location: Optional[str] = None
    department: Optional[str] = None
    sub_department: Optional[str] = None
    # NEW Iter 9 — credentials & workspace role (sync to /users collection on save)
    password: Optional[str] = None        # write-only; never returned in EmployeeOut
    workspace_role_id: Optional[str] = None


class EmployeeOut(BaseModel):
    id: str
    employee_no: str
    email_id: str
    status: str
    joining_date: Optional[str] = None
    exit_date: Optional[str] = None
    employment_type: str
    employee_name: str
    role_zoho: Optional[str] = None
    l1_manager: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    sub_department: Optional[str] = None
    workspace_role_id: Optional[str] = None
    workspace_role_name: Optional[str] = None
    has_user_account: bool = False
    is_permanent_admin: bool = False
    created_at: str


# ---------- SUPPLIER ----------
class SupplierIn(BaseModel):
    supplier_code: Optional[str] = None
    supplier_name: str
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class SupplierOut(SupplierIn):
    id: str
    created_at: str


# ---------- PROJECT ----------
STAGES = ["Pipeline", "Deal P&L", "Customer PO", "Operations", "Closure"]
APPROVAL_STATUSES = ["Not Required", "Pending", "Approved", "Rejected"]


class Milestone(BaseModel):
    milestone_name: str
    due_date: Optional[str] = None
    value: float = 0.0
    is_billed: bool = False


class VendorPO(BaseModel):
    vendor_po_number: str
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    amount: float = 0.0


class ProjectIn(BaseModel):
    project_name: str
    wbs_element: Optional[str] = None
    customer_po_number: Optional[str] = None
    po_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    billing_type: Literal["Monthly", "Milestone"] = "Monthly"
    milestones: List[Milestone] = []
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    description: Optional[str] = None
    currency: str = "INR"
    po_value: float = 0.0
    revenue_total: float = 0.0
    cost_total: float = 0.0
    vendor_pos: List[VendorPO] = []
    country: Optional[str] = None
    pnl_location: Optional[str] = None
    pnl_region: Optional[str] = None
    airport_adjacency: Optional[str] = None
    project_grouping: Optional[str] = None
    location: Optional[str] = None
    category1: Optional[str] = None
    category2: Optional[str] = None
    business_category: Optional[str] = "Non-GMR"  # GMR / Non-GMR
    retro_pnl_tagging: Optional[str] = None
    ownership_email: Optional[str] = None
    stakeholders: List[str] = []
    baseline_remarks: Optional[str] = ""
    finance_remarks: Optional[str] = ""
    # BRD Apr 2026 — Management Review flags + extended fields
    md_review_required: bool = False
    cfo_review_required: bool = False
    ceo_visibility: bool = False
    strategic_deal: bool = False
    finance_spoc_email: Optional[str] = None
    pipeline_id: Optional[str] = None  # link back to originating pipeline opportunity


class ProjectOut(ProjectIn):
    id: str
    current_stage: str = "Pipeline"
    approval_status: str = "Not Required"
    margin_total: float = 0.0
    margin_pct: float = 0.0
    created_at: str
    updated_at: str
    created_by: Optional[str] = None


class StageTransitionIn(BaseModel):
    target_stage: Literal["Pipeline", "Deal P&L", "Customer PO", "Operations", "Closure"]
    reason: Optional[str] = ""


# ---------- REVENUE / COST ----------
class RevenueLineIn(BaseModel):
    project_id: Optional[str] = None
    revenue_code: Optional[str] = None
    description: Optional[str] = None
    amount: float
    recognition_date: Optional[str] = None
    billing_date: Optional[str] = None
    is_billed: bool = False


class RevenueLineOut(RevenueLineIn):
    id: str
    created_at: str


class CostLineIn(BaseModel):
    project_id: Optional[str] = None
    vendor_po_ref: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    description: Optional[str] = None
    amount: float
    expense_date: Optional[str] = None
    category: Optional[str] = None


class CostLineOut(CostLineIn):
    id: str
    created_at: str


# ---------- APPROVAL ----------
class ApprovalRuleIn(BaseModel):
    name: str
    business_category: Optional[str] = None  # GMR / Non-GMR / Any
    min_revenue: Optional[float] = None
    max_revenue: Optional[float] = None
    min_margin_pct: Optional[float] = None
    max_margin_pct: Optional[float] = None
    target_stage: Optional[str] = None  # which stage triggers
    approver_emails: List[str] = []
    approver_role: Optional[str] = None
    applies_to: Literal["project", "change_request", "both"] = "both"  # NEW Iter 10
    is_active: bool = True


class ApprovalRuleOut(ApprovalRuleIn):
    id: str
    created_at: str


class ApprovalActionIn(BaseModel):
    action: Literal["approve", "reject"]
    comment: Optional[str] = ""


class ApprovalRequestOut(BaseModel):
    id: str
    project_id: str
    project_name: str
    target_stage: str
    rule_id: Optional[str] = None
    rule_name: Optional[str] = None
    approver_email: Optional[str] = None
    approver_role: Optional[str] = None
    status: str  # Pending / Approved / Rejected
    comment: Optional[str] = ""
    requested_by: Optional[str] = None
    requested_at: str
    actioned_at: Optional[str] = None
    actioned_by: Optional[str] = None


# ---------- AUDIT ----------
class AuditLogOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    action: str  # create/update/delete/stage_change/approval
    field_changes: Optional[Dict[str, Any]] = None
    user_email: Optional[str] = None
    user_id: Optional[str] = None
    reason: Optional[str] = ""
    timestamp: str


# ---------- UPLOAD LOG ----------
class UploadLogOut(BaseModel):
    id: str
    entity_type: str  # project / customer / employee / supplier / revenue / cost
    file_name: str
    total_rows: int
    success_rows: int
    failed_rows: int
    failures: List[Dict[str, Any]] = []
    uploaded_by: Optional[str] = None
    uploaded_at: str


# ---------- PIPELINE (Opportunity funnel, BRD 5 stages) ----------
PIPELINE_STAGES = [
    "Prospecting",
    "Active Discussion",
    "Proposal Submitted",
    "Evaluation/Negotiation",
    "Closed",
]
PIPELINE_OUTCOMES = ["Open", "Won", "Lost"]
HANDOFF_STATUSES = ["Not Applicable", "Pending Finance", "Approved", "Rejected"]


class PipelineIn(BaseModel):
    # ===== Stage 1 — Prospecting =====
    opportunity_title: str
    opportunity_id: Optional[str] = None  # auto-generated; surfaced in UI
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    bd_owner: Optional[str] = None
    expected_revenue: float = 0.0
    currency: str = "USD"  # BRD default USD
    source: Optional[str] = None  # legacy lead source string
    industry: Optional[str] = None

    # New BRD Stage 1 fields
    opportunity_category: Literal["Project", "Change Request"] = "Project"
    opportunity_type: Optional[str] = None  # New Business / Existing Client Expansion / Renewal / Cross-sell / Upsell
    solution_line: Optional[str] = None     # Airport IT / Cybersecurity / Network / etc.
    business_need: Optional[str] = ""
    nature_of_work: Optional[str] = None    # High Resource Cost / High TP Cost / Hybrid
    lead_source: Optional[str] = None       # Referral / Tender / RFP / Partner / Direct / Event / Govt Bid
    opportunity_source_type: Optional[str] = None  # Inbound / Outbound / Partner-led / Consultant-led
    strategic_relevance: Optional[str] = None      # High / Medium / Low
    relationship_strength: Optional[str] = None    # Strong / Medium / Weak

    # ===== Stage 2 — Active Discussion =====
    solution_scope: Optional[str] = None
    expected_timeline: Optional[str] = None
    competitors: Optional[str] = None
    stakeholders: List[str] = []  # legacy list of emails
    decision_maker_name: Optional[str] = None
    decision_maker_designation: Optional[str] = None
    influencer_contact: Optional[str] = None
    procurement_contact: Optional[str] = None
    finance_contact: Optional[str] = None
    is_rfp_available: Optional[bool] = False
    rfp_number: Optional[str] = None
    competitor_involved: Optional[bool] = False
    key_competitors: Optional[str] = None
    customer_budget_approved: Optional[bool] = False
    customer_funding_confirmed: Optional[bool] = False
    last_interaction_date: Optional[str] = None
    next_action: Optional[str] = ""
    next_action_owner: Optional[str] = None
    next_followup_date: Optional[str] = None
    estimated_deal_value: float = 0.0
    probability_pct: float = 0.0

    # ===== Stage 3 — Proposal Submitted =====
    proposal_value: float = 0.0
    proposal_submitted_on: Optional[str] = None
    proposal_validity: Optional[str] = None
    proposal_notes: Optional[str] = ""
    acv: float = 0.0  # Annual Contract Value
    tcv: float = 0.0  # Total Contract Value
    one_time_revenue: float = 0.0
    recurring_revenue: float = 0.0
    expected_gross_margin_pct: float = 0.0
    expected_capex: float = 0.0
    expected_tp_opex: float = 0.0
    expected_resource_cost: float = 0.0
    payment_terms: Optional[str] = ""
    contract_duration: Optional[str] = None
    revenue_start_date: Optional[str] = None
    expected_closure_date: Optional[str] = None
    expected_go_live_date: Optional[str] = None
    forecast_category: Optional[str] = None  # Commit / Best Case / Pipeline / Upside
    commercial_submitted_date: Optional[str] = None
    deal_qualification_score: Optional[float] = None

    # ===== Stage 4 — Evaluation / Negotiation =====
    negotiated_value: float = 0.0
    estimated_margin_pct: float = 0.0
    expected_decision_date: Optional[str] = None
    negotiation_notes: Optional[str] = ""
    poc_required: Optional[bool] = False
    poc_status: Optional[str] = None
    technical_evaluation_status: Optional[str] = None
    legal_review_status: Optional[str] = None
    procurement_status: Optional[str] = None
    approval_tracking_status: Optional[str] = None

    # ===== Stage 5 — Closed =====
    outcome: Literal["Open", "Won", "Lost", "Deferred"] = "Open"
    closure_date: Optional[str] = None
    win_loss_reason: Optional[str] = ""
    won_against_competitor: Optional[str] = None
    contract_signed_date: Optional[str] = None
    customer_po_number: Optional[str] = None
    contract_id: Optional[str] = None
    billing_frequency: Optional[str] = None  # Recurring / Milestone / Hybrid
    final_commercial_value: float = 0.0
    final_revenue_start_date: Optional[str] = None
    final_go_live_date: Optional[str] = None
    lessons_learned: Optional[str] = ""
    competitor_won_against_us: Optional[str] = None
    expected_revisit_date: Optional[str] = None
    closed_milestones: List[Dict[str, Any]] = []  # parsed from PDF/Excel + manual edit

    # ===== Management flags & meta =====
    business_category: Optional[str] = "Non-GMR"  # GMR / Non-GMR
    priority: Optional[str] = "Medium"
    md_review_required: bool = False
    cfo_review_required: bool = False
    ceo_visibility: bool = False
    strategic_deal: bool = False
    remarks: Optional[str] = ""


class PipelineOut(PipelineIn):
    id: str
    current_stage: str = "Prospecting"
    handoff_status: str = "Not Applicable"  # Not Applicable / Pending Finance / Approved / Rejected
    handoff_project_id: Optional[str] = None
    handoff_requested_by: Optional[str] = None
    handoff_requested_at: Optional[str] = None
    handoff_actioned_by: Optional[str] = None
    handoff_actioned_at: Optional[str] = None
    handoff_comment: Optional[str] = ""
    created_at: str
    updated_at: str
    created_by: Optional[str] = None


class PipelineStageIn(BaseModel):
    target_stage: Literal[
        "Prospecting", "Active Discussion", "Proposal Submitted",
        "Evaluation/Negotiation", "Closed",
    ]
    reason: Optional[str] = ""


class PipelineHandoffAction(BaseModel):
    action: Literal["approve", "reject"]
    comment: Optional[str] = ""



# ---------- WBS ELEMENT (SAP-style master) ----------
# Header order from BRD (20 columns):
# Project definition | WBS element | Name | Original Budget | Total PO Value |
# Open PO Value | Balance Budget | Level | Acct asst elem.ind. | Company code |
# Currency | Description | Object Class | Person responsible | Plant |
# Profit center | Short ID | Status | Cost Center | Controlling area
class WBSElementIn(BaseModel):
    project_definition: Optional[str] = None
    wbs_element: str
    name: Optional[str] = None
    original_budget: float = 0.0
    total_po_value: float = 0.0
    open_po_value: float = 0.0
    balance_budget: float = 0.0
    level: Optional[str] = None
    acct_asst_elem_ind: Optional[str] = None  # "Acct asst elem.ind."
    company_code: Optional[str] = None
    currency: Optional[str] = "INR"
    description: Optional[str] = None
    object_class: Optional[str] = None
    person_responsible: Optional[str] = None
    plant: Optional[str] = None
    profit_center: Optional[str] = None
    short_id: Optional[str] = None
    status: Optional[str] = None
    cost_center: Optional[str] = None
    controlling_area: Optional[str] = None


class WBSElementOut(WBSElementIn):
    id: str
    created_at: str
    updated_at: Optional[str] = None



# ============================================================
# CHANGE REQUEST  (dedicated entity — separate from Projects)
# ============================================================
CR_STATUS = Literal[
    "draft", "submitted", "wbs_pending", "wbs_approved",
    "approved", "rejected", "completed",
]

CR_AIRPORTS = ["DIAL", "GHIAL", "GGIAL", "GVIAL", "Other"]


class CRResourceLine(BaseModel):
    resource_count: int = 1
    mandays: float = 0.0   # 0 allowed; assumption banner in UI: 250 mandays/year
    grade: Optional[str] = None
    amount: float = 0.0    # mandatory (>= 0)
    free_text: Optional[str] = None


class CRMilestone(BaseModel):
    date: Optional[str] = None        # ISO or DD-MM-YYYY
    billing_amount: float = 0.0
    notes: Optional[str] = None


class ChangeRequestIn(BaseModel):
    cr_name: str
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    airport_name: Optional[str] = None     # DIAL / GHIAL / GGIAL / GVIAL / Other
    wbs_element: str                       # WSIN required
    # Customer PO
    po_received: bool = False
    customer_po_number: Optional[str] = None
    po_value: float = 0.0
    po_issue_date: Optional[str] = None
    po_from_date: Optional[str] = None
    po_to_date: Optional[str] = None
    # Budgeted cost
    vendor_cost: float = 0.0
    vendor_cost_remarks: Optional[str] = None
    resource_lines: List[CRResourceLine] = []
    resource_cost_remarks: Optional[str] = None
    # Justification when margin < 25%
    business_justification: Optional[str] = None
    # Payment terms
    customer_payment_terms: Optional[str] = None
    vendor_payment_terms: Optional[str] = None
    # PBG / LD
    pbg_ld_required: bool = False
    pbg_ld_details: Optional[str] = None
    # Milestones
    milestones: List[CRMilestone] = []
    # Visibility and people
    assignees_to: List[str] = []   # employee ids
    assignees_cc: List[str] = []
    # Auto-fields
    currency: str = "INR"


class ChangeRequestOut(ChangeRequestIn):
    id: str
    cr_number: str
    status: str = "draft"
    created_by_user_id: Optional[str] = None
    created_by_employee_no: Optional[str] = None
    created_by_name: Optional[str] = None
    submitted_at: Optional[str] = None
    wbs_approved: bool = False
    wbs_approved_by: Optional[str] = None
    wbs_approved_at: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    rejected_reason: Optional[str] = None
    estimated_total_cost: float = 0.0
    estimated_resource_cost: float = 0.0
    estimated_margin_pct: float = 0.0
    estimated_margin_amount: float = 0.0
    approver_emails: List[str] = []
    approver_role: Optional[str] = None
    approver_rule_name: Optional[str] = None
    # Attachment summaries
    attachment_count: int = 0
    customer_po_attachment_id: Optional[str] = None
    vendor_cost_attachment_id: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


class CRAttachmentOut(BaseModel):
    id: str
    kind: str   # customer_po | vendor_cost | resource_cost | other
    filename: str
    size: int
    mime: Optional[str] = None
    uploaded_by: Optional[str] = None
    uploaded_at: str


# ============================================================
# IN-APP NOTIFICATIONS  (bell icon)
# ============================================================
class InAppNotificationOut(BaseModel):
    id: str
    user_id: str
    kind: str        # cr_submitted | cr_wbs_pending | cr_wbs_approved | cr_approved | cr_rejected | assigned
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    read: bool = False
    created_at: str
