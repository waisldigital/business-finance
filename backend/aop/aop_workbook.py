"""AOP full-model workbook: download an Excel file with raw-data tabs and a formula-based P&L.

The P&L tab mirrors the ``PnLEngine`` logic using Excel SUMIFS that reference the raw-data tabs,
so an admin can add/remove/edit line items in the raw tabs and re-upload to apply changes.

Sheets generated:
  1. rev_cute          — CUTE revenue per airport/pax_type
  2. rev_noncute       — Non-CUTE and revenue-share lines
  3. rev_projects      — CR and project revenue
  4. opex_lines        — Third-party opex PO lines
  5. payroll_lines     — Resource cost (sensitive — included only when the requester has payroll access)
  6. overhead_lines    — Overhead original budget by AOP head
  7. overhead_plan     — Next-year overhead on Cost centre + GL
  8. pl_other          — Below-EBITDA lines (depreciation, interest, etc.)
  9. assumptions       — Scenario drivers
  10. project_master   — Project master (taxonomy, PO value, budgets)
  11. P&L              — Formula-based P&L (SUMIFS referencing raw tabs)
  12. _meta            — Hidden config sheet (base_fy, plan_fy, cutoff, etc.)
"""
from __future__ import annotations

import io
import re
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .datasets import SPECS, VERSION_KEY, vkey
from .periods import fy_months, period_label
from .pnl import OH_BLOCKS

# ------------------------------------------------------------------ styling
DARK = PatternFill("solid", fgColor="0A1628")
GOLD = PatternFill("solid", fgColor="C9A227")
LIGHT_GREY = PatternFill("solid", fgColor="F3F4F6")
MEDIUM_GREY = PatternFill("solid", fgColor="E5E7EB")
WHITE_FONT = Font(bold=True, color="FFFFFF", size=10)
GOLD_FONT = Font(bold=True, color="0A1628", size=10)
HEADER_FONT = Font(bold=True, color="FFFFFF", size=10)
TOTAL_FONT = Font(bold=True, size=10)
PCT_FMT = "0.0%"
NUM_FMT = "#,##0"
THIN_BORDER = Border(
    bottom=Side(style="thin", color="E5E7EB"),
    right=Side(style="thin", color="E5E7EB"),
)


def _ql(fy: str) -> str:
    return "FY'" + fy[2:]


# ------------------------------------------------------------------ raw data helpers

# Which datasets go into the workbook and the columns to export for each
RAW_SHEETS: List[Tuple[str, str, List[str]]] = [
    ("rev_cute", "CUTE Revenue", ["airport", "pax_type", "stream", "geo", "tag"]),
    ("rev_noncute", "Non-CUTE Revenue", ["stream", "location", "geo", "tag"]),
    ("rev_projects", "Project Revenue", ["line_id", "category", "project_id", "description", "geo", "tag", "region"]),
    ("opex_lines", "Opex Lines", ["line_id", "category", "vendor", "description", "geo", "tag", "region",
                                   "currency", "po_number"]),
    ("payroll_lines", "Payroll", ["line_id", "category", "employee_name", "designation", "project_code",
                                   "department", "geo", "tag", "location", "status"]),
    ("overhead_lines", "Overheads", ["aop_head", "pl_tag", "description", "geo"]),
    ("overhead_plan", "Overhead Plan", ["line_id", "cost_centre", "gl", "department", "description", "geo"]),
    ("pl_other", "Below EBITDA", ["line"]),
    ("assumptions", "Assumptions", ["fy", "name", "code", "scenario", "low", "base", "high", "value"]),
    ("project_master", "Project Master", ["project_id", "project_name", "category", "customer", "geo", "tag",
                                           "region", "po_value", "revenue_b_base", "tp_cost_b_plan"]),
]


