# CRacker Pro – Product Requirements Document (PRD)

## Original Problem Statement
Build an enterprise-grade Business Finance webportal ("CRacker Pro") for managing the project commercial lifecycle (Pipeline → Deal P&L → Customer PO → Operations → Closure). Replace fragile Excel-based tracking with audit-tracked workflows, configurable approvals, master data management, and a real-time finance dashboard. Source: User-provided BRD + Revenue & Expenses master.

Feb 2026 update: implement BRD "Webpage BRD - Development Plan 30th April 2026" — Pipeline module + Navigation/Space optimisation.

## User Choices (locked-in)
- Stack: React + FastAPI + MongoDB
- Auth: JWT, admin-managed users (no OTP)
- Theme: premium dark+gold/alabaster (Cabinet Grotesk + Work Sans + JetBrains Mono)
- Email: skipped in MVP (in-app only)
- BRD (Apr 2026): tabbed stage-wise wizard, `*` markers without blocking validation, finance OR admin approves Closed-Won handoff, BRD default field set per stage.

## User Personas
Admin · Finance · Sales/Delivery · Leadership (CFO/CEO/COO) · Approver

## Implementation Status

### Phase 1 — Jan 2026 ✅
JWT auth, brute-force lockout, admin user mgmt, 6 master data CRUD + audit trail, Project CRUD with auto margin, 5-stage workflow engine, Approval Matrix engine, Excel upload, Dashboard, Audit trail.

### Phase 2 — Jan 2026 ✅
Pencil edit on Projects list, Finance Query discussion engine, Customer Profile aggregator, Project Document attachments with PDF auto-parse.

### Phase 3 Iteration 3 — Feb 2026 ✅
PDF auto-parse in New/Edit Project modal (Customer vs Vendor PO), Royal Purple theme, Microsoft Graph email placeholders.

### Phase 3 Iteration 4 — Feb 2026 ✅
Unified SAP Excel uploader (4-sheet workbook), Excel autofill, Project Detail crash fix, admin Delete Project, Customer delete guard, clickable Revenue/Cost tiles.

### Phase 3 Iteration 5 — Feb 2026 ✅
Undo last SAP import, Aviation visual identity (airplane CTA + tricolor stripe + watermark).

### Phase 4 Iteration 6 — Feb 2026 ✅ — Pipeline + Navigation BRD
- **Pipeline module (5-stage opportunity funnel)** — `Pipeline` model + `/api/pipeline` CRUD + `/api/pipeline/summary` + `/api/pipeline/{id}/advance` + `/api/pipeline/{id}/close?outcome=Won|Lost` + `/api/pipeline/{id}/approve-handoff`. Stages: Prospecting → Active Discussion → Proposal Submitted → Evaluation/Negotiation → Closed.
- **Finance Approval Gate** — Closed-Won sets `handoff_status='Pending Finance'`. Finance OR Admin can approve → auto-creates a Project stub.
- **Tabbed stage-wise wizard** (`PipelineWizardModal`) with progressive disclosure. `*` markers visible on mandatory fields but no validation blocks save.
- **Collapsible sidebar** — icons-only mode with tooltips; persists across reload.
- **Navigation rename + add** — Customers → Customer Profile, Pipeline + Change Requests.
- **Dashboard updates** — "Recognized Revenue" → "Revenue"; Top 10 Suppliers; colored management flag badges.
- **Document upload requires mandatory `name`**.
- **Enriched Customer Profile** — industry, sector, addresses, secondary contact, website, account owner.
- **Project Form `*` markers** on mandatory fields.
- 16/16 pytest pipeline tests passing (`test_pipeline_iter6.py`).

### Phase 4 Iteration 10 — Feb 2026 ✅ — Change Requests Wave 1 (Backend) + Wave 2 (Frontend)
- **Dedicated `ChangeRequest` entity** (separate from Projects) with `cr_number` auto-gen, status flow (`draft → submitted → wbs_pending → wbs_approved → approved/rejected`), per-row vendor cost (single total) + resource cost lines (count/mandays/grade/amount), milestones, customer/vendor payment terms, PBG/LD details, assignees-to/CC.
- **Approval Matrix `applies_to` field** (`project | change_request | both`) — CR auto-resolves the narrowest matching rule and stamps `approver_emails` / `approver_role` on save.
- **Backend endpoints** — `GET/POST/PUT/DELETE /api/change-requests`, `/submit`, `/approve-wbs` (finance/admin only), `/approve`, `/reject`, `/metrics`, `/attachments` (upload customer_po/vendor_cost/resource_cost PDFs up to 25 MB).
- **In-app notifications** — `notifications_inapp` collection + `/api/notifications/in-app` (list/count/mark-read/mark-all-read). Auto-fired on CR submit (→ finance + approvers + assignees), WBS approve (→ creator + assignees), approve/reject.
- **Frontend** —
  - Rebuilt `ChangeRequestsPage.jsx` with 4 metric chips (Count / PO Value / Cost / Avg Margin %), unified filter row (search + status dropdown + date range), table with approver column, status badges, and **Approve WBS** action shown to Finance/Admin on `wbs_pending` rows.
  - New `CRFormModal.jsx` — full detailed form: CR name, airport, customer (search + inline create), WBS, Customer PO (number/value/date/period/PDF attachment), Budgeted Cost (single vendor amount + resource lines with 250 mandays/year assumption banner), live margin calculator tiles, **business-justification textarea auto-required when margin < 25 %**, payment terms, PBG/LD, milestones, assignees To/CC, **live approver preview from Approval Matrix**.
  - `CustomerQuickAddModal.jsx` — reuses the full Customer Master field set for inline customer creation from the CR form.
  - `NotificationBell.jsx` — topbar bell with unread badge, dropdown list, click-to-navigate, mark-all-read; polls `/api/notifications/in-app/count` every 30 s.

