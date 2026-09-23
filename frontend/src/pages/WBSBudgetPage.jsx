import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { formatApiErrorDetail, API as API_BASE } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  Stack, MagnifyingGlass, FunnelSimple, UploadSimple, DownloadSimple,
  Plus, X, Warning, CaretDown, Check,
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
  const { mode, inrPerUsd } = useCurrency();
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
              <StatChip label="Original Budget" value={formatCurrency(stats.ob, mode, inrPerUsd)} testid="chip-original-budget" />
              <StatChip label="Total PO" value={formatCurrency(stats.tp, mode, inrPerUsd)} testid="chip-total-po" />
              <StatChip label="Open PO" value={formatCurrency(stats.op, mode, inrPerUsd)} testid="chip-open-po" />
              <StatChip label="Balance" value={formatCurrency(stats.bb, mode, inrPerUsd)} testid="chip-balance" />
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
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} />
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
                      ? formatCurrency(Number(r[c.key] || 0), mode, inrPerUsd)
                      : formatCurrency(Number(r[c.key] || 0), mode, inrPerUsd))
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

function UploadModal({ onClose, onUploaded }) {
  const [mode, setMode] = useState("append");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const ref = useRef();

  const submit = async () => {
    if (!file) { setErr("Choose a file first"); return; }
    setBusy(true); setErr(""); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/wbs/bulk-upload?mode=${mode}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      onUploaded();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="wbs-upload-modal">
      <div className="bg-[var(--surface)] w-full max-w-lg border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">UPLOAD WBS</div>
            <h2 className="font-display text-xl font-bold">Excel / CSV Upload</h2>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-center">
            <a className="btn-ghost text-xs flex items-center gap-1" href={`${API_BASE}/wbs/template`} data-testid="wbs-upload-template-link">
              <DownloadSimple size={12} weight="bold" /> Download template (20 columns)
            </a>
          </div>
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`p-3 border text-left ${mode === "append" ? "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_8%,transparent)]" : "border-[var(--border)]"}`}
                onClick={() => setMode("append")}
                data-testid="wbs-mode-append"
              >
                <div className="font-display font-bold text-sm">Add (Append)</div>
                <div className="text-[11px] text-[var(--muted)] mt-1">Add new rows, skip WBS elements that already exist.</div>
              </button>
              <button
                className={`p-3 border text-left ${mode === "replace" ? "border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]" : "border-[var(--border)]"}`}
                onClick={() => setMode("replace")}
                data-testid="wbs-mode-replace"
              >
                <div className="font-display font-bold text-sm flex items-center gap-1">Replace All <Warning size={12} /></div>
                <div className="text-[11px] text-[var(--muted)] mt-1">Wipe the master and import fresh.</div>
              </button>
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">File (.xlsx, .csv)</div>
            <input type="file" ref={ref} className="hidden" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0])} data-testid="wbs-upload-file-input" />
            <div className="flex items-center gap-2">
              <button className="btn-secondary text-xs" onClick={() => ref.current?.click()} data-testid="wbs-upload-file-pick">Choose file</button>
              <span className="text-xs text-[var(--muted)] truncate flex-1">{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "No file selected"}</span>
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-2 leading-relaxed">
              Headers (row 1): Project definition · WBS element · Name · Original Budget · Total PO Value · Open PO Value · Balance Budget · Level · Acct asst elem.ind. · Company code · Currency · Description · Object Class · Person responsible · Plant · Profit center · Short ID · Status · Cost Center · Controlling area
            </div>
          </div>
          {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)]">{err}</div>}
          {result && (
            <div className="text-xs bg-[var(--surface-2)] p-3 border border-[var(--border)]" data-testid="wbs-upload-result">
              <div>Mode: <span className="font-mono">{result.mode}</span></div>
              <div>Total rows: <span className="font-mono">{result.total_rows}</span></div>
              <div>Saved: <span className="font-mono text-[var(--success)]">{result.saved}</span></div>
              <div>Failed: <span className="font-mono text-[var(--danger)]">{result.failed}</span></div>
              {result.failures?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[var(--muted)]">Failures</summary>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap mt-1">{JSON.stringify(result.failures, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={busy || !file}
            data-testid="wbs-upload-submit-btn"
          >
            {busy ? "Uploading…" : mode === "replace" ? "Replace All" : "Upload & Append"}
          </button>
        </div>
      </div>
    </div>
  );
}