def _version_cols(rows: List[Dict[str, Any]]) -> List[str]:
    """Collect all version__period keys from the rows, sorted by version then period."""
    keys: set = set()
    for r in rows:
        for k in r:
            if VERSION_KEY.match(k):
                keys.add(k)
    return sorted(keys, key=lambda k: (k.split("__")[0], k.split("__")[1]))


def _write_data_sheet(wb: openpyxl.Workbook, sheet_name: str, lead_cols: List[str],
                      rows: List[Dict[str, Any]], versions: List[str]) -> None:
    ws = wb.create_sheet(sheet_name[:31])
    ver_cols = []
    for r in rows:
        for k in r:
            if VERSION_KEY.match(k):
                if k not in ver_cols:
                    ver_cols.append(k)
    ver_cols.sort(key=lambda k: (k.split("__")[0], k.split("__")[1]))
    all_cols = lead_cols + ver_cols
    for ci, col_name in enumerate(all_cols, 1):
        cell = ws.cell(row=1, column=ci, value=col_name)
        cell.font = HEADER_FONT
        cell.fill = DARK
        cell.alignment = Alignment(horizontal="center")
    for ri, row in enumerate(rows, 2):
        for ci, col_name in enumerate(all_cols, 1):
            val = row.get(col_name)
            cell = ws.cell(row=ri, column=ci, value=val)
            if ci > len(lead_cols) and isinstance(val, (int, float)):
                cell.number_format = NUM_FMT
    ws.freeze_panes = "A2"
    for ci in range(1, len(all_cols) + 1):
        ws.column_dimensions[get_column_letter(ci)].width = 14


def _write_meta_sheet(wb: openpyxl.Workbook, cfg: Dict[str, Any]) -> None:
    ws = wb.create_sheet("_meta")
    ws.sheet_state = "hidden"
    meta_items = [
        ("base_fy", cfg["base_fy"]),
        ("plan_fy", cfg["plan_fy"]),
        ("draft_fy", cfg.get("draft_fy", "")),
        ("cutoff_default", (cfg.get("cutoffs") or {}).get("default", "")),
        ("cutoff_overhead", (cfg.get("cutoffs") or {}).get("overhead", "")),
        ("tax_rate", cfg.get("tax_rate", 0.25)),
    ]
    for ri, (key, val) in enumerate(meta_items, 1):
        ws.cell(row=ri, column=1, value=key)
        ws.cell(row=ri, column=2, value=val)


# ------------------------------------------------------------------ P&L formula builder

# Maps P&L line IDs to how they are computed from the raw data sheets
# Each entry: (sheet_name, value_column_pattern, filter_column, filter_value_or_None)

