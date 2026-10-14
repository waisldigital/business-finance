import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { API as API_BASE } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatMoney } from "@/aop/format";
import { useAuth } from "@/lib/auth";
import BulkUploadModal from "@/components/common/BulkUploadModal";
import {
  Stack, MagnifyingGlass, FunnelSimple, UploadSimple, DownloadSimple,
  X, CaretDown, Check,
} from "@phosphor-icons/react";

// 4 filter columns + colour modulation (hue shift)
const FILTER_COLS = [
  { key: "wbs_element",        label: "WBS Element",        hue: 42  },  // gold
  { key: "description",        label: "Description",        hue: 200 },  // cyan
  { key: "person_responsible", label: "Person Responsible", hue: 280 },  // purple
  { key: "short_id",           label: "Short ID",           hue: 140 },  // green
];

const FIND_COLUMNS = [
  { key: "project_definition", label: "Project Definition" },
  { key: "wbs_element",        label: "WBS Element" },
  { key: "name",               label: "Name" },
  { key: "company_code",       label: "Company Code" },
  { key: "currency",           label: "Currency" },
  { key: "description",        label: "Description" },
  { key: "object_class",       label: "Object Class" },
  { key: "person_responsible", label: "Person Responsible" },
  { key: "plant",              label: "Plant" },
  { key: "profit_center",      label: "Profit Center" },
  { key: "short_id",           label: "Short ID" },
];

const BUDGET_COLUMNS = [
  { key: "project_definition", label: "Project Definition" },
  { key: "wbs_element",        label: "WBS Element" },
  { key: "name",               label: "Name" },
  { key: "original_budget",    label: "Original Budget",   num: true },
  { key: "total_po_value",     label: "Total PO Value",    num: true },
  { key: "open_po_value",      label: "Open PO Value",     num: true },
  { key: "balance_budget",     label: "Balance Budget",    num: true },
  { key: "currency",           label: "Currency" },
  { key: "description",        label: "Description" },
  { key: "object_class",       label: "Object Class" },
  { key: "person_responsible", label: "Person Responsible" },
  { key: "plant",              label: "Plant" },
];

