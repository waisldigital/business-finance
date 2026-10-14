"""One-off: copy files saved on local disk by earlier builds into the configured file storage (GridFS).

Project documents (``storage_path``) and CR attachments (``_path``) without a ``storage_key`` are read from
disk, saved to storage and given a key; the disk copy is left in place. Files that are no longer on disk are
listed so they can be re-uploaded.

    cd backend && MONGO_URL=... DB_NAME=crackerpro python scripts/migrate_uploads_to_gridfs.py [--dry-run]
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from storage import make_storage  # noqa: E402


async def main(dry_run: bool):
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    kw = {}
    if os.environ["MONGO_URL"].startswith("mongodb+srv://"):
        import certifi
        kw["tlsCAFile"] = certifi.where()
    db = AsyncIOMotorClient(os.environ["MONGO_URL"], **kw)[os.environ.get("DB_NAME", "crackerpro")]
    store = make_storage(db)
    moved, missing = 0, []
    jobs = [("documents", "storage_path", lambda d: f"documents/{d['id']}/{d.get('file_name') or 'file'}", "content_type"),
            ("cr_attachments", "_path", lambda d: f"cr/{d['cr_id']}/{d['id']}_{d.get('filename') or 'file'}", "mime")]
    for coll, path_field, key_of, type_field in jobs:
        async for d in db[coll].find({path_field: {"$exists": True, "$ne": None}, "storage_key": {"$exists": False}}):
            p = Path(d[path_field])
            if not p.exists():
                missing.append(f"{coll} {d.get('id')}: {p}")
                continue
            key = key_of(d)
            if not dry_run:
                await store.save(key, p.read_bytes(), d.get(type_field))
                await db[coll].update_one({"_id": d["_id"]}, {"$set": {"storage_key": key}})
            moved += 1
    print(f"{'would move' if dry_run else 'moved'} {moved} file(s); {len(missing)} missing on disk")
    for m in missing:
        print("  missing:", m)


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
