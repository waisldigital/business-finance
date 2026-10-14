# WAISL FinSight — Business Finance & FP&A

Internal finance portal for WAISL (airport IT services): deal P&L, sales pipeline, projects and stage gates,
change requests (CRs), WBS budgets, the Annual Operating Plan (AOP) and monthly MIS reporting — on a single
actual source loaded from SAP and the finance workbooks.

## Architecture

```
 Browser ── React SPA (Vercel) ──HTTPS/JSON──▶ FastAPI (Render) ──Motor──▶ MongoDB Atlas
            frontend/                           backend/                    collections + GridFS (uploads)

 frontend/src
   App.js                 routes; workspace routes generated from config/sections.js
   config/                sections.js (the section registry), stages.js
   components/            AppLayout (sidebar, top bar), dialogs, common/ (Modal, Popover, StatTile, …)
   pages/                 workspace (/app/*) and admin (/admin/*) screens
   aop/                   AOP & MIS: datasets grid, report formats, pivot/grid view state
   lib/                   api (axios + session refresh), auth, permissions, currency, useApi, …

 backend
   server.py              FastAPI app: auth, roles, masters, projects, pipeline, CRs, WBS, approvals,
                          dashboard, uploads, notifications (mounted under /api)
   permissions.py         resolve_permissions / require_section — one resolver for every route
   sections.py            the permission sections (mirrors frontend/src/config/sections.js)
   storage.py             file storage (GridFS or local disk)
   aop/                   AOP module (/api/aop): datasets, importers, P&L engine, MIS reports
   tests/                 pytest (in-process against an in-memory MongoDB)
```

Two portals: `/app/*` is the user workspace, gated by the role's section permissions (enforced by the API as
well as the UI); `/admin/*` is for system admins (configured by environment variables).

## Local setup

**Backend** (Python 3.11)

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # set MONGO_URL (local mongod or Atlas), JWT_SECRET, ADMIN1_* ; FILE_STORAGE=local
uvicorn server:app --reload --port 8001
```

**Frontend** (Node 20, Yarn 1)

```bash
cd frontend
yarn install
echo "REACT_APP_BACKEND_URL=http://localhost:8001" > .env
yarn start                    # http://localhost:3000
```

Set `CORS_ORIGINS=http://localhost:3000` in `backend/.env` for local development.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | backend | MongoDB connection (`DB_NAME` stays `crackerpro` in production) |
| `JWT_SECRET` | backend | Token signing key (long random value) |
| `ADMIN1_EMAIL` / `ADMIN1_PASSWORD` / `ADMIN1_NAME`, `ADMIN2_*` | backend | The system admins (source of truth; re-applied at start-up) |
| `CORS_ORIGINS`, `CORS_ORIGIN_REGEX` | backend | Allowed frontend origins; previews of this Vercel project only |
| `FILE_STORAGE` (`gridfs` \| `local`), `UPLOAD_ROOT` | backend | Where uploaded files are kept |
| `NOTIFY_ENABLED`, `MS_*` | backend | Optional Microsoft Graph e-mail notifications |
| `REACT_APP_BACKEND_URL` | frontend | Public URL of the backend |

See `backend/.env.example`, `frontend/.env.example` and **[DEPLOY.md](DEPLOY.md)** for hosting (Atlas, Render,
Vercel), the monthly actuals imports and the AOP module.

## Tests and checks

```bash
cd backend && python -m pytest tests      # in-process suite (no server or database needed)
cd backend && python -m pyflakes .
cd frontend && CI=true yarn build         # production build; lint warnings fail it
```

The older live-server suites in `backend/tests` (`test_core.py`, `test_phase*.py`, `test_pipeline_*.py`,
`test_sap_*.py`) run only when `REACT_APP_BACKEND_URL` points at a running deployment.