class PnLFormula:
    """Builds the P&L sheet with SUMIFS formulas referencing raw-data tabs."""

    def __init__(self, wb: openpyxl.Workbook, base_fy: str, plan_fy: str, draft_fy: str,
                 cutoff: str, tax_rate: float, data: Dict[str, List[Dict[str, Any]]],
                 payroll_ok: bool):
        self.wb = wb
        self.base_fy = base_fy
        self.plan_fy = plan_fy
        self.draft_fy = draft_fy
        self.cutoff = cutoff
        self.tax_rate = tax_rate
        self.data = data
        self.payroll_ok = payroll_ok
        self.F = "F" + base_fy[2:]
        self.B = "B" + plan_fy[2:]
        self.BB = "B" + base_fy[2:]
        self.BD = "B" + draft_fy[2:]
        self.base_m = fy_months(base_fy)
        self.plan_m = fy_months(plan_fy)
        self.draft_m = fy_months(draft_fy)
        # Track sheet data ranges for SUMIFS
        self.sheet_ranges: Dict[str, Dict[str, Any]] = {}
        self._scan_sheets()

    def _scan_sheets(self):
        for sname in self.wb.sheetnames:
            if sname.startswith("_") or sname == "P&L":
                continue
            ws = self.wb[sname]
            if ws.max_row and ws.max_row > 1:
                headers = {ws.cell(1, c).value: c for c in range(1, ws.max_column + 1) if ws.cell(1, c).value}
                self.sheet_ranges[sname] = {
                    "headers": headers,
                    "last_row": ws.max_row,
                    "sheet": sname,
                }

    def _sumifs(self, sheet: str, sum_col: str, filters: List[Tuple[str, str]]) -> str:
        """Build a SUMIFS formula string.
        filters is a list of (column_header, literal_value) pairs."""
        info = self.sheet_ranges.get(sheet)
        if not info:
            return "0"
        headers = info["headers"]
        lr = info["last_row"]
        sum_c = headers.get(sum_col)
        if not sum_c:
            return "0"
        sum_range = f"'{sheet}'!{get_column_letter(sum_c)}2:{get_column_letter(sum_c)}{lr}"
        parts = [sum_range]
        for col_name, val in filters:
            fc = headers.get(col_name)
            if not fc:
                return "0"
            crit_range = f"'{sheet}'!{get_column_letter(fc)}2:{get_column_letter(fc)}{lr}"
            parts.append(crit_range)
            parts.append(f'"{val}"')
        return "SUMIFS(" + ",".join(parts) + ")"

    def _sum_months(self, sheet: str, version: str, months: List[str],
                    filters: List[Tuple[str, str]]) -> List[str]:
        """For each month, return a SUMIFS formula over the version__month column."""
        formulas = []
        for m in months:
            vk = vkey(version, m)
            formulas.append(self._sumifs(sheet, vk, filters))
        return formulas

    def _has_col(self, sheet: str, col: str) -> bool:
        info = self.sheet_ranges.get(sheet)
        return info is not None and col in info["headers"]

    def build(self):
        ws = self.wb.create_sheet("P&L", 0)

        # Column layout: Label | base months (12) | A base total | plan months (12) | B plan total | draft months (12) | B draft total
        # Header row
        col = 1
        ws.cell(1, col, "P&L Line").font = HEADER_FONT
        ws.cell(1, col).fill = DARK
        ws.column_dimensions["A"].width = 36
        col += 1

        # Base FY months
        base_start = col
        for m in self.base_m:
            c = ws.cell(1, col, period_label(m))
            c.font = HEADER_FONT
            c.fill = DARK
            c.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(col)].width = 12
            col += 1
        af_base_col = col
        c = ws.cell(1, col, f"{_ql(self.base_fy)} Actual")
        c.font = GOLD_FONT
        c.fill = GOLD
        c.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(col)].width = 16
        col += 1

        # Plan FY months
        plan_start = col
        for m in self.plan_m:
            c = ws.cell(1, col, period_label(m))
            c.font = HEADER_FONT
            c.fill = DARK
            c.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(col)].width = 12
            col += 1
        b_plan_col = col
        c = ws.cell(1, col, f"{_ql(self.plan_fy)} AOP")
        c.font = GOLD_FONT
        c.fill = GOLD
        c.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(col)].width = 16
        col += 1

        # Draft FY months
        draft_start = col
        for m in self.draft_m:
            c = ws.cell(1, col, period_label(m))
            c.font = HEADER_FONT
            c.fill = DARK
            c.alignment = Alignment(horizontal="center")
            ws.column_dimensions[get_column_letter(col)].width = 12
            col += 1
        b_draft_col = col
        c = ws.cell(1, col, f"{_ql(self.draft_fy)} Budget")
        c.font = GOLD_FONT
        c.fill = GOLD
        c.alignment = Alignment(horizontal="center")
        ws.column_dimensions[get_column_letter(col)].width = 16
        col += 1

        total_cols = col - 1
        ws.freeze_panes = "B2"

        # --- Build P&L rows ---
        row = 2
        ref: Dict[str, int] = {}  # line_id → row number for referencing in SUM formulas

        def add_line(rid: str, label: str, formulas_base: List[str], formulas_plan: List[str],
                     formulas_draft: List[str], *, level: int = 2, kind: str = "line",
                     sensitive: bool = False) -> int:
            nonlocal row
            r = row
            ref[rid] = r
            indent = "  " * level
            cell = ws.cell(r, 1, f"{indent}{label}")
            if kind == "total":
                cell.font = TOTAL_FONT
                for ci in range(1, total_cols + 1):
                    ws.cell(r, ci).fill = LIGHT_GREY
            elif kind == "subtotal":
                cell.font = Font(bold=True, size=10)

            if sensitive and not self.payroll_ok:
                ws.cell(r, 2, "CONFIDENTIAL")
                row += 1
                return r

            # Base FY monthly values
            for i, f in enumerate(formulas_base):
                c = ws.cell(r, base_start + i)
                if f.startswith("="):
                    c.value = f
                else:
                    c.value = f"={f}" if f != "0" else 0
                c.number_format = NUM_FMT
            # A base total = SUM of base months
            af = ws.cell(r, af_base_col)
            af.value = f"=SUM({get_column_letter(base_start)}{r}:{get_column_letter(base_start + 11)}{r})"
            af.number_format = NUM_FMT
            af.font = Font(bold=True)

            # Plan FY monthly values
            for i, f in enumerate(formulas_plan):
                c = ws.cell(r, plan_start + i)
                if f.startswith("="):
                    c.value = f
                else:
                    c.value = f"={f}" if f != "0" else 0
                c.number_format = NUM_FMT
            # B plan total
            bp = ws.cell(r, b_plan_col)
            bp.value = f"=SUM({get_column_letter(plan_start)}{r}:{get_column_letter(plan_start + 11)}{r})"
            bp.number_format = NUM_FMT
            bp.font = Font(bold=True)

            # Draft FY monthly values
            for i, f in enumerate(formulas_draft):
                c = ws.cell(r, draft_start + i)
                if f.startswith("="):
                    c.value = f
                else:
                    c.value = f"={f}" if f != "0" else 0
                c.number_format = NUM_FMT
            # B draft total
            bd = ws.cell(r, b_draft_col)
            bd.value = f"=SUM({get_column_letter(draft_start)}{r}:{get_column_letter(draft_start + 11)}{r})"
            bd.number_format = NUM_FMT
            bd.font = Font(bold=True)

            row += 1
            return r

        def sum_refs(rids: List[str], col_offset: int) -> str:
            """SUM formula referencing other P&L rows at a specific column."""
            parts = []
            for rid in rids:
                if rid in ref:
                    parts.append(f"{get_column_letter(col_offset)}{ref[rid]}")
            return "=" + "+".join(parts) if parts else "=0"

        def add_sum_line(rid: str, label: str, source_ids: List[str], *,
                         level: int = 0, kind: str = "total", sign: int = 1) -> int:
            """A P&L line that sums other lines (like Revenue = CUTE + Non-CUTE + CR + Projects)."""
            nonlocal row
            r = row
            ref[rid] = r
            indent = "  " * level
            cell = ws.cell(r, 1, f"{indent}{label}")
            if kind == "total":
                cell.font = TOTAL_FONT
                for ci in range(1, total_cols + 1):
                    ws.cell(r, ci).fill = LIGHT_GREY

            for ci in range(2, total_cols + 1):
                parts = []
                for sid in source_ids:
                    if sid in ref:
                        parts.append(f"{get_column_letter(ci)}{ref[sid]}")
                formula = "=" + "+".join(parts) if parts else "=0"
                c = ws.cell(r, ci, formula)
                c.number_format = NUM_FMT
            row += 1
            return r

        def add_diff_line(rid: str, label: str, plus_ids: List[str], minus_ids: List[str], *,
                          level: int = 0, kind: str = "total") -> int:
            nonlocal row
            r = row
            ref[rid] = r
            indent = "  " * level
            cell = ws.cell(r, 1, f"{indent}{label}")
            if kind == "total":
                cell.font = TOTAL_FONT
                for ci in range(1, total_cols + 1):
                    ws.cell(r, ci).fill = LIGHT_GREY

            for ci in range(2, total_cols + 1):
                plus = "+".join(f"{get_column_letter(ci)}{ref[s]}" for s in plus_ids if s in ref) or "0"
                minus = "+".join(f"{get_column_letter(ci)}{ref[s]}" for s in minus_ids if s in ref) or "0"
                c = ws.cell(r, ci, f"={plus}-({minus})")
                c.number_format = NUM_FMT
            row += 1
            return r

        def add_pct_line(rid: str, label: str, num_id: str, den_id: str, *, level: int = 1) -> int:
            nonlocal row
            r = row
            ref[rid] = r
            ws.cell(r, 1, f"{'  ' * level}{label}")
            for ci in range(2, total_cols + 1):
                n_ref = f"{get_column_letter(ci)}{ref.get(num_id, 2)}"
                d_ref = f"{get_column_letter(ci)}{ref.get(den_id, 2)}"
                c = ws.cell(r, ci, f'=IFERROR({n_ref}/{d_ref},0)')
                c.number_format = PCT_FMT
            row += 1
            return r

        def add_spacer():
            nonlocal row
            row += 1

        # Helper: build SUMIFS formulas for a dataset across months
        def ds_formulas(sheet: str, version: str, months: List[str],
                        filters: Optional[List[Tuple[str, str]]] = None) -> List[str]:
            flt = filters or []
            return self._sum_months(sheet, version, months, flt)

        # ===== REVENUE =====
        cute_base = ds_formulas("CUTE Revenue", self.F, self.base_m)
        cute_plan = ds_formulas("CUTE Revenue", self.B, self.plan_m)
        cute_draft = ds_formulas("CUTE Revenue", self.BD, self.draft_m)
        add_line("cute", "CUTE", cute_base, cute_plan, cute_draft)

        nc_flt = [("stream", "Non-CUTE")]
        noncute_base = ds_formulas("Non-CUTE Revenue", self.F, self.base_m, nc_flt)
        noncute_plan = ds_formulas("Non-CUTE Revenue", self.B, self.plan_m, nc_flt)
        noncute_draft = ds_formulas("Non-CUTE Revenue", self.BD, self.draft_m, nc_flt)
        add_line("non_cute", "Non CUTE", noncute_base, noncute_plan, noncute_draft)

        cr_flt = [("category", "Change Request")]
        cr_base = ds_formulas("Project Revenue", self.F, self.base_m, cr_flt)
        cr_plan = ds_formulas("Project Revenue", self.B, self.plan_m, cr_flt)
        cr_draft = ds_formulas("Project Revenue", self.BD, self.draft_m, cr_flt)
        add_line("change_request", "Change Request", cr_base, cr_plan, cr_draft)

        pj_flt = [("category", "Projects")]
        pj_base = ds_formulas("Project Revenue", self.F, self.base_m, pj_flt)
        pj_plan = ds_formulas("Project Revenue", self.B, self.plan_m, pj_flt)
        pj_draft = ds_formulas("Project Revenue", self.BD, self.draft_m, pj_flt)
        add_line("projects", "Project based Revenue", pj_base, pj_plan, pj_draft)

        add_sum_line("revenue", "Revenue", ["cute", "non_cute", "change_request", "projects"])
        add_spacer()

        # ===== DIRECT COST =====
        rs_flt = [("stream", "Rev Share")]
        rs_base = ds_formulas("Non-CUTE Revenue", self.F, self.base_m, rs_flt)
        rs_plan = ds_formulas("Non-CUTE Revenue", self.B, self.plan_m, rs_flt)
        rs_draft = ds_formulas("Non-CUTE Revenue", self.BD, self.draft_m, rs_flt)
        add_line("revenue_share", "Revenue Share", rs_base, rs_plan, rs_draft)

        # Resource cost — CA
        ca_flt = [("category", "CA")]
        pay_ca_base = ds_formulas("Payroll", self.F, self.base_m, ca_flt) if self.payroll_ok else ["0"] * 12
        pay_ca_plan = ds_formulas("Payroll", self.B, self.plan_m, ca_flt) if self.payroll_ok else ["0"] * 12
        pay_ca_draft = ds_formulas("Payroll", self.BD, self.draft_m, ca_flt) if self.payroll_ok else ["0"] * 12
        add_line("resource_cost_ca", "Resource Cost - CA", pay_ca_base, pay_ca_plan, pay_ca_draft,
                 level=1, kind="subtotal", sensitive=True)

        # TP opex — CA
        opex_ca_base = ds_formulas("Opex Lines", self.F, self.base_m, ca_flt)
        opex_ca_plan = ds_formulas("Opex Lines", self.B, self.plan_m, ca_flt)
        opex_ca_draft = ds_formulas("Opex Lines", self.BD, self.draft_m, ca_flt)
        add_line("tp_opex_ca", "TP Cost (Opex) - CA", opex_ca_base, opex_ca_plan, opex_ca_draft,
                 level=1, kind="subtotal")

        # CR costs
        cr_cost_flt = [("category", "Change Request")]
        opex_cr_base = ds_formulas("Opex Lines", self.F, self.base_m, cr_cost_flt)
        opex_cr_plan = ds_formulas("Opex Lines", self.B, self.plan_m, cr_cost_flt)
        opex_cr_draft = ds_formulas("Opex Lines", self.BD, self.draft_m, cr_cost_flt)
        add_line("tp_opex_cr", "TP Cost (Opex) - Change request", opex_cr_base, opex_cr_plan, opex_cr_draft)

        pay_cr_flt = [("category", "CR")]
        pay_cr_base = ds_formulas("Payroll", self.F, self.base_m, pay_cr_flt) if self.payroll_ok else ["0"] * 12
        pay_cr_plan = ds_formulas("Payroll", self.B, self.plan_m, pay_cr_flt) if self.payroll_ok else ["0"] * 12
        pay_cr_draft = ds_formulas("Payroll", self.BD, self.draft_m, pay_cr_flt) if self.payroll_ok else ["0"] * 12
        add_line("resource_cost_cr", "Resource Cost - CR", pay_cr_base, pay_cr_plan, pay_cr_draft, sensitive=True)

        add_sum_line("total_cost_cr", "Total Cost - Change request", ["tp_opex_cr", "resource_cost_cr"],
                     level=1, kind="subtotal")

        # Project costs
        pj_cost_flt = [("category", "Projects")]
        opex_pj_base = ds_formulas("Opex Lines", self.F, self.base_m, pj_cost_flt)
        opex_pj_plan = ds_formulas("Opex Lines", self.B, self.plan_m, pj_cost_flt)
        opex_pj_draft = ds_formulas("Opex Lines", self.BD, self.draft_m, pj_cost_flt)
        add_line("tp_opex_projects", "TP Cost (Opex) - Projects", opex_pj_base, opex_pj_plan, opex_pj_draft)

        pay_pj_flt = [("category", "Projects")]
        pay_pj_base = ds_formulas("Payroll", self.F, self.base_m, pay_pj_flt) if self.payroll_ok else ["0"] * 12
        pay_pj_plan = ds_formulas("Payroll", self.B, self.plan_m, pay_pj_flt) if self.payroll_ok else ["0"] * 12
        pay_pj_draft = ds_formulas("Payroll", self.BD, self.draft_m, pay_pj_flt) if self.payroll_ok else ["0"] * 12
        add_line("resource_cost_projects", "Resource Cost - Projects", pay_pj_base, pay_pj_plan, pay_pj_draft,
                 sensitive=True)

        add_sum_line("total_cost_projects", "Total Cost - Projects", ["tp_opex_projects", "resource_cost_projects"],
                     level=1, kind="subtotal")

        add_sum_line("direct_cost", "Direct Cost",
                     ["revenue_share", "resource_cost_ca", "tp_opex_ca", "total_cost_cr", "total_cost_projects"])
        add_spacer()

        # ===== GROSS MARGIN =====
        add_diff_line("gross_margin", "Gross Margin", ["revenue"], ["direct_cost"])
        add_pct_line("gm_pct", "Gross Margin %", "gross_margin", "revenue")
        add_spacer()

        # ===== ENABLING OVERHEADS =====
        oh_ids = []
        for block_label, parts in OH_BLOCKS:
            bid = "oh_" + re.sub(r"[^0-9a-z]+", "_", block_label.lower()).strip("_")
            part_ids = []
            for kind, key, row_label in parts:
                pid = "oh_" + re.sub(r"[^0-9a-z]+", "_", row_label.lower()).strip("_")
                if kind == "res":
                    flt = [("category", "Overheads"), ("tag", key)]
                    base_f = ds_formulas("Payroll", self.F, self.base_m, flt) if self.payroll_ok else ["0"] * 12
                    plan_f = ds_formulas("Payroll", self.B, self.plan_m, flt) if self.payroll_ok else ["0"] * 12
                    draft_f = ds_formulas("Payroll", self.BD, self.draft_m, flt) if self.payroll_ok else ["0"] * 12
                    add_line(pid, row_label, base_f, plan_f, draft_f, level=2, sensitive=True)
                else:
                    flt = [("pl_tag", key)]
                    base_f = ds_formulas("Overheads", self.F, self.base_m, flt)
                    plan_f = ds_formulas("Overheads", self.B, self.plan_m, flt)
                    # Draft overheads come from overhead_plan
                    draft_flt = [("department", key)]
                    draft_f = ds_formulas("Overhead Plan", self.BD, self.draft_m, draft_flt)
                    add_line(pid, row_label, base_f, plan_f, draft_f, level=2)
                part_ids.append(pid)
            add_sum_line(bid, block_label, part_ids, level=1, kind="subtotal")
            oh_ids.append(bid)

        add_sum_line("enabling_overheads", "Enabling Overheads", oh_ids)
        add_spacer()

        # ===== EBITDA =====
        add_diff_line("ebitda", "EBITDA", ["gross_margin"], ["enabling_overheads"])
        add_pct_line("ebitda_pct", "EBITDA %", "ebitda", "revenue")
        add_spacer()

        # ===== BELOW EBITDA =====
        for line_key, line_label in [("depreciation", "Less: Depreciation"),
                                      ("interest", "Less: Interest"),
                                      ("interest_income", "Add: Interest Income")]:
            flt = [("line", line_key)]
            base_f = ds_formulas("Below EBITDA", self.F, self.base_m, flt)
            plan_f = ds_formulas("Below EBITDA", self.B, self.plan_m, flt)
            draft_f = ds_formulas("Below EBITDA", self.BD, self.draft_m, flt)
            add_line(line_key, line_label, base_f, plan_f, draft_f, level=0)

        # PBT = EBITDA - Depreciation - Interest + Interest Income
        add_diff_line("pbt", "PBT", ["ebitda", "interest_income"], ["depreciation", "interest"])

        # Tax = tax_rate × PBT (for forecast/budget months)
        tax_flt = [("line", "taxes")]
        tax_base = ds_formulas("Below EBITDA", self.F, self.base_m, tax_flt)
        tax_plan = []
        for i in range(12):
            ci = plan_start + i
            pbt_ref = f"{get_column_letter(ci)}{ref['pbt']}"
            tax_plan.append(f"={pbt_ref}*{self.tax_rate}")
        tax_draft = []
        for i in range(12):
            ci = draft_start + i
            pbt_ref = f"{get_column_letter(ci)}{ref['pbt']}"
            tax_draft.append(f"={pbt_ref}*{self.tax_rate}")
        add_line("taxes", "Less: Taxes", tax_base, tax_plan, tax_draft, level=0)

        dtax_flt = [("line", "deferred_tax")]
        dtax_base = ds_formulas("Below EBITDA", self.F, self.base_m, dtax_flt)
        dtax_plan = ds_formulas("Below EBITDA", self.B, self.plan_m, dtax_flt)
        dtax_draft = ds_formulas("Below EBITDA", self.BD, self.draft_m, dtax_flt)
        add_line("deferred_tax", "Less: Deferred Tax", dtax_base, dtax_plan, dtax_draft, level=0)

        # PAT = PBT - Taxes - Deferred Tax
        add_diff_line("pat", "PAT", ["pbt"], ["taxes", "deferred_tax"])
        add_pct_line("pat_pct", "PAT Margin", "pat", "revenue")

        # Cash Profit = PAT + Depreciation + Deferred Tax
        add_sum_line("cash_profit", "Cash Profit", ["pat", "depreciation", "deferred_tax"])
        add_pct_line("cash_pct", "Cash Profit Margin", "cash_profit", "revenue")

        return ws


