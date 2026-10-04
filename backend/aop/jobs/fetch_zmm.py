"""Scheduled fetch of the SAP ZMM PO report from a mailbox (Render Cron Job) → the same ZMM pipeline as the manual upload.

    python -m aop.jobs.fetch_zmm            # from backend/

Auth: the Microsoft Graph app already used for notifications (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET) with the
**Mail.Read** application permission, restricted to the report mailbox by an Exchange Application Access Policy.

Env:
    ZMM_FETCH_ENABLED        true to run (default false — the job exits without doing anything)
    ZMM_MAILBOX              mailbox that receives the scheduled SAP e-mail (e.g. sap-reports@waisl.in)
    ZMM_SENDER               only messages from this address
    ZMM_SUBJECT_CONTAINS     only messages whose subject contains this text (case-insensitive)
    ZMM_ATTACHMENT_PATTERN   attachment name pattern (default *.xlsx)
    MONGO_URL, DB_NAME       the database
    FX_AUTO_FETCH            true (default) — also refresh the last 7 days of FX rates for the PO currencies

Selection: messages received since the last processed one, from the sender, subject matching, with an attachment.
Idempotent: a message (internetMessageId) or attachment (SHA-256) already in zmm_runs is skipped; a file whose newest
"Created On" is older than the last processed snapshot is logged as "older snapshot" and skipped. Every run, failure
or skip is a zmm_runs row; processed runs and failures notify the admins (e-mail + in-app). The job acts as the system
user ``zmm-bot``.
"""
from __future__ import annotations

import asyncio
import base64
import fnmatch
import hashlib
import io
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

