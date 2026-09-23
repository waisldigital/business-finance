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
