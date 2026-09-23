# Iteration 10 — Change Request Module Rebuild — Progress Log

## Wave 1 — Backend (✅ COMPLETE)
**Status:** 10/10 backend tests passed (100%)

### Delivered
1. **ApprovalRule model** — new `applies_to` field (`project` | `change_request` | `both`). Seeded "CR Approval - Default" rule with `applies_to=change_request`. Seeding is now **idempotent by rule name**.
2. **ChangeRequest model** (dedicated entity / collection `change_requests`):
   - cr_name, customer_id, customer_name, airport_name (DIAL/GHIAL/GGIAL/GVIAL/Other)
   - wbs_element (required)
   - po_received flag + customer_po_number, po_value, po_issue_date, po_from_date, po_to_date
   - vendor_cost, vendor_cost_remarks; resource_lines (count/mandays/grade/amount/free_text); resource_cost_remarks
   - business_justification (required at submit if margin < 25%)
   - customer_payment_terms, vendor_payment_terms
   - pbg_ld_required + pbg_ld_details
   - milestones (date, billing_amount, notes)
   - assignees_to / assignees_cc (employee ids)
   - Auto-computed: estimated_resource_cost, estimated_total_cost, estimated_margin_amount, estimated_margin_pct
   - Auto-resolved: approver_emails, approver_role, approver_rule_name
   - cr_number auto-generated `CR-YYYYMM-NNNN`
   - Status flow: draft → submitted → wbs_pending → wbs_approved → approved → completed (or rejected)

3. **CR endpoints** (`/api/change-requests`):
   - GET (with filters: status, customer_id, airport, date_from, date_to)
   - GET /metrics (total_count, po_value, cost, margin, by_status, by_airport)
   - GET /{id}, POST, PUT, DELETE
   - POST /{id}/submit (validates business justification on low margin; sets status=wbs_pending or wbs_approved depending on master)
   - POST /{id}/approve-wbs (Finance/Admin only)
   - POST /{id}/approve (designated approver only — must have wbs_approved=true)
   - POST /{id}/reject {reason}
   - GET/POST/DELETE /{id}/attachments + /{id}/attachments/{att_id} (multipart upload to `/app/backend/uploads/cr/<cr_id>/`, max 25 MB)

4. **In-app notifications** (collection `notifications_inapp`, bell icon backend):
   - GET /api/notifications/in-app, /count, POST /{id}/read, /mark-all-read
   - Auto-triggered on submit (finance + approver + assignees), wbs_approve (creator + assignees), approve/reject (creator + assignees)

### Test credentials reminder
- admin@crackerpro.com / Admin@123 (legacy admin)
- rohit.kataria@waisldigital.com / RKataria@121 (permanent admin)
- tushar.sukhija@waisldigital.com / TSukhija@121 (permanent admin)

## Wave 2 — Frontend CR form + page redesign (PENDING)
- New CR Modal with conditional sections (Customer PO Yes/No), Customer dropdown w/ search + "Add new", Airport select, multi-row Resource lines, milestones, attachments, dynamic margin/approver display, conditional business-justification field
- Compact ChangeRequestsPage: remove HOME · CHANGE REQUESTS breadcrumb + subtitle; add stat chips (count, PO value, cost, margin %); compact date filter row; metrics graph
- Approved WBS button visible in CR list + Approvals page

## Wave 3 — LLM PDF parsing, Bell icon UI, polishing (PENDING)
- Switch Customer PO PDF parsing to use Emergent LLM Key (Gemini 2.0 Flash)
- Bell icon in topbar with unread counter + dropdown
- Verify assignees-cc/to notification flow end-to-end
