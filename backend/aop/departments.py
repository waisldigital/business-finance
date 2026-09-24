"""Department data scope for overheads and payroll.

A role can limit its users to their own department (``aop_dept_scope = "own"``, the department comes from the
employee master) or to a fixed list (``"list"``, the role's ``aop_departments``). Department names differ between
the employee master ("Finance", "IT") and the AOP / SAP data ("Finance & Accounts", "Internal IT"), so names
match when they are equal, when one name's words start the other's ("Finance" ↔ "Finance & Accounts"), or
through an alias (built-in below, extended by the admin in the AOP config as ``dept_aliases``).
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

# employee-master spelling → AOP department (lower-case keys)
BUILTIN_ALIASES: Dict[str, List[str]] = {
    "it": ["Internal IT"], "information technology": ["Internal IT"], "legal": ["Contract & Legal"],
    "contracts": ["Contract & Legal"], "human resources": ["HR"], "administration": ["Admin"],
    "accounts": ["Finance & Accounts"], "quality": ["Quality & Governance"], "governance": ["Quality & Governance"],
    "business development": ["BD - International", "Front-End Sales"], "sales": ["BD - International", "Front-End Sales"],
    "marketing": ["Marketing", "Marketing & Alliances India", "Marketing & Alliances Intt."],
    "purchase": ["Procurement"], "product": ["Product & Solutions Overhead"], "solutions": ["Product & Solutions Overhead"],
}

# fields that carry a department on overhead / payroll rows and actuals
ROW_FIELDS = {
    "overhead_lines": ("pl_tag", "department", "p_l_tag"),
    "overhead_plan": ("department", "pl_tag"),
    "payroll_lines": ("tag", "department", "sub_function"),
}
ACTUAL_DIMS = ("pl_tag", "tag", "department", "synergy")
SCOPED_DATASETS = set(ROW_FIELDS)


def words(v: Any) -> List[str]:
    s = str(v or "").lower().replace("&", " and ")
    return [w for w in re.split(r"[^0-9a-z]+", s) if w and w != "and"]


def same(a: Any, b: Any) -> bool:
    """True when two department names refer to the same department (equal, or one's words start the other's)."""
    x, y = words(a), words(b)
    if not x or not y:
        return False
    short, long_ = (x, y) if len(x) <= len(y) else (y, x)
    return long_[:len(short)] == short


def expand(names: Iterable[str], aliases: Optional[Dict[str, List[str]]] = None) -> List[str]:
    """A user's departments plus every alias they stand for."""
    table = {k.lower(): list(v) for k, v in BUILTIN_ALIASES.items()}
    for k, v in (aliases or {}).items():
        table.setdefault(str(k).strip().lower(), [])
        table[str(k).strip().lower()] += [x for x in (v if isinstance(v, list) else [v]) if x]
    out: List[str] = []
    for n in names:
        n = str(n or "").strip()
        if not n:
            continue
        out.append(n)
        out += table.get(n.lower(), [])
    seen, uniq = set(), []
    for n in out:
        if n.lower() not in seen:
            seen.add(n.lower())
            uniq.append(n)
    return uniq


def allowed(scope: Optional[List[str]], *values: Any) -> bool:
    """scope None = every department; otherwise any of the values must match one of the scope's departments."""
    if scope is None:
        return True
    return any(same(v, d) for v in values if v not in (None, "") for d in scope)


def row_allowed(scope: Optional[List[str]], dataset: str, fields: Dict[str, Any]) -> bool:
    if scope is None or dataset not in ROW_FIELDS:
        return True
    return allowed(scope, *[fields.get(k) for k in ROW_FIELDS[dataset]])


def actual_allowed(scope: Optional[List[str]], a: Dict[str, Any]) -> bool:
    if scope is None:
        return True
    d = a.get("dims") or {}
    return allowed(scope, *[d.get(k) for k in ACTUAL_DIMS])