### Phase 4 Iteration 9 — Feb 2026 ✅ — Employee-as-User unification, Settings tabs, WBS rebuild
- **Employee master = single source of truth for users.** Two new fields — `Password` and `Workspace Role` — are first-class columns on Employees (UI + Excel template). On create / update / bulk-upload, the employee record is mirrored into the `users` collection (system role = `admin` for permanent admins, else `finance`; workspace `role_id` is set from the chosen role). Permanent admins keep their fixed passwords regardless of input.
- **User Management page removed.** `/admin/users` now redirects to `/employees`. Backend `/api/admin/users` is preserved for the legacy `admin@crackerpro.com` seeded user only.
- **Settings page rebuilt with 4 tabs** — `Roles · Approval Matrix · Currency · Appearance`. Active tab is preserved via the `?tab=` query param. `RolesPage` and `ApprovalMatrixPage` accept an `embedded` prop and render inline without their own PageHeader. `/admin/roles` and `/admin/approval-matrix` redirect into the corresponding Settings tab.
- **WBS and Budget rebuild** —
  - 20-column SAP-style WBS master (`/api/wbs` CRUD + `/api/wbs/template` + `/api/wbs/bulk-upload`).
  - 2 sub-tabs: **Find WBS** (11 cols) and **See Budget** (12 cols + currency-formatted numbers).
  - **4 Excel-style column filters** (WBS Element / Description / Person Responsible / Short ID) — each filter chip has a column-specific HSL hue, supports an internal search box, `Enter` selects all matching options, `Select all (filtered)` and `Clear` actions. Multiple selections are AND-combined across filter columns.
  - **Quick global search** input at the right of the chip row (small, h-8).
  - **Stat chips downsized** (compact 2.5 px-y-1 height); on the See-Budget tab they show Original Budget / Total PO / Open PO / Balance summed over the filtered set.
  - Admin-only Upload modal (append/replace) + Template download.

### Phase 4 Iteration 8 — Feb 2026 ✅ — RBAC + Admin section lockdown
- **Permanent Admin accounts** seeded — `rohit.kataria@waisldigital.com` / `RKataria@121` and `tushar.sukhija@waisldigital.com` / `TSukhija@121`. `is_permanent_admin` flag blocks demote / deactivate / password-reset.
- **Roles & Permissions** — full CRUD at `/api/roles` (admin-only writes). New `RolesPage.jsx` admin UI: matrix of 6 workspace sections × {View, Edit}; Delete is permanently locked as ADMIN ONLY. Edit toggle auto-enables View; unchecking View auto-disables Edit.
- **`/api/me/permissions`** — returns is_admin flag + per-section can_view / can_edit / can_delete. Non-admin users always get can_delete=false regardless of role payload.
- **Workspace routing gated** by `SectionProtected` wrapper on Dashboard / Pipeline / Projects / Change Requests / Customer Profile / WBS-Budget routes. Sidebar items filtered by `can_view`.
- **Administration section locked to admin role** — Approvals, Suppliers, Employees, Excel Upload, Audit Trail, Approval Matrix, User Management, Roles, Settings now visible only when `user.role==='admin'`.
- **AdminUsersPage** lets admins assign a workspace role (`role_id`) to non-admin users; permanent admins shown with lock icon and cannot be modified.
- **Employee master + bulk uploader** match BRD spec; replace-mode preserves permanent admin employees.
- All 7 RBAC backend test categories pass (deep_testing_backend_v2).