logger = logging.getLogger("finsight.zmm_fetch")
BOT = "zmm-bot"
GRAPH = "https://graph.microsoft.com/v1.0"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class GraphMail:
    """Minimal Graph mail reader (client-credentials token, list messages, get attachments)."""

    def __init__(self, mailbox: str):
        from notifications import GraphMailer
        self.auth = GraphMailer()
        self.mailbox = mailbox

    async def _get(self, url: str, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        import httpx
        tok, err = await self.auth._get_token()
        if err or not tok:
            raise RuntimeError(f"Graph token: {err or 'no token'}")
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.get(url, params=params, headers={"Authorization": f"Bearer {tok}"})
        if r.status_code != 200:
            raise RuntimeError(f"Graph {r.status_code}: {r.text[:300]}")
        return r.json()

    async def list_messages(self, since: Optional[str], sender: Optional[str]) -> List[Dict[str, Any]]:
        flt = ["hasAttachments eq true"]
        if since:
            flt.append(f"receivedDateTime gt {since}")
        if sender:
            flt.append(f"from/emailAddress/address eq '{sender}'")
        data = await self._get(f"{GRAPH}/users/{self.mailbox}/messages", {
            "$filter": " and ".join(flt), "$orderby": "receivedDateTime asc", "$top": "25",
            "$select": "id,subject,receivedDateTime,internetMessageId,from,hasAttachments"})
        return data.get("value", [])

    async def attachments(self, message_id: str) -> List[Dict[str, Any]]:
        data = await self._get(f"{GRAPH}/users/{self.mailbox}/messages/{message_id}/attachments")
        return [{"name": a.get("name"), "content": base64.b64decode(a["contentBytes"])}
                for a in data.get("value", []) if a.get("@odata.type", "").endswith("fileAttachment") and a.get("contentBytes")]


def make_engine(db, storage=None):
    """The OpexEngine the API uses, built without the web app (config, FX from Assumptions)."""
    from aop.po_pipeline import OpexEngine
    from aop.router import DEFAULT_CONFIG, fx_rate

    async def get_config():
        cfg = await db.aop_config.find_one({"id": "aop"}, {"_id": 0}) or {}
        for k, v in DEFAULT_CONFIG.items():
            cfg.setdefault(k, v)
        return cfg

    async def fx(cur: str):
        cfg = await get_config()
        rows = [d.get("fields") or {} async for d in db.aop_rows.find({"dataset": "assumptions"}, {"_id": 0, "fields": 1})]
        return fx_rate({"assumptions": rows}, cur, [cfg["plan_fy"], cfg["base_fy"]])

    async def bump():
        await db.aop_config.update_one({"id": "aop"}, {"$inc": {"data_version": 1}}, upsert=True)

    return OpexEngine(db, get_config, fx, storage=storage, bump=bump)


def snapshot_of(content: bytes) -> str:
    """Newest 'Created On' in the file (the report's snapshot date)."""
    import openpyxl
    from aop import po as P
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    name = next((s for s in wb.sheetnames if s.strip().lower().replace(" ", "_") == "zmm_po_report"), wb.sheetnames[0])
    _, raw = P.read_zmm([tuple(r) for r in wb[name].iter_rows(values_only=True, max_col=90)])
    return max((str(f.get("created_on") or "") for f in raw), default="")


async def log_run(engine, run: Dict[str, Any]):
    await engine.bulk_set("zmm_runs", {run["run_id"]: run}, upsert=True, by=BOT)


async def fetch_and_run(db, engine, mail, cfg: Dict[str, str], notify=None) -> List[Dict[str, Any]]:
    """One fetch: process every new matching attachment in order. Returns the zmm_runs rows written."""
    from aop.po_pipeline import notify_zmm
    notify = notify or (lambda run: notify_zmm(db, run))
    runs = [d.get("fields") or {} async for d in db.aop_rows.find({"dataset": "zmm_runs"}, {"_id": 0, "fields": 1})]
    seen_ids = {r.get("message_id") for r in runs if r.get("message_id")}
    seen_sha = {r.get("sha256") for r in runs if r.get("sha256") and r.get("status") == "processed"}
    processed = [r for r in runs if r.get("status") == "processed"]
    last_snapshot = max((r.get("snapshot") or "" for r in processed), default="")
    email_runs = [r for r in runs if r.get("source") == "email" and r.get("received_at")]
    since = max((r["received_at"] for r in email_runs), default=None)
    pattern = cfg.get("pattern") or "*.xlsx"
    subj = (cfg.get("subject") or "").lower()
    out: List[Dict[str, Any]] = []
    try:
        messages = await mail.list_messages(since, cfg.get("sender"))
    except Exception as e:  # noqa: BLE001 — a failed fetch is logged and notified like a failed run
        run = {"run_id": f"ZMM-FETCH-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}", "source": "email",
               "status": "failed", "error": f"Mailbox read failed: {e}"[:2000], "received_at": now_iso(), "processed_at": now_iso(), "by": BOT}
        await log_run(engine, run)
        await notify(run)
        return [run]
    for m in messages:
        mid = m.get("internetMessageId") or m.get("id")
        if subj and subj not in str(m.get("subject") or "").lower():
            continue
        if mid in seen_ids:
            continue
        meta = {"message_id": mid, "subject": m.get("subject"), "received_at": m.get("receivedDateTime") or now_iso(),
                "sender": ((m.get("from") or {}).get("emailAddress") or {}).get("address")}
        atts = [a for a in await mail.attachments(m["id"]) if fnmatch.fnmatch(str(a.get("name") or "").lower(), pattern.lower())]
        if not atts:
            continue
        for a in atts:
            sha = hashlib.sha256(a["content"]).hexdigest()
            base = {"run_id": f"ZMM-EMAIL-{sha[:12]}-{len(out)}", "source": "email", "file_name": a["name"], "sha256": sha,
                    "by": BOT, **meta}
            if sha in seen_sha:
                run = {**base, "status": "skipped", "error": "Same file already processed", "processed_at": now_iso()}
                await log_run(engine, run)
                out.append(run)
                continue
            try:
                snap = snapshot_of(a["content"])
            except Exception as e:  # noqa: BLE001
                run = {**base, "status": "failed", "error": str(e)[:2000], "processed_at": now_iso()}
                await log_run(engine, run)
                await notify(run)
                out.append(run)
                continue
            if last_snapshot and snap and snap < last_snapshot:
                run = {**base, "status": "skipped", "error": f"older snapshot ({snap} < {last_snapshot})", "snapshot": snap,
                       "processed_at": now_iso()}
                await log_run(engine, run)
                out.append(run)
                continue
            run = await engine.run_zmm_pipeline(a["content"], a["name"], "email", meta, by=BOT)
            await notify(run)
            out.append(run)
            seen_sha.add(sha)
            if run.get("status") == "processed":
                last_snapshot = max(last_snapshot, run.get("snapshot") or "")
        seen_ids.add(mid)
    return out


def env_cfg() -> Dict[str, str]:
    return {"mailbox": os.environ.get("ZMM_MAILBOX", ""), "sender": os.environ.get("ZMM_SENDER", ""),
            "subject": os.environ.get("ZMM_SUBJECT_CONTAINS", ""), "pattern": os.environ.get("ZMM_ATTACHMENT_PATTERN", "*.xlsx")}


async def refresh_fx(engine, days: int = 7):
    """Daily: the last week's exchange rates for the currencies on the POs (FX_AUTO_FETCH, default on)."""
    from datetime import date, timedelta
    from aop.po_pipeline import fx_auto_fetch
    if not fx_auto_fetch():
        return None
    try:
        need = await engine.po_fx_need((date.today() - timedelta(days=days)).isoformat(), date.today().isoformat())
        res = await engine.fetch_fx(need, by=BOT)
        logger.info("FX rates: %s saved %s", res["saved"], "; ".join(res["errors"]))
        return res
    except Exception as e:  # noqa: BLE001 — never block the ZMM fetch on FX
        logger.warning("FX refresh failed: %s", e)
        return None


async def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    env = Path(__file__).resolve().parents[2] / ".env"
    if env.exists():
        from dotenv import load_dotenv
        load_dotenv(env)
    from motor.motor_asyncio import AsyncIOMotorClient
    from storage import make_storage
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    engine = make_engine(db, make_storage(db))
    await refresh_fx(engine)
    if os.environ.get("ZMM_FETCH_ENABLED", "false").strip().lower() not in ("1", "true", "yes", "on"):
        logger.info("ZMM_FETCH_ENABLED is off — nothing more to do")
        return 0
    cfg = env_cfg()
    if not cfg["mailbox"]:
        logger.error("ZMM_MAILBOX is not set")
        return 2
    runs = await fetch_and_run(db, engine, GraphMail(cfg["mailbox"]), cfg)
    for r in runs:
        logger.info("%s %s %s %s", r.get("run_id"), r.get("status"), r.get("file_name"), r.get("error") or "")
    if not runs:
        logger.info("No new ZMM e-mail")
    return 1 if any(r.get("status") == "failed" for r in runs) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
