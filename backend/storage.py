"""File storage for uploaded documents and attachments.

``FILE_STORAGE=gridfs`` (the default) keeps files in MongoDB GridFS (bucket ``files``) so they survive
redeploys of the web service; ``FILE_STORAGE=local`` writes them under ``UPLOAD_ROOT`` (default
``backend/uploads``) for local development and tests.

Records keep a ``storage_key``; files uploaded before this module existed only have a disk path, which
``open_legacy`` still serves (see scripts/migrate_uploads_to_gridfs.py to move them).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Tuple

ROOT = Path(__file__).parent


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("invalid storage key")
        return p

    async def save(self, key: str, data: bytes, content_type: Optional[str] = None) -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    async def open(self, key: str) -> Optional[Tuple[bytes, Optional[str]]]:
        p = self._path(key)
        return (p.read_bytes(), None) if p.exists() else None

    async def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class GridFSStorage:
    def __init__(self, db, bucket: str = "files"):
        from motor.motor_asyncio import AsyncIOMotorGridFSBucket
        self.bucket = AsyncIOMotorGridFSBucket(db, bucket_name=bucket)

    async def save(self, key: str, data: bytes, content_type: Optional[str] = None) -> str:
        await self.delete(key)  # one file per key
        await self.bucket.upload_from_stream(key, data, metadata={"content_type": content_type})
        return key

    async def open(self, key: str) -> Optional[Tuple[bytes, Optional[str]]]:
        from gridfs.errors import NoFile
        try:
            stream = await self.bucket.open_download_stream_by_name(key)
        except NoFile:
            return None
        data = await stream.read()
        return data, (stream.metadata or {}).get("content_type")

    async def delete(self, key: str) -> None:
        async for f in self.bucket.find({"filename": key}):
            await self.bucket.delete(f._id)


def make_storage(db):
    kind = (os.environ.get("FILE_STORAGE") or "gridfs").strip().lower()
    if kind == "local":
        return LocalStorage(Path(os.environ.get("UPLOAD_ROOT") or ROOT / "uploads"))
    if kind != "gridfs":
        raise RuntimeError(f"FILE_STORAGE must be 'gridfs' or 'local', not {kind!r}")
    return GridFSStorage(db)


def open_legacy(path: Optional[str]) -> Optional[bytes]:
    """Files saved to disk by earlier builds (records with a path but no storage_key)."""
    if path and Path(path).exists():
        return Path(path).read_bytes()
    return None


def delete_legacy(path: Optional[str]) -> None:
    try:
        if path:
            Path(path).unlink(missing_ok=True)
    except OSError:
        pass
