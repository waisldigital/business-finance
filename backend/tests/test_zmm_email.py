"""Scheduled e-mail fetch of the ZMM (test 12): the same message twice → one run; an older snapshot is skipped;
a failure is logged and notified (Graph mocked)."""
import asyncio
from datetime import datetime

from test_review import BASE_ZMM, zmm_book, zmm_row


class FakeMail:
    def __init__(self, messages, files, fail=False):
        self.messages, self.files, self.fail = messages, files, fail

    async def list_messages(self, since, sender):
        if self.fail:
            raise RuntimeError("401 Unauthorized")
        return [m for m in self.messages if (not since or m["receivedDateTime"] > since)
                and (not sender or m["from"]["emailAddress"]["address"] == sender)]

    async def attachments(self, mid):
        return self.files[mid]


def msg(i, when, subject="ZMM PO Report"):
    return {"id": f"m{i}", "internetMessageId": f"<msg{i}@sap>", "subject": subject, "receivedDateTime": when,
            "from": {"emailAddress": {"address": "sap@waisl.in"}}}


def test_email_fetch_idempotent_older_snapshot_and_failure(client, admin):
    import server
    from aop.jobs.fetch_zmm import fetch_and_run, make_engine
    db = server.db
    engine = make_engine(db)
    notified = []

    async def notify(run):
        notified.append(run)
    cfg = {"sender": "sap@waisl.in", "subject": "zmm po report", "pattern": "*.xlsx"}
    newer = zmm_book([zmm_row(4200000001, 10, **{"Created On": datetime(2026, 9, 1)})] + BASE_ZMM[1:])
    older = zmm_book([zmm_row(4200000001, 10, **{"Created On": datetime(2026, 1, 1)})])
    mail = FakeMail([msg(1, "2030-01-01T02:00:00Z"), msg(2, "2030-01-02T02:00:00Z"), msg(3, "2030-01-03T02:00:00Z", "Other")],
                    {"m1": [{"name": "ZMM_PO_Report.xlsx", "content": newer}, {"name": "readme.pdf", "content": b"x"}],
                     "m2": [{"name": "ZMM_PO_Report_old.xlsx", "content": older}], "m3": [{"name": "x.xlsx", "content": newer}]})
    runs = asyncio.run(fetch_and_run(db, engine, mail, cfg, notify))
    assert [r["status"] for r in runs] == ["processed", "skipped"]
    assert "older snapshot" in runs[1]["error"] and runs[0]["by"] == "zmm-bot" and runs[0]["source"] == "email"
    assert len(notified) == 1
    # the same messages again → nothing new
    again = asyncio.run(fetch_and_run(db, engine, mail, cfg, notify))
    assert again == [] and len(notified) == 1
    # mailbox failure → a failed run, notified
    bad = asyncio.run(fetch_and_run(db, engine, FakeMail([], {}, fail=True), cfg, notify))
    assert bad[0]["status"] == "failed" and "Mailbox read failed" in bad[0]["error"] and notified[-1]["status"] == "failed"
    log = client.get("/api/aop/review/runs", headers=admin).json()["rows"]
    assert {"processed", "skipped", "failed"} <= {r["status"] for r in log if r.get("source") == "email"}