### Phase 4 Iteration 7 — Feb 2026 ✅ — BRD Phase 3 + Phase 4 (full schema + Dashboard rebuild)
- **Pipeline schema expansion** — full BRD field set per stage (~50+ new fields): `opportunity_id` auto-generated (`OPP-YYYY-NNNNNN`), `opportunity_category` (Project/Change Request), `opportunity_type`, `solution_line`, `business_need`, `nature_of_work`, `lead_source`, `opportunity_source_type`, `strategic_relevance`, `relationship_strength`, decision-maker stakeholders (decision_maker_name/designation, influencer/procurement/finance contacts), `is_rfp_available`, `rfp_number`, `competitor_involved`, `key_competitors`, `customer_budget_approved`, `customer_funding_confirmed`, `last_interaction_date`, `next_action`/`next_action_owner`/`next_followup_date`, `estimated_deal_value`, `probability_pct`, `acv`, `tcv`, `one_time_revenue`, `recurring_revenue`, `expected_gross_margin_pct`, `expected_capex`, `expected_tp_opex`, `expected_resource_cost`, `payment_terms`, `contract_duration`, `revenue_start_date`, `expected_closure_date`, `expected_go_live_date`, `forecast_category`, `commercial_submitted_date`, `deal_qualification_score`, `poc_required`/`poc_status`, technical/legal/procurement/approval-tracking statuses, **Closed sub-status: Won/Lost/Deferred**, `customer_po_number`, `contract_id`, `contract_signed_date`, `billing_frequency`, `final_commercial_value`, `final_revenue_start_date`, `final_go_live_date`, `lessons_learned`, `competitor_won_against_us`, `expected_revisit_date`, `closed_milestones`.
- **Stage Movement Validation Popup** — soft checklist when advancing stages; "Stay & Fill" or "Proceed Anyway" (does NOT block).
- **Currency dropdown** — USD default + INR/AED/AUD/CNY/EUR/GBP/JPY/RUB/SAR/SGD.
- **Management Review Flags** on Pipeline AND Project — `md_review_required`, `cfo_review_required`, `ceo_visibility`, `strategic_deal`. Visible as colored badges on lists, toggles in Project/Pipeline forms.
- **Closed-Won → Project enriched handoff** — `final_commercial_value` priority for po_value; copies `pipeline_id`, all mgmt flags, `finance_spoc_email = pipeline.finance_contact`, `customer_po_number`, `contract_signed_date`, milestones. **Routes Change Request opportunities to `/change-requests`** by setting `category1='Change Request'`.
- **Customer Master enrichment** — `parent_group`, `state`, `region`, `domestic_international`, `business_category` (GMR/Non-GMR), `primary_designation`/`primary_department`, `addresses[]` (CustomerAddress), `additional_contacts[]` (CustomerContact).
- **Project list column renames** — Recog. Revenue → Revenue, Booked Cost → Cost, Business Case Margin% → Deal Margin %; Projects page now excludes Change Requests; date-range filter; Mgmt-flag badges in Flags column.
- **Project Detail Overview** enriched with Pipeline Origin tile + Mgmt Flags strip when project came from a pipeline.
- **WBS and Budget** menu item + page (placeholder, lists WBS-element-level budget vs actuals).
- **Date filter** on Pipeline / Projects / Change Requests pages.
- **Dashboard rebuild** — cascading filter grid (Section / Customer multi / Project-WBS multi / GMR-NonGMR / Date Range / Clear all). Customer multi-select narrows Project options. New `Delayed Milestones` table replaces "Delayed Projects" (shows project, due date, days overdue, value).
- **App rename** — "WAISL · COLM" sidebar brand; "WAISL · Customer Order Lifecycle Management" topbar tagline; HTML title + Login page updated.
- **Sidebar layout** — sticky-positioned (independent scroll); Administration section visible to all roles with admin-only items hidden from non-admin.
- **Backend backfill** — on_startup auto-fills `opportunity_id` for legacy rows + removes empty pipelines.
- 14/14 pytest backend tests passing (`test_pipeline_iter7.py`). Frontend cascading filter + WBS + branding + wizard sections + validation popup verified via Playwright.

## Backlog / Future Phases

### P1 (next)
- Pipeline Kanban board view (drag-drop between stages)
- Convert `PUT /api/pipeline/{id}` to partial update (exclude_unset=True) — minor UX hardening
- Email notifications on Pipeline stage changes / handoff requests (Microsoft Graph already wired)
- Customer Profile: PO history & contracts upload
- Split Projects into "Active Projects" vs "Change Requests" at model-level (currently heuristic filter)
- Bulk approve/reject in approvals queue

### P2
- Dashboard advanced cascading filters + date range
- AI Margin Risk Radar (Emergent LLM key) — narrative briefing
- Forecasting (revenue/cost)
- Refactor `server.py` (~1800 lines) into `/app/backend/routes/` modules

### P3
- SAP API integration (live sync)
- Mobile-responsive layout
- Document storage on S3 / GridFS

## Test Credentials
See `/app/memory/test_credentials.md` — admin@crackerpro.com / Admin@123 (idempotent seed).

## Key Files
- Backend: `/app/backend/{server,auth,models,services,excel_utils,pdf_parser,sap_parser,notifications}.py`
- Frontend: `/app/frontend/src/{App.js, lib/, components/, pages/}` — incl. `PipelineWizardModal.jsx`, `PipelinePage.jsx`, `ChangeRequestsPage.jsx`
- Design: `/app/design_guidelines.json`
- Tests: `/app/backend/tests/test_pipeline_iter6.py` (+ earlier iter test suites)