export default function WBSBudgetPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { mode, inrPerUsd, unit } = useCurrency();
  const [tab, setTab] = useState("find");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  // Per-filter selections — { [filterKey]: Set<string> }. Empty set = no filter (show all).
  const [filters, setFilters] = useState(() => Object.fromEntries(FILTER_COLS.map((f) => [f.key, new Set()])));

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/wbs");
      setRows(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Distinct values per filter column (used to populate dropdown options)
  const distinct = useMemo(() => {
    const out = {};
    for (const f of FILTER_COLS) {
      const set = new Set();
      for (const r of rows) {
        const v = (r[f.key] ?? "").toString().trim();
        if (v) set.add(v);
      }
      out[f.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [rows]);

  // Apply filters + global search
  const filtered = useMemo(() => {
    const gs = globalSearch.trim().toLowerCase();
    return rows.filter((r) => {
      for (const f of FILTER_COLS) {
        const sel = filters[f.key];
        if (sel && sel.size > 0) {
          const val = (r[f.key] ?? "").toString();
          if (!sel.has(val)) return false;
        }
      }
      if (gs) {
        const hay = [r.wbs_element, r.name, r.description, r.person_responsible, r.project_definition, r.short_id]
          .map((v) => (v || "").toString().toLowerCase()).join(" ");
        if (!hay.includes(gs)) return false;
      }
      return true;
    });
  }, [rows, filters, globalSearch]);

  const stats = useMemo(() => {
    let ob = 0, tp = 0, op = 0, bb = 0;
    for (const r of filtered) {
      ob += Number(r.original_budget || 0);
      tp += Number(r.total_po_value || 0);
      op += Number(r.open_po_value || 0);
      bb += Number(r.balance_budget || 0);
    }
    return { count: filtered.length, ob, tp, op, bb };
  }, [filtered]);

  const setFilterSelection = (key, newSet) => {
    setFilters((f) => ({ ...f, [key]: newSet }));
  };
  const clearAllFilters = () => {
    setFilters(Object.fromEntries(FILTER_COLS.map((f) => [f.key, new Set()])));
    setGlobalSearch("");
  };
  const anyFilterActive = Object.values(filters).some((s) => s && s.size > 0) || !!globalSearch;

  return (
    <div data-testid="wbs-budget-page">
      <PageHeader
        title="WBS and Budget"
        subtitle="SAP-style WBS master · Find WBS · See Budget"
        breadcrumb="HOME · WBS AND BUDGET"
        actions={isAdmin && (
          <div className="flex gap-2">
            <a className="btn-ghost flex items-center gap-2 text-xs" href={`${API_BASE}/wbs/template`} data-testid="wbs-template-btn">
              <DownloadSimple size={14} weight="bold" /> Template
            </a>
            <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => setShowUpload(true)} data-testid="wbs-upload-btn">
              <UploadSimple size={14} weight="bold" /> Upload
            </button>
          </div>
        )}
      />

      <div className="px-8 py-6 space-y-4">
        {/* Sub-tabs */}
        <div className="tile p-1 inline-flex gap-1" data-testid="wbs-tabs">
          <TabButton active={tab === "find"}    onClick={() => setTab("find")}     testid="wbs-tab-find">Find WBS</TabButton>
          <TabButton active={tab === "budget"}  onClick={() => setTab("budget")}   testid="wbs-tab-budget">See Budget</TabButton>
        </div>

        {/* Compact stat chips + global search */}
        <div className="flex flex-wrap items-center gap-2">
          <StatChip label="WBS" value={stats.count} icon={<Stack size={12} weight="duotone" className="text-[var(--gold)]" />} testid="chip-wbs-count" />
          {tab === "budget" && (
            <>
              <StatChip label="Original Budget" value={formatMoney(stats.ob, unit)} testid="chip-original-budget" />
              <StatChip label="Total PO" value={formatMoney(stats.tp, unit)} testid="chip-total-po" />
              <StatChip label="Open PO" value={formatMoney(stats.op, unit)} testid="chip-open-po" />
              <StatChip label="Balance" value={formatMoney(stats.bb, unit)} testid="chip-balance" />
            </>
          )}
          <div className="flex-1 min-w-[200px]" />
          <div className="relative">
            <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-7 h-8 text-xs w-64"
              placeholder="Quick search…"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              data-testid="wbs-global-search"
            />
          </div>
        </div>

        {/* Excel-style filter row */}
        <div className="tile p-2 flex flex-wrap items-center gap-2" data-testid="wbs-filter-bar">
          <FunnelSimple size={14} weight="duotone" className="text-[var(--muted)] ml-1" />
          {FILTER_COLS.map((f) => (
            <FilterDropdown
              key={f.key}
              column={f}
              options={distinct[f.key] || []}
              selected={filters[f.key]}
              onChange={(s) => setFilterSelection(f.key, s)}
            />
          ))}
          {anyFilterActive && (
            <button className="btn-ghost text-[10px] tracking-overline flex items-center gap-1" onClick={clearAllFilters} data-testid="wbs-filters-clear">
              <X size={11} weight="bold" /> Clear all
            </button>
          )}
          <div className="ml-auto text-[11px] text-[var(--muted)] pr-2">{filtered.length} of {rows.length}</div>
        </div>

        {/* Table */}
        <div className="tile overflow-x-auto">
          {tab === "find" ? (
            <FindTable rows={filtered} loading={loading} />
          ) : (
            <BudgetTable rows={filtered} loading={loading} mode={mode} inrPerUsd={inrPerUsd} />
          )}
        </div>
      </div>

      {showUpload && (
        <BulkUploadModal title="UPLOAD WBS" endpoint="/wbs/bulk-upload" templateUrl="/wbs/template" templateFile="wbs_template.xlsx"
                         templateLabel="Download template (20 columns)" testid="wbs-upload-modal" testidPrefix="wbs-"
                         appendHelp="Add new rows, skip WBS elements that already exist." replaceHelp="Wipe the master and import fresh."
                         columnsHelp="Headers (row 1): Project definition · WBS element · Name · Original Budget · Total PO Value · Open PO Value · Balance Budget · Level · Acct asst elem.ind. · Company code · Currency · Description · Object Class · Person responsible · Plant · Profit center · Short ID · Status · Cost Center · Controlling area"
                         onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} />
      )}
    </div>
  );
}

function TabButton({ children, active, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 text-xs tracking-overline transition-all ${active
        ? "bg-[var(--gold)] text-[var(--bg)] font-semibold"
        : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"}`}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

function StatChip({ label, value, icon, testid }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border)]" data-testid={testid}>
      {icon}
      <span className="text-[9px] tracking-overline text-[var(--muted)] uppercase">{label}</span>
      <span className="text-xs font-mono font-semibold">{value}</span>
    </div>
  );
}

function FindTable({ rows, loading }) {
  return (
    <table className="tbl min-w-[1100px]" data-testid="wbs-find-table">
      <thead>
        <tr>{FIND_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {loading && <tr><td colSpan={FIND_COLUMNS.length} className="text-center py-12 text-[var(--muted)]">Loading…</td></tr>}
        {!loading && rows.length === 0 && (
          <tr><td colSpan={FIND_COLUMNS.length} className="text-center py-12 text-[var(--muted)]">No WBS elements — upload Excel to populate.</td></tr>
        )}
        {!loading && rows.map((r) => (
          <tr key={r.id} data-testid={`wbs-row-${r.id}`}>
            {FIND_COLUMNS.map((c) => (
              <td key={c.key} className={c.key === "wbs_element" || c.key === "project_definition" ? "font-mono text-xs" : ""}>
                {r[c.key] || "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BudgetTable({ rows, loading, mode, inrPerUsd }) {
  return (
    <table className="tbl min-w-[1300px]" data-testid="wbs-budget-table">
      <thead>
        <tr>{BUDGET_COLUMNS.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {loading && <tr><td colSpan={BUDGET_COLUMNS.length} className="text-center py-12 text-[var(--muted)]">Loading…</td></tr>}
        {!loading && rows.length === 0 && (
          <tr><td colSpan={BUDGET_COLUMNS.length} className="text-center py-12 text-[var(--muted)]">No WBS elements — upload Excel to populate.</td></tr>
        )}
        {!loading && rows.map((r) => (
          <tr key={r.id} data-testid={`wbs-budget-row-${r.id}`}>
            {BUDGET_COLUMNS.map((c) => (
              <td key={c.key} className={c.num ? "num font-mono text-xs" : (c.key === "wbs_element" || c.key === "project_definition" ? "font-mono text-xs" : "")}>
                {c.num
                  ? (r.currency === "USD"
                      ? formatMoney(Number(r[c.key] || 0), unit)
                      : formatMoney(Number(r[c.key] || 0), unit))
                  : (r[c.key] || "—")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Excel-style column filter dropdown.
 * - Internal search box
 * - "Select all (filtered)" toggles all currently-visible options
 * - Pressing Enter in the search box selects all matching options
 * - Each filter chip has a column-specific hue tint
 */
function FilterDropdown({ column, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef();

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const isActive = selected && selected.size > 0;
  const filteredOptions = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => o.toLowerCase().includes(qq));
  }, [options, q]);

  const toggle = (v) => {
    const next = new Set(selected || []);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  };
  const selectAllVisible = () => {
    const next = new Set(selected || []);
    for (const o of filteredOptions) next.add(o);
    onChange(next);
  };
  const clear = () => onChange(new Set());

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      selectAllVisible();
    }
  };

  // Colour modulation per filter
  const tint = `hsl(${column.hue} 70% 50%)`;
  const tintBg = `hsl(${column.hue} 70% 50% / 0.10)`;
  const tintBorder = `hsl(${column.hue} 70% 50% / 0.45)`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] tracking-overline border transition-all"
        style={{
          background: isActive ? tintBg : "var(--surface-2)",
          borderColor: isActive ? tintBorder : "var(--border)",
          color: isActive ? tint : "var(--text)",
        }}
        data-testid={`wbs-filter-${column.key}`}
      >
        <span className="w-1.5 h-1.5" style={{ background: tint }} />
        {column.label}
        {isActive && <span className="font-mono normal-case ml-0.5">({selected.size})</span>}
        <CaretDown size={10} weight="bold" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 bg-[var(--surface)] border shadow-xl" style={{ borderColor: tintBorder }} data-testid={`wbs-filter-popup-${column.key}`}>
          <div className="p-2 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="relative">
              <MagnifyingGlass size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                autoFocus
                className="input pl-7 h-7 text-xs"
                placeholder={`Search ${column.label.toLowerCase()}…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                data-testid={`wbs-filter-search-${column.key}`}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[10px] tracking-overline">
              <button className="text-[var(--gold)]" onClick={selectAllVisible} data-testid={`wbs-filter-select-all-${column.key}`}>Select all{q ? " filtered" : ""}</button>
              <button className="text-[var(--muted)]" onClick={clear} data-testid={`wbs-filter-clear-${column.key}`}>Clear</button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredOptions.length === 0 && (
              <div className="text-xs text-[var(--muted)] px-3 py-2">No values</div>
            )}
            {filteredOptions.map((o) => {
              const checked = selected && selected.has(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className="w-full text-left px-3 py-1 text-xs hover:bg-[var(--surface-2)] flex items-center gap-2"
                  data-testid={`wbs-filter-option-${column.key}-${o}`}
                >
                  <span
                    className="w-3.5 h-3.5 border flex items-center justify-center"
                    style={{ background: checked ? tint : "transparent", borderColor: checked ? tint : "var(--border)" }}
                  >
                    {checked && <Check size={9} weight="bold" color="#fff" />}
                  </span>
                  <span className="truncate flex-1">{o}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