# ------------------------------------------------------------------ public API

def generate_workbook(data: Dict[str, List[Dict[str, Any]]], cfg: Dict[str, Any],
                      payroll_ok: bool = False) -> io.BytesIO:
    """Build the full AOP model workbook and return it as a BytesIO stream."""
    base_fy = cfg["base_fy"]
    plan_fy = cfg["plan_fy"]
    draft_fy = cfg.get("draft_fy") or "FY" + str(int(plan_fy[2:]) + 1).zfill(2)
    cutoff = (cfg.get("cutoffs") or {}).get("default", "")

    wb = openpyxl.Workbook()
    # Remove default sheet
    if "Sheet" in wb.sheetnames:
        del wb["Sheet"]

    # Write raw data sheets
    for ds_key, sheet_name, lead_cols in RAW_SHEETS:
        if ds_key == "payroll_lines" and not payroll_ok:
            continue
        rows = data.get(ds_key, [])
        _write_data_sheet(wb, sheet_name, lead_cols, rows, [])

    # Write meta
    _write_meta_sheet(wb, cfg)

    # Build P&L with formulas
    builder = PnLFormula(wb, base_fy, plan_fy, draft_fy, cutoff,
                         cfg.get("tax_rate", 0.25), data, payroll_ok)
    builder.build()

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out


