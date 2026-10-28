# Deploying WAISL FinSight — Business Finance & FP&A

> Formerly CRacker Pro / WAISL COLM. Infrastructure identifiers (Render service `crackerpro-backend`, database `crackerpro`)
> keep their original names so the live deployment and data are untouched.

| Part     | Host            | Config file            |
|----------|-----------------|------------------------|
| Database | MongoDB Atlas   | `MONGO_URL` env var    |
| Backend  | Render (FastAPI)| `render.yaml`          |
| Frontend | Vercel (React)  | `frontend/vercel.json` |

## 1. MongoDB Atlas
1. Create a cluster (M0 free tier is fine to start) and a database user.
2. **Network Access** → allow `0.0.0.0/0` (Render's outbound IPs are not static on the free plan).
3. **Connect → Drivers** → copy the `mongodb+srv://...` string. This is `MONGO_URL`.
   Collections and indexes are created automatically on first backend start, and the
   admin user plus sample data are seeded then.

## 2. Backend on Render
1. **New → Blueprint** → select this repo; Render reads `render.yaml`.
2. Fill the prompted secrets: `MONGO_URL`, `ADMIN_PASSWORD`, `CORS_ORIGINS` (your Vercel URL).
   - **CORS:** `CORS_ORIGINS` lists the frontend origins allowed to call the API with credentials
     (comma-separated, e.g. `https://business-finance-rust.vercel.app`). `*` is never accepted. If it is unset
     in production only the production Vercel URL is allowed and an error is logged.
     `CORS_ORIGIN_REGEX` admits this project's Vercel preview deployments only; the default is
     `https://business-finance-[a-z0-9-]+-waisldigital-5107\.vercel\.app`. A pattern that trusts every
     Vercel app (`https://.*\.vercel\.app`) is ignored.
   `JWT_SECRET` is generated automatically.
3. Health check: `GET /api/health` returns 200 only when Atlas is reachable.

## 3. Frontend on Vercel
1. Import the repo, set **Root Directory** to `frontend`.
2. Env var: `REACT_APP_BACKEND_URL=https://<your-render-service>.onrender.com`.

See `backend/.env.example` and `frontend/.env.example` for all variables.

## File storage
Uploaded documents (PO PDFs, project documents, CR attachments) are stored in MongoDB GridFS
(`FILE_STORAGE=gridfs`, the default), so they survive redeploys of the Render service. Files uploaded by
earlier builds to the service's disk can be copied in once with
`cd backend && python scripts/migrate_uploads_to_gridfs.py` (add `--dry-run` to preview). For local
development `FILE_STORAGE=local` keeps files under `UPLOAD_ROOT`.

## AOP module (Annual Operating Plan)

Two portals, split by path:

| Path      | Who                    | What |
|-----------|------------------------|------|
| `/admin`  | system role `admin`    | Imports, Data manager (columns, upload add/replace/modify, download), AOP approvals, P&L check, Plan settings, users/roles/audit |
| `/app`    | everyone else          | Workspace + AOP sections (P&L, Inputs, Revenue, Opex & POs, Overheads, Payroll, Capex, Review), gated by role permissions |

First-time load (admin): **Imports** → upload the consolidated AOP workbook, then the Opex forecast
workbook. Sheets and columns are located by header text, so re-arranged workbooks still import.

Access is managed in **Roles & settings**: `aop_*` sections (view / edit), `aop_payroll` is confidential
(masks resource-cost lines in the P&L), and an optional airport scope per role. Whether user edits apply
directly or wait for approval is set per section in **Plan settings**; which columns users may edit is set
per dataset in **Data manager → Columns**.

Storage: `aop_rows` (all datasets, unique `dataset + key`), `aop_actuals` (the single actual source),
`aop_dataset_meta` (columns), `aop_changes` (approval queue), `aop_history`, `aop_config`, `aop_imports`.

### Opex lines, PO mapping and the ZMM (Review)

Opex lines (`opex_lines`) and the forecast tracker (`opex_tracker`) share one column layout — the refined
`Opex_Raw Data` format (`backend/aop/opex_schema.py`) — for upload, download and the grid. The SAP ZMM PO report
is the only recurring input:

* **Manual:** Admin → Imports → *ZMM PO report*, or Review → Upload log (admins, or roles with upload on Opex).
* **E-mail:** the `finsight-zmm-fetch` Render cron job (`render.yaml`, daily 02:00 UTC = 07:30 IST) reads the
  scheduled SAP e-mail and runs the same pipeline. Set `ZMM_FETCH_ENABLED=true`, `ZMM_MAILBOX`, `ZMM_SENDER`,
  `ZMM_SUBJECT_CONTAINS` (and optionally `ZMM_ATTACHMENT_PATTERN`) plus the Graph app (`MS_TENANT_ID`,
  `MS_CLIENT_ID`, `MS_CLIENT_SECRET`). Give that app the **Mail.Read** application permission and restrict it
  to the report mailbox with an Exchange Application Access Policy
  (`New-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -PolicyScopeGroupId <mailbox> -AccessRight RestrictAccess`).
* **FX rates:** POs are converted to INR at the rate of the PO date, from Inputs → *FX rates by date*. Rates are
  fetched from the internet automatically — on every ZMM run (missing dates), by the daily cron job (last 7 days)
  and with the **Fetch rates** button — from the ECB reference rates (`api.frankfurter.dev`) and, for currencies
  the ECB doesn't publish (AED, SAR…), daily market rates (`cdn.jsdelivr.net/npm/@fawazahmed0/currency-api`).
  The backend needs outbound HTTPS to those hosts; `FX_AUTO_FETCH=false` turns it off.

Each run rebuilds the PO items, flags changes on mapped POs (held until accepted), re-resolves the PO links and
recalculates the forecast; the admins get an e-mail and an in-app notification. All human work sits in **Review**
(To map · PO changes · Corrections · Checks · Upload log), open to admins and roles with edit on Opex (or the
`aop_review` section).

One-time setup for existing data:

1. `cd backend && python scripts/migrate_opex_columns.py --dry-run`, then `--apply` (backs up `aop_rows` of both
   datasets, renames legacy keys, rewrites the column lists).
2. Admin → Imports → *Opex forecast workbook* with `Opex_Forecast`, `PO_Links`, `Line_Status` and
   `ZMM_PO_Report` sheets (lines are upserted by S. No.; rows without one are listed and skipped).
3. Work the To map backlog in Review.

## Logins

* **Admins (2):** set in Render → Environment: `ADMIN_EMAIL` / `ADMIN_PASSWORD` (admin1) and
  `ADMIN2_EMAIL` / `ADMIN2_PASSWORD` (admin2), optional `ADMIN1_NAME` / `ADMIN2_NAME`. They are
  re-applied on every start, so rotating a password = change the env var + redeploy.
* **Everyone else:** Admin portal → Users & employees → add / edit an employee with Email ID,
  an initial password and a Workspace Role (or bulk-upload the employee template with the
  Password and Roles columns). They sign in at `/login` with that email + password and land in `/app`,
  seeing only the sections their role allows.

## Monthly actuals (Admin → Imports)

One upload per source; each replaces only the months it contains and moves the actual cut-off forward.

| File | Feeds |
| --- | --- |
| MIS working file (SAP_Revenue, SAP_Expense, Mapping) | Revenue, revenue share, opex, overheads, finance cost / other income — line by line (raw-data drill-downs) |
| Resource cost file (Final Resource Cost) | Payroll cost by airport / project / department, FTE and headcount |
| Reporting package (the MIS workbook) | The plan year's P&L actuals for its closed months (every block), actual billable PAX (CUTE drivers) and the capex tracker — see below |
| Project health tracker | TCV, customer, sales owner and status on the project master |

### Reporting package: tabs read and what must not change

The package is the reconciled MIS: for the months it flags **Act** it is the actual source of every report (the SAP dump and
resource file stay as the line-level drill-downs). It replaces only its own rows for the months in the file, so re-uploading a
month-end file is safe, and it moves the actual cut-off to the last closed month. After an upload the new / linked Solutions
projects appear in **Projects** (see below), and **Admin → Imports** shows the reconciliation against the package's own P&L tab —
any month / line off by more than ₹0.05 Cr is listed there as "Differs from the package's P&L sheet".

| Tab (matched by name, case and spacing ignored) | What is read | Layout it relies on |
| --- | --- | --- |
| **Revenue Analysis** | §A CUTE revenue (airport × PAX type) · §E revenue share (location) · §B billable PAX (actual PAX → CUTE drivers) · which months are Act | Section titles contain "CUTE REVENUE", "Revenue Share" and "BILLABLE PAX COUNT"; location in column B, PAX type in column C; first 80 rows (§B within the first 60) |
| **Non Cute Full Break up** | Non-CUTE revenue by location | Rows typed "Non - CUTE" (column C), location in column D; ends at the "Total" row |
| **CR Breakup** | Change-request revenue by location | Key in column B starting "Change request", location in column E; ends at "Total" |
| **Project Summary** | Per project: Revenue, Opex and Direct Resource by month | Header row (within the first 12 rows) holds "Project Name"; the group labels two rows above start with "Revenue", "Opex" and "…Resource…"; columns headed Project ID, Project Name, WBS, Geography/Region, India/International, GMR |
| **Rev_Project_Raw data** *(optional)* | Project → reporting tag, P&L head (India / International), P&L region, WBS | Headers Project ID, For P&L Filter(Reporting Tag), P&L Head, P&L Region, WBS Code |
| **Opex & Dir Resource Airportwsie** | Opex by airport (CA "Without CR", "CR Only"), direct resource cost, shared-service allocation % | Block labels "Without CR", "CR Only", "Resource cost … Direct", "Allocation"; airport in column C; a "Shared services" row |
| **Resource Cost Raw** | Indirect resource cost + FTE (enabling → CA+CR, pursuit → Solutions), direct FTE by airport | Header row with the 12 plan-year months twice — **cost (₹ Cr) block first, FTE block second**; labels in column D: Total Direct, Operations, Total Indirect, Enabling…, Pursuit…, Total Capitalised |
| **OH Summary_Dept** | Overheads by department × segment | Segment (CA+CR / Solutions) in column D, department in column E |
| **P&L** | Depreciation, finance cost (+ prior period), other income, tax / deferred tax; and the check totals | Labels in column B ("Revenue from Operations", "O/M cost", "Employee cost", "Revenue Share", "Overheads", "EBITDA", "Depreciation", "Interest & Finance cost", "Other Income", "Tax"); first 40 rows / 20 columns |
| **CAPEX Tracker** | Capex tracker: location, project, phase, budgets, open PO / PR, monthly actuals | Header row (first 6 rows) with Location and Project / Initiative; Phase, Initial Budget, CAPEX till FY'26, AOP FY'27, Open PO, Open PR |

Do not change, in the file you upload:

* **Tab names** — a renamed or missing tab is skipped silently (its block then keeps the SAP dump / AOP phasing); the reconciliation
  against the P&L tab is where it shows up (if the P&L tab itself is renamed, there is no check).
* **The Act / Fct flag row** directly above each month header (one or two rows above), and the **month headers** (real dates or
  `YYYY-MM`). Only months flagged **Act** are loaded; flip a month to Act only once it is closed — it moves the actual cut-off.
  Keep the plan year's twelve months as adjacent columns and add no extra date headers between them.
* **The key labels and column positions** in the table above (section titles, "Total" rows that end a block, "Shared services",
  the airport names DIAL / GHIAL / GGIAL / GVIAL, department and segment names) and the **units — ₹ Crore** throughout.
* **Values, not formulas without a saved result**: the file is read for its stored values, so open it in Excel, let it recalculate
  and save before uploading. Text in a number cell is ignored.
* **The financial year**: the file must carry the app's plan year (Admin → Plan settings); months of another year are ignored.

Adding rows (a new project, airport or department) is fine as long as they sit inside the existing blocks above the "Total" row.

### Projects section

The Solutions projects in the AOP workbook (CR & project master, project revenue) and the package (Project Summary) are brought
into **Projects** automatically after the AOP workbook, package or project-health uploads (and by **Projects → Sync from AOP**).
The sync creates a project the first time, links an existing one (same AOP project id, WBS or name) and fills only fields that are
still empty — it never overwrites what a user typed. Each linked project has a **Financials** tab (AOP vs actual by month: revenue,
TP opex, direct resource cost, gross margin — same numbers as Project health and the Regional P&L), the agreement and customer PO
fields, and a **document checklist** (agreement, customer PO, LOI, deal P&L, vendor POs, SOW / SLA, billing schedule, bank
guarantee, handover certificate) to fill as the documents become available.

### Regional P&L drill-down

Double-click any figure of the Regional P&L: revenue opens the package rows behind it (with the package cell each month was read
from — re-upload the package once to record the cells), an expense opens the SAP expense dump (FBL3H lines of the MIS working file)
that the report's rules assign to that region and period, and shared overheads show the department total and the allocation
rule that turns it into the cell.

Depreciation and tax stay on the AOP phasing (tax = rate × PBT) until an actual is loaded for the month (Data manager → Actuals).
Bulk upload / download of a dataset is open to admins and to roles given "Upload (bulk)" on that section (Roles).
