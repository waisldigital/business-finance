"""One-off: move opex_lines and opex_tracker onto the one Opex line layout (aop/opex_schema.py).

    python scripts/migrate_opex_columns.py --dry-run     # report only
    python scripts/migrate_opex_columns.py --apply       # back up, rename, drop, rewrite column meta

Steps:
  1. back up aop_rows of both datasets into aop_rows_backup_<yyyymmdd>
  2. rename legacy keys to canonical (old_po / po_ref → po, reporting_tag → tag when tag is empty,
     vendor_name_override → vendor, nature_of_expense_2 → nature_of_expense, budget_plan → B<plan>__annual,
     owner_name → owner)
  3. drop keys not in the schema (A/B/F version keys, line_id and the hidden savings fields are kept)
  4. rewrite aop_dataset_meta.columns for both datasets from the schema (admin-added custom columns kept)
  5. print the before / after column count and the dropped keys

Reads MONGO_URL and DB_NAME from the environment (backend/.env is loaded when present).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aop import opex_schema  # noqa: E402

DATASETS = ("opex_lines", "opex_tracker")


async def migrate(db, apply: bool) -> dict:
    cfg = await db.aop_config.find_one({"id": "aop"}, {"_id": 0}) or {}
    cfg.setdefault("base_fy", "FY26")
    cfg.setdefault("plan_fy", "FY27")
    cfg.setdefault("cutoffs", {"default": "2025-12"})
    report = {}
    backup = f"aop_rows_backup_{date.today().strftime('%Y%m%d')}"
    for ds in DATASETS:
        docs = [d async for d in db.aop_rows.find({"dataset": ds})]
        before = Counter(k for d in docs for k in (d.get("fields") or {}))
        dropped: Counter = Counter()
        updates = []
        for d in docs:
            new, drop = opex_schema.migrate_fields(d.get("fields") or {}, ds, cfg)
            dropped.update(drop)
            if new != d.get("fields"):
                updates.append((d["_id"], new))
        after = Counter(k for _, f in updates for k in f) if updates else before
        meta = await db.aop_dataset_meta.find_one({"dataset": ds}, {"_id": 0}) or {}
        cols = opex_schema.meta_columns(ds, cfg, meta.get("columns") or [])
        report[ds] = {"rows": len(docs), "rows_changed": len(updates), "columns_before": len(before),
                      "columns_after": len(after), "dropped_keys": sorted(dropped), "meta_columns": len(cols)}
        if apply and docs:
            await db[backup].insert_many([dict(d) for d in docs])
            for _id, f in updates:
                await db.aop_rows.update_one({"_id": _id}, {"$set": {"fields": f}})
            await db.aop_dataset_meta.update_one({"dataset": ds}, {"$set": {"columns": cols}}, upsert=True)
    if apply:
        await db.aop_config.update_one({"id": "aop"}, {"$inc": {"data_version": 1}}, upsert=True)
    report["backup"] = backup if apply else None
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        from dotenv import load_dotenv
        load_dotenv(env)
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    rep = asyncio.run(migrate(db, args.apply))
    for ds in DATASETS:
        r = rep[ds]
        print(f"{ds}: {r['rows']} rows, {r['rows_changed']} changed; columns {r['columns_before']} → {r['columns_after']} "
              f"(meta {r['meta_columns']})")
        if r["dropped_keys"]:
            print(f"  dropped keys ({len(r['dropped_keys'])}): {', '.join(r['dropped_keys'])}")
    print(f"backup: {rep['backup']}" if rep["backup"] else "dry run — nothing written")


if __name__ == "__main__":
    main()
