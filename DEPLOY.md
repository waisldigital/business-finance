# Deploying CRacker Pro

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
   `JWT_SECRET` is generated automatically.
3. Health check: `GET /api/health` returns 200 only when Atlas is reachable.

## 3. Frontend on Vercel
1. Import the repo, set **Root Directory** to `frontend`.
2. Env var: `REACT_APP_BACKEND_URL=https://<your-render-service>.onrender.com`.

See `backend/.env.example` and `frontend/.env.example` for all variables.

## Known limitation
Uploaded documents (PO PDFs, CR attachments) are stored on the backend's local disk
(`backend/uploads`). Render's filesystem is ephemeral, so uploads are lost on redeploy
unless you attach a Render persistent disk (paid) or move file storage to Atlas GridFS / S3.

## AOP module (Annual Operating Plan)

Two portals, split by path:

| Path      | Who                    | What |
|-----------|------------------------|------|
| `/admin`  | system role `admin`    | Imports, Data manager (columns, upload add/replace/modify, download), AOP approvals, P&L check, Plan settings, users/roles/audit |
| `/app`    | everyone else          | Workspace + AOP sections (P&L, Inputs, Revenue, Opex & POs, Overheads, Payroll, Capex), gated by role permissions |

First-time load (admin): **Imports** → upload the consolidated AOP workbook, then the Opex forecast
workbook. Sheets and columns are located by header text, so re-arranged workbooks still import.

Access is managed in **Roles & settings**: `aop_*` sections (view / edit), `aop_payroll` is confidential
(masks resource-cost lines in the P&L), and an optional airport scope per role. Whether user edits apply
directly or wait for approval is set per section in **Plan settings**; which columns users may edit is set
per dataset in **Data manager → Columns**.

Storage: `aop_rows` (all datasets, unique `dataset + key`), `aop_actuals` (the single actual source),
`aop_dataset_meta` (columns), `aop_changes` (approval queue), `aop_history`, `aop_config`, `aop_imports`.