# ------------------------------------------------------------------ upload parser

def parse_workbook(content: bytes) -> Dict[str, Any]:
    """Parse an uploaded AOP workbook and extract the raw-data sheets for upsert.

    Returns {dataset_key: [row_dicts], ...} plus the meta config read from _meta.
    """
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)

    # Read meta
    meta = {}
    if "_meta" in wb.sheetnames:
        ws = wb["_meta"]
        for row in ws.iter_rows(min_row=1, max_col=2, values_only=True):
            if row[0]:
                meta[str(row[0])] = row[1]

    # Map sheet names back to dataset keys
    sheet_to_ds = {sheet_name: ds_key for ds_key, sheet_name, _ in RAW_SHEETS}

    datasets: Dict[str, List[Dict[str, Any]]] = {}
    for sname in wb.sheetnames:
        if sname.startswith("_") or sname == "P&L":
            continue
        ds_key = sheet_to_ds.get(sname)
        if not ds_key:
            continue
        ws = wb[sname]
        rows_out = []
        headers = []
        for ri, row in enumerate(ws.iter_rows(values_only=True), 1):
            if ri == 1:
                headers = [str(c) if c else f"col_{i}" for i, c in enumerate(row)]
                continue
            if not any(c is not None and c != "" for c in row):
                continue
            row_dict = {}
            for ci, val in enumerate(row):
                if ci < len(headers):
                    key = headers[ci]
                    if val is not None and val != "":
                        row_dict[key] = val
            if row_dict:
                rows_out.append(row_dict)
        datasets[ds_key] = rows_out

    wb.close()
    return {"datasets": datasets, "meta": meta}
