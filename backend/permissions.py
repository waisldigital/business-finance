"""Workspace permissions — one resolver for the whole backend.

A user's rights come from their role's per-section permissions ({can_view, can_edit, can_upload, can_delete}).
System admins pass every check. A user without a role may view the dashboard only. Delete is never granted
to a custom role; it stays with admins.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, Literal, Union

from fastapi import Depends, HTTPException

from models import WORKSPACE_SECTIONS

Action = Literal["view", "edit", "upload", "delete"]
FLAG = {"view": "can_view", "edit": "can_edit", "upload": "can_upload", "delete": "can_delete"}


def normalize_role_permissions(raw: Dict[str, Any]) -> Dict[str, Dict[str, bool]]:
    """Clean a role's permissions as posted by the roles editor: known sections only; upload implies view."""
    out: Dict[str, Dict[str, bool]] = {}
    for k, v in (raw or {}).items():
        if k not in WORKSPACE_SECTIONS:
            continue
        get = (lambda f: getattr(v, f, False)) if not isinstance(v, dict) else (lambda f: v.get(f, False))
        out[k] = {"can_view": bool(get("can_view")) or bool(get("can_upload")), "can_edit": bool(get("can_edit")),
                  "can_upload": bool(get("can_upload"))}
    return out


def _empty() -> Dict[str, bool]:
    return {"can_view": False, "can_edit": False, "can_upload": False, "can_delete": False}


async def resolve_permissions(db, user: dict) -> Dict[str, Any]:
    """{"is_admin", "is_permanent_admin", "permissions": {section: flags}, "role": role document or None}."""
    if user.get("role") == "admin":
        flags = {"can_view": True, "can_edit": True, "can_upload": True, "can_delete": True}
        return {"is_admin": True, "is_permanent_admin": bool(user.get("is_permanent_admin")),
                "permissions": {s: dict(flags) for s in WORKSPACE_SECTIONS}, "role": None}
    perms = {s: _empty() for s in WORKSPACE_SECTIONS}
    role = None
    if user.get("role_id"):
        role = await db.roles.find_one({"id": user["role_id"]}, {"_id": 0})
        for s, p in ((role or {}).get("permissions") or {}).items():
            if s in perms:
                perms[s] = {"can_view": bool(p.get("can_view")), "can_edit": bool(p.get("can_edit")),
                            "can_upload": bool(p.get("can_upload")), "can_delete": False}
    else:
        perms["dashboard"]["can_view"] = True  # no role assigned → the dashboard only
    return {"is_admin": False, "is_permanent_admin": False, "permissions": perms, "role": role}


def allows(resolved: Dict[str, Any], sections: Union[str, Iterable[str]], action: Action = "view") -> bool:
    """True when the user holds the action on any of the sections (admins always)."""
    if resolved["is_admin"]:
        return True
    secs = [sections] if isinstance(sections, str) else list(sections)
    return any(resolved["permissions"].get(s, {}).get(FLAG[action]) for s in secs)


def make_require_section(db, get_current_user):
    def require_section(sections: Union[str, Iterable[str]], action: Action = "view"):
        """Dependency: the user must hold ``action`` on the section (or on any of several sections, for lookups that
        more than one screen needs). Returns the user."""
        async def _dep(user: dict = Depends(get_current_user)):
            resolved = await resolve_permissions(db, user)
            if not allows(resolved, sections, action):
                raise HTTPException(403, "Your role doesn't give access to this section")
            return user
        return _dep
    return require_section
