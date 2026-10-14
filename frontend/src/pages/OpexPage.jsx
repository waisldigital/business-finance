import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import api, { formatApiErrorDetail, API as API_BASE } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  Receipt, MagnifyingGlass, UploadSimple, DownloadSimple,
  Plus, X, CaretDown, Check, ArrowRight,
  LinkSimple, Trash, Tag, CircleNotch, Eye,
  CaretLeft, CaretRight, PencilSimple, Warning,
} from "@phosphor-icons/react";

const MONTHS = ["apr","may","jun","jul","aug","sep","oct","nov","dec","jan","feb","mar"];
const MONTH_LABELS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

const AOP_ID_COLS = [
  { key: "wbs_element", label: "WBS Element", mono: true },
  { key: "cost_centre", label: "Cost Centre" },
  { key: "gl_account", label: "GL Account", mono: true },
  { key: "description", label: "Description" },
  { key: "department", label: "Department" },
  { key: "category", label: "Category" },
  { key: "vendor_name", label: "Vendor" },
];

const AOP_BUDGET_COLS = [
  { key: "original_budget", label: "Budget", num: true },
  { key: "fy28_budget", label: "FY28 Budget", num: true },
  { key: "ytd_actual", label: "YTD Actual", num: true },
  { key: "full_year_estimate", label: "FY Estimate", num: true },
];

const ZMM_COLS = [
  { key: "po_number", label: "PO Number", mono: true },
  { key: "po_item", label: "Item", mono: true },
  { key: "vendor_name", label: "Vendor" },
  { key: "short_text", label: "Description" },
  { key: "wbs_element", label: "WBS", mono: true },
  { key: "po_value", label: "PO Value", num: true },
  { key: "gr_value", label: "GR Value", num: true },
  { key: "invoice_value", label: "Invoice", num: true },
  { key: "open_value", label: "Open", num: true },
  { key: "po_date", label: "PO Date", date: true },
  { key: "triage_status", label: "Status", badge: true },
];

const LINK_COLS = [
  { key: "po_number", label: "PO Number", mono: true },
  { key: "po_item", label: "Item" },
  { key: "aop_line_id", label: "AOP Line", mono: true },
  { key: "start_date", label: "Start Date", date: true },
  { key: "end_date", label: "End Date", date: true },
  { key: "predecessor_po", label: "Old PO", mono: true },
  { key: "successor_po", label: "New PO", mono: true },
  { key: "sequence_order", label: "Seq #" },
  { key: "is_active", label: "Active", badge: true },
];

const CORR_COLS = [
  { key: "po_number", label: "PO Number", mono: true },
  { key: "po_item", label: "Item" },
  { key: "reason", label: "Reason" },
  { key: "active", label: "Active", badge: true },
  { key: "corrected_at", label: "Corrected At", date: true },
];


export default function OpexPage() {
  const { user } = useAuth();
  const { mode, inrPerUsd } = useCurrency();
  const [tab, setTab] = useState("aop");
  const [search, setSearch] = useState("");

  const [aopRows, setAopRows] = useState([]);
  const [zmmRows, setZmmRows] = useState([]);
  const [linkRows, setLinkRows] = useState([]);
  const [corrRows, setCorrRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showAopUpload, setShowAopUpload] = useState(false);
  const [showZmmUpload, setShowZmmUpload] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showCorrModal, setShowCorrModal] = useState(false);
  const [editLink, setEditLink] = useState(null);
  const [editCorr, setEditCorr] = useState(null);
  const [drawerPo, setDrawerPo] = useState(null);
  const [showMonthly, setShowMonthly] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [aop, zmm, links, corr, sum] = await Promise.all([
        api.get("/opex/aop"),
        api.get("/opex/zmm"),
        api.get("/opex/po-links"),
        api.get("/opex/corrections"),
        api.get("/opex/summary"),
      ]);
      setAopRows(aop.data);
      setZmmRows(zmm.data);
      setLinkRows(links.data);
      setCorrRows(corr.data);
      setSummary(sum.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const q = search.trim().toLowerCase();

  const filteredAop = useMemo(() => {
    if (!q) return aopRows;
    return aopRows.filter(r => {
      const hay = [r.wbs_element, r.cost_centre, r.gl_account, r.description, r.department, r.category, r.vendor_name]
        .map(v => (v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }, [aopRows, q]);

  const filteredZmm = useMemo(() => {
    if (!q) return zmmRows;
    return zmmRows.filter(r => {
      const hay = [r.po_number, r.vendor_name, r.short_text, r.wbs_element, r.triage_status]
        .map(v => (v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }, [zmmRows, q]);

  const filteredLinks = useMemo(() => {
    if (!q) return linkRows;
    return linkRows.filter(r => {
      const hay = [r.po_number, r.aop_line_id, r.predecessor_po, r.successor_po]
        .map(v => (v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }, [linkRows, q]);

  const filteredCorr = useMemo(() => {
    if (!q) return corrRows;
    return corrRows.filter(r => {
      const hay = [r.po_number, r.reason].map(v => (v || "").toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }, [corrRows, q]);

  const deleteLink = async (id) => {
    if (!window.confirm("Delete this PO link?")) return;
    await api.delete(`/opex/po-links/${id}`);
    loadAll();
  };

  const deleteCorr = async (id) => {
    if (!window.confirm("Delete this correction?")) return;
    await api.delete(`/opex/corrections/${id}`);
    loadAll();
  };

  const tabData = { aop: filteredAop, zmm: filteredZmm, links: filteredLinks, corrections: filteredCorr };
  const currentRows = tabData[tab] || [];

  return (
    <div data-testid="opex-page">
      <PageHeader
        title="Opex"
        subtitle="AOP Budget · PO Register · PO Links · Corrections"
        breadcrumb="HOME · OPEX"
        actions={
          <div className="flex gap-2">
            {tab === "aop" && (
              <>
                <a className="btn-ghost flex items-center gap-2 text-xs" href={`${API_BASE}/opex/aop/template`} data-testid="opex-aop-template-btn">
                  <DownloadSimple size={14} weight="bold" /> AOP Template
                </a>
                <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => setShowAopUpload(true)} data-testid="opex-aop-upload-btn">
                  <UploadSimple size={14} weight="bold" /> Upload AOP
                </button>
              </>
            )}
            {tab === "zmm" && (
              <>
                <a className="btn-ghost flex items-center gap-2 text-xs" href={`${API_BASE}/opex/zmm/template`} data-testid="opex-zmm-template-btn">
                  <DownloadSimple size={14} weight="bold" /> ZMM Template
                </a>
                <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => setShowZmmUpload(true)} data-testid="opex-zmm-upload-btn">
                  <UploadSimple size={14} weight="bold" /> Upload ZMM
                </button>
              </>
            )}
            {tab === "links" && (
              <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => { setEditLink(null); setShowLinkModal(true); }} data-testid="opex-add-link-btn">
                <Plus size={14} weight="bold" /> Add PO Link
              </button>
            )}
            {tab === "corrections" && (
              <button className="btn-secondary flex items-center gap-2 text-xs" onClick={() => { setEditCorr(null); setShowCorrModal(true); }} data-testid="opex-add-corr-btn">
                <Plus size={14} weight="bold" /> Add Correction
              </button>
            )}
          </div>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Stat chips */}
        {summary && (
          <div className="flex flex-wrap items-center gap-2">
            <StatChip label="AOP Lines" value={summary.aop_count} testid="chip-aop" />
            <StatChip label="ZMM Lines" value={summary.zmm_count} testid="chip-zmm" />
            <StatChip label="PO Links" value={summary.links_count} testid="chip-links" />
            <StatChip label="Mapped" value={summary.mapped} color="var(--success)" testid="chip-mapped" />
            <StatChip label="Unmapped" value={summary.unmapped} color="var(--warning)" testid="chip-unmapped" />
            <StatChip label="Total Budget" value={formatCurrency(summary.total_budget, mode, inrPerUsd)} testid="chip-budget" />
            <StatChip label="Total PO" value={formatCurrency(summary.total_po_value, mode, inrPerUsd)} testid="chip-po-value" />
          </div>
        )}

        {/* Sub-tabs + search */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="tile p-1 inline-flex gap-1" data-testid="opex-tabs">
            <TabButton active={tab === "aop"} onClick={() => setTab("aop")} testid="opex-tab-aop">AOP Lines</TabButton>
            <TabButton active={tab === "zmm"} onClick={() => setTab("zmm")} testid="opex-tab-zmm">PO Register</TabButton>
            <TabButton active={tab === "links"} onClick={() => setTab("links")} testid="opex-tab-links">PO Links</TabButton>
            <TabButton active={tab === "corrections"} onClick={() => setTab("corrections")} testid="opex-tab-corrections">Corrections</TabButton>
          </div>
          <div className="flex items-center gap-3">
            {tab === "aop" && (
              <button
                className={`text-[10px] tracking-overline px-2.5 py-1 border transition-all ${showMonthly ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10" : "border-[var(--border)] text-[var(--muted)]"}`}
                onClick={() => setShowMonthly(v => !v)}
                data-testid="opex-toggle-monthly"
              >
                {showMonthly ? "Hide Monthly" : "Show Monthly"}
              </button>
            )}
            <div className="relative">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                className="input pl-7 h-8 text-xs w-64"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="opex-search"
              />
            </div>
          </div>
        </div>

        {/* Count row */}
        <div className="text-[11px] text-[var(--muted)] px-1">
          {currentRows.length} {tab === "aop" ? "AOP lines" : tab === "zmm" ? "ZMM lines" : tab === "links" ? "PO links" : "corrections"}
          {q && ` (filtered)`}
        </div>

        {/* Table area */}
        <div className="tile overflow-x-auto">
          {tab === "aop" && (
            <AopTable rows={filteredAop} loading={loading} mode={mode} inrPerUsd={inrPerUsd} showMonthly={showMonthly} />
          )}
          {tab === "zmm" && (
            <ZmmTable rows={filteredZmm} loading={loading} mode={mode} inrPerUsd={inrPerUsd} onViewPo={setDrawerPo} />
          )}
          {tab === "links" && (
            <LinksTable
              rows={filteredLinks}
              loading={loading}
              aopRows={aopRows}
              onViewPo={setDrawerPo}
              onEdit={(row) => { setEditLink(row); setShowLinkModal(true); }}
              onDelete={deleteLink}
            />
          )}
          {tab === "corrections" && (
            <CorrTable
              rows={filteredCorr}
              loading={loading}
              onEdit={(row) => { setEditCorr(row); setShowCorrModal(true); }}
              onDelete={deleteCorr}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {showAopUpload && <UploadModal type="aop" onClose={() => setShowAopUpload(false)} onDone={() => { setShowAopUpload(false); loadAll(); }} />}
      {showZmmUpload && <UploadModal type="zmm" onClose={() => setShowZmmUpload(false)} onDone={() => { setShowZmmUpload(false); loadAll(); }} />}
      {showLinkModal && <PoLinkModal existing={editLink} aopRows={aopRows} onClose={() => setShowLinkModal(false)} onDone={() => { setShowLinkModal(false); loadAll(); }} />}
      {showCorrModal && <CorrectionModal existing={editCorr} onClose={() => setShowCorrModal(false)} onDone={() => { setShowCorrModal(false); loadAll(); }} />}

      {/* PO Detail Drawer */}
      {drawerPo && <PoDetailDrawer poNumber={drawerPo} mode={mode} inrPerUsd={inrPerUsd} onClose={() => setDrawerPo(null)} />}
    </div>
  );
}


/* ─── Shared sub-components ─── */

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

function StatChip({ label, value, color, testid }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border)]" data-testid={testid}>
      <span className="text-[9px] tracking-overline text-[var(--muted)] uppercase">{label}</span>
      <span className="text-xs font-mono font-semibold" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function StatusBadge({ value }) {
  if (value === true || value === "mapped" || value === "active") {
    return <span className="inline-block px-2 py-0.5 text-[10px] tracking-overline font-semibold bg-emerald-900/20 text-emerald-400 border border-emerald-700/30">{String(value)}</span>;
  }
  if (value === false || value === "unmapped" || value === "inactive") {
    return <span className="inline-block px-2 py-0.5 text-[10px] tracking-overline font-semibold bg-amber-900/20 text-amber-400 border border-amber-700/30">{String(value)}</span>;
  }
  return <span className="inline-block px-2 py-0.5 text-[10px] tracking-overline font-semibold bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]">{String(value ?? "—")}</span>;
}

function EmptyRow({ cols, msg }) {
  return <tr><td colSpan={cols} className="text-center py-12 text-[var(--muted)]">{msg}</td></tr>;
}

function LoadingRow({ cols }) {
  return <tr><td colSpan={cols} className="text-center py-12 text-[var(--muted)]">Loading…</td></tr>;
}


/* ─── AOP Table ─── */

function AopTable({ rows, loading, mode, inrPerUsd, showMonthly }) {
  const monthActualCols = MONTHS.map((m, i) => ({ key: `${m}_actual`, label: MONTH_LABELS[i], num: true }));
  const monthForecastCols = MONTHS.map((m, i) => ({ key: `${m}_forecast`, label: MONTH_LABELS[i], num: true }));

  const cols = [
    ...AOP_ID_COLS,
    ...AOP_BUDGET_COLS,
    ...(showMonthly ? monthActualCols : []),
    ...(showMonthly ? monthForecastCols : []),
  ];

  return (
    <table className="tbl min-w-[1200px]" data-testid="opex-aop-table">
      <thead>
        <tr>
          {AOP_ID_COLS.map(c => <th key={c.key}>{c.label}</th>)}
          {AOP_BUDGET_COLS.map(c => <th key={c.key} className="num">{c.label}</th>)}
          {showMonthly && (
            <>
              {monthActualCols.map(c => <th key={c.key} className="num text-[10px]">{c.label} A</th>)}
              {monthForecastCols.map(c => <th key={c.key} className="num text-[10px]">{c.label} F</th>)}
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {loading && <LoadingRow cols={cols.length} />}
        {!loading && rows.length === 0 && <EmptyRow cols={cols.length} msg="No AOP lines — upload Excel to populate." />}
        {!loading && rows.map(r => (
          <tr key={r.id} data-testid={`aop-row-${r.id}`}>
            {AOP_ID_COLS.map(c => (
              <td key={c.key} className={c.mono ? "font-mono text-xs" : ""}>{r[c.key] || "—"}</td>
            ))}
            {AOP_BUDGET_COLS.map(c => (
              <td key={c.key} className="num font-mono text-xs">{formatCurrency(r[c.key] || 0, mode, inrPerUsd)}</td>
            ))}
            {showMonthly && monthActualCols.map(c => (
              <td key={c.key} className="num font-mono text-[11px]">{formatCurrency(r[c.key] || 0, mode, inrPerUsd)}</td>
            ))}
            {showMonthly && monthForecastCols.map(c => (
              <td key={c.key} className="num font-mono text-[11px] text-[var(--muted)]">{formatCurrency(r[c.key] || 0, mode, inrPerUsd)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/* ─── ZMM Table ─── */

function ZmmTable({ rows, loading, mode, inrPerUsd, onViewPo }) {
  return (
    <table className="tbl min-w-[1100px]" data-testid="opex-zmm-table">
      <thead>
        <tr>
          {ZMM_COLS.map(c => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}
          <th className="w-10" />
        </tr>
      </thead>
      <tbody>
        {loading && <LoadingRow cols={ZMM_COLS.length + 1} />}
        {!loading && rows.length === 0 && <EmptyRow cols={ZMM_COLS.length + 1} msg="No ZMM lines — upload PO register." />}
        {!loading && rows.map(r => (
          <tr key={r.id} data-testid={`zmm-row-${r.id}`} className="group">
            {ZMM_COLS.map(c => (
              <td key={c.key} className={c.num ? "num font-mono text-xs" : c.mono ? "font-mono text-xs" : ""}>
                {c.badge ? <StatusBadge value={r[c.key]} />
                  : c.num ? formatCurrency(r[c.key] || 0, mode, inrPerUsd)
                  : c.date ? formatDate(r[c.key])
                  : (r[c.key] || "—")}
              </td>
            ))}
            <td>
              <button
                className="btn-ghost opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onViewPo(r.po_number)}
                title="View PO chain"
                data-testid={`zmm-view-${r.id}`}
              >
                <Eye size={14} weight="duotone" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/* ─── PO Links Table ─── */

function LinksTable({ rows, loading, aopRows, onViewPo, onEdit, onDelete }) {
  const aopMap = useMemo(() => {
    const m = {};
    for (const a of aopRows) m[a.id] = a;
    return m;
  }, [aopRows]);

  return (
    <table className="tbl min-w-[1000px]" data-testid="opex-links-table">
      <thead>
        <tr>
          {LINK_COLS.map(c => <th key={c.key}>{c.label}</th>)}
          <th className="w-24" />
        </tr>
      </thead>
      <tbody>
        {loading && <LoadingRow cols={LINK_COLS.length + 1} />}
        {!loading && rows.length === 0 && <EmptyRow cols={LINK_COLS.length + 1} msg="No PO links — add a mapping." />}
        {!loading && rows.map(r => {
          const aop = aopMap[r.aop_line_id];
          return (
            <tr key={r.id} data-testid={`link-row-${r.id}`} className="group">
              {LINK_COLS.map(c => (
                <td key={c.key} className={c.mono ? "font-mono text-xs" : ""}>
                  {c.badge ? <StatusBadge value={r[c.key]} />
                    : c.date ? formatDate(r[c.key])
                    : c.key === "aop_line_id" ? (
                      <span title={r.aop_line_id}>
                        {aop ? (aop.wbs_element || aop.description || r.aop_line_id.slice(0, 8)) : r.aop_line_id.slice(0, 8)}…
                      </span>
                    )
                    : (r[c.key] ?? "—")}
                </td>
              ))}
              <td>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="btn-ghost" onClick={() => onViewPo(r.po_number)} title="View chain" data-testid={`link-view-${r.id}`}>
                    <Eye size={14} weight="duotone" />
                  </button>
                  <button className="btn-ghost" onClick={() => onEdit(r)} title="Edit" data-testid={`link-edit-${r.id}`}>
                    <PencilSimple size={14} weight="duotone" />
                  </button>
                  <button className="btn-ghost text-red-400" onClick={() => onDelete(r.id)} title="Delete" data-testid={`link-del-${r.id}`}>
                    <Trash size={14} weight="duotone" />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


/* ─── Corrections Table ─── */

function CorrTable({ rows, loading, onEdit, onDelete }) {
  return (
    <table className="tbl min-w-[800px]" data-testid="opex-corr-table">
      <thead>
        <tr>
          {CORR_COLS.map(c => <th key={c.key}>{c.label}</th>)}
          <th>Fields</th>
          <th className="w-20" />
        </tr>
      </thead>
      <tbody>
        {loading && <LoadingRow cols={CORR_COLS.length + 2} />}
        {!loading && rows.length === 0 && <EmptyRow cols={CORR_COLS.length + 2} msg="No corrections." />}
        {!loading && rows.map(r => (
          <tr key={r.id} data-testid={`corr-row-${r.id}`} className="group">
            {CORR_COLS.map(c => (
              <td key={c.key} className={c.mono ? "font-mono text-xs" : ""}>
                {c.badge ? <StatusBadge value={r[c.key]} />
                  : c.date ? formatDate(r[c.key])
                  : (r[c.key] ?? "—")}
              </td>
            ))}
            <td className="text-xs">
              {Object.entries(r.corrected_fields || {}).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1 mr-2 mb-0.5 px-1.5 py-0.5 bg-amber-900/10 border border-amber-700/20 text-[10px]">
                  <Tag size={9} weight="bold" className="text-amber-400" />
                  {k}: {String(v)}
                </span>
              ))}
              {Object.keys(r.corrected_fields || {}).length === 0 && "—"}
            </td>
            <td>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="btn-ghost" onClick={() => onEdit(r)} title="Edit" data-testid={`corr-edit-${r.id}`}>
                  <PencilSimple size={14} weight="duotone" />
                </button>
                <button className="btn-ghost text-red-400" onClick={() => onDelete(r.id)} title="Delete" data-testid={`corr-del-${r.id}`}>
                  <Trash size={14} weight="duotone" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}


/* ─── Upload Modal (AOP / ZMM) ─── */

function UploadModal({ type, onClose, onDone }) {
  const [uploadMode, setUploadMode] = useState("append");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const label = type === "aop" ? "AOP Lines" : "ZMM PO Register";
  const endpoint = type === "aop" ? "/opex/aop/bulk-upload" : "/opex/zmm/bulk-upload";
  const templateUrl = type === "aop" ? `${API_BASE}/opex/aop/template` : `${API_BASE}/opex/zmm/template`;

  const submit = async () => {
    if (!file) { setErr("Choose a file first"); return; }
    setBusy(true); setErr(""); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`${endpoint}?mode=${uploadMode}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      onDone();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid={`opex-${type}-upload-modal`}>
      <div className="bg-[var(--surface)] w-full max-w-lg border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">UPLOAD</div>
            <h2 className="font-display text-xl font-bold">{label}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <a className="btn-ghost text-xs flex items-center gap-1 w-fit" href={templateUrl}>
            <DownloadSimple size={12} weight="bold" /> Download template
          </a>
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`px-3 py-2 text-xs border transition-all ${uploadMode === "append"
                  ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/5"
                  : "border-[var(--border)] text-[var(--muted)]"}`}
                onClick={() => setUploadMode("append")}
              >
                Append
              </button>
              <button
                className={`px-3 py-2 text-xs border transition-all ${uploadMode === "replace"
                  ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/5"
                  : "border-[var(--border)] text-[var(--muted)]"}`}
                onClick={() => setUploadMode("replace")}
              >
                Replace All
              </button>
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">File</div>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs" data-testid={`opex-${type}-file-input`} />
          </div>
          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-900/10 border border-red-700/30 text-red-400 text-xs">
              <Warning size={14} className="shrink-0 mt-0.5" /> {err}
            </div>
          )}
          {result && (
            <div className="p-3 bg-emerald-900/10 border border-emerald-700/30 text-emerald-400 text-xs">
              Inserted {result.inserted} rows.{result.skipped > 0 && ` Skipped ${result.skipped}.`}
            </div>
          )}
          <button className="btn-primary w-full flex items-center justify-center gap-2 text-sm" onClick={submit} disabled={busy}>
            {busy && <CircleNotch size={14} className="animate-spin" />}
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ─── PO Link Modal ─── */

function PoLinkModal({ existing, aopRows, onClose, onDone }) {
  const [form, setForm] = useState(() => existing ? { ...existing } : {
    aop_line_id: "", po_number: "", po_item: "",
    start_date: "", end_date: "",
    predecessor_po: "", successor_po: "",
    sequence_order: 1, notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.aop_line_id || !form.po_number) { setErr("AOP Line and PO Number are required."); return; }
    setBusy(true); setErr("");
    try {
      if (existing) {
        await api.put(`/opex/po-links/${existing.id}`, form);
      } else {
        await api.post("/opex/po-links", form);
      }
      onDone();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="opex-link-modal">
      <div className="bg-[var(--surface)] w-full max-w-xl border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">PO LINK</div>
            <h2 className="font-display text-xl font-bold">{existing ? "Edit PO Link" : "Add PO Link"}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">AOP Line *</label>
              <select className="input text-xs w-full" value={form.aop_line_id} onChange={e => set("aop_line_id", e.target.value)} data-testid="link-aop-select">
                <option value="">— Select —</option>
                {aopRows.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.wbs_element || a.description || a.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">PO Number *</label>
              <input className="input text-xs w-full" value={form.po_number} onChange={e => set("po_number", e.target.value)} data-testid="link-po-number" />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">PO Item</label>
              <input className="input text-xs w-full" value={form.po_item} onChange={e => set("po_item", e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">Sequence #</label>
              <input type="number" className="input text-xs w-full" value={form.sequence_order} onChange={e => set("sequence_order", parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">Start Date</label>
              <input type="date" className="input text-xs w-full" value={form.start_date || ""} onChange={e => set("start_date", e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">End Date</label>
              <input type="date" className="input text-xs w-full" value={form.end_date || ""} onChange={e => set("end_date", e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">Predecessor PO</label>
              <input className="input text-xs w-full" value={form.predecessor_po || ""} onChange={e => set("predecessor_po", e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">Successor PO</label>
              <input className="input text-xs w-full" value={form.successor_po || ""} onChange={e => set("successor_po", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">Notes</label>
            <textarea className="input text-xs w-full" rows={2} value={form.notes || ""} onChange={e => set("notes", e.target.value)} />
          </div>
          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-900/10 border border-red-700/30 text-red-400 text-xs">
              <Warning size={14} className="shrink-0 mt-0.5" /> {err}
            </div>
          )}
          <button className="btn-primary w-full flex items-center justify-center gap-2 text-sm" onClick={submit} disabled={busy}>
            {busy && <CircleNotch size={14} className="animate-spin" />}
            {busy ? "Saving…" : existing ? "Update Link" : "Create Link"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ─── Correction Modal ─── */

function CorrectionModal({ existing, onClose, onDone }) {
  const [form, setForm] = useState(() => existing ? {
    po_number: existing.po_number || "",
    po_item: existing.po_item || "",
    reason: existing.reason || "",
    active: existing.active ?? true,
    fieldsRaw: Object.entries(existing.corrected_fields || {}).map(([k, v]) => ({ key: k, value: String(v) })),
  } : {
    po_number: "", po_item: "", reason: "", active: true,
    fieldsRaw: [{ key: "", value: "" }],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setField = (i, k, v) => setForm(f => {
    const next = [...f.fieldsRaw];
    next[i] = { ...next[i], [k]: v };
    return { ...f, fieldsRaw: next };
  });
  const addField = () => setForm(f => ({ ...f, fieldsRaw: [...f.fieldsRaw, { key: "", value: "" }] }));
  const removeField = (i) => setForm(f => ({ ...f, fieldsRaw: f.fieldsRaw.filter((_, j) => j !== i) }));

  const submit = async () => {
    if (!form.po_number) { setErr("PO Number is required."); return; }
    const corrected_fields = {};
    for (const f of form.fieldsRaw) {
      if (f.key.trim()) corrected_fields[f.key.trim()] = f.value;
    }
    if (Object.keys(corrected_fields).length === 0) { setErr("Add at least one corrected field."); return; }
    setBusy(true); setErr("");
    try {
      const payload = { po_number: form.po_number, po_item: form.po_item || null, reason: form.reason, corrected_fields };
      if (existing) {
        await api.put(`/opex/corrections/${existing.id}`, { ...payload, active: form.active });
      } else {
        await api.post("/opex/corrections", payload);
      }
      onDone();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="opex-corr-modal">
      <div className="bg-[var(--surface)] w-full max-w-xl border border-[var(--border)] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)] sticky top-0 bg-[var(--surface)] z-10">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">ZMM CORRECTION</div>
            <h2 className="font-display text-xl font-bold">{existing ? "Edit Correction" : "Add Correction"}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">PO Number *</label>
              <input className="input text-xs w-full" value={form.po_number} onChange={e => set("po_number", e.target.value)} data-testid="corr-po-number" />
            </div>
            <div>
              <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">PO Item</label>
              <input className="input text-xs w-full" value={form.po_item} onChange={e => set("po_item", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">Reason</label>
            <input className="input text-xs w-full" value={form.reason} onChange={e => set("reason", e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] tracking-overline text-[var(--muted)]">Corrected Fields</label>
              <button className="btn-ghost text-[10px] flex items-center gap-1 text-[var(--gold)]" onClick={addField}>
                <Plus size={10} weight="bold" /> Add Field
              </button>
            </div>
            <div className="space-y-2">
              {form.fieldsRaw.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input text-xs flex-1"
                    placeholder="Field name (e.g. po_value)"
                    value={f.key}
                    onChange={e => setField(i, "key", e.target.value)}
                  />
                  <input
                    className="input text-xs flex-1"
                    placeholder="Corrected value"
                    value={f.value}
                    onChange={e => setField(i, "value", e.target.value)}
                  />
                  {form.fieldsRaw.length > 1 && (
                    <button className="btn-ghost text-red-400" onClick={() => removeField(i)}>
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {existing && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} />
              Active
            </label>
          )}
          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-900/10 border border-red-700/30 text-red-400 text-xs">
              <Warning size={14} className="shrink-0 mt-0.5" /> {err}
            </div>
          )}
          <button className="btn-primary w-full flex items-center justify-center gap-2 text-sm" onClick={submit} disabled={busy}>
            {busy && <CircleNotch size={14} className="animate-spin" />}
            {busy ? "Saving…" : existing ? "Update Correction" : "Create Correction"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ─── PO Detail Drawer ─── */

function PoDetailDrawer({ poNumber, mode, inrPerUsd, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPo, setSelectedPo] = useState(poNumber);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    setErr("");
    api.get(`/opex/po-chain/${encodeURIComponent(poNumber)}`)
      .then(r => {
        setData(r.data);
        setSelectedPo(poNumber);
      })
      .catch(e => setErr(e.response?.data?.detail || "Failed to load PO chain"))
      .finally(() => setLoading(false));
  }, [poNumber]);

  const chainPOs = useMemo(() => {
    if (!data?.chain) return [];
    const seen = new Set();
    return data.chain
      .filter(l => { if (seen.has(l.po_number)) return false; seen.add(l.po_number); return true; })
      .sort((a, b) => (a.start_date || a.created_at || "").localeCompare(b.start_date || b.created_at || ""));
  }, [data]);

  const selectedZmmRows = useMemo(() => {
    if (!data?.zmm_details) return [];
    return data.zmm_details.filter(z => z.po_number === selectedPo);
  }, [data, selectedPo]);

  const allZmmSummary = useMemo(() => {
    if (!data?.zmm_details || chainPOs.length <= 1) return null;
    const byPo = {};
    for (const z of data.zmm_details) {
      if (!byPo[z.po_number]) byPo[z.po_number] = { po_number: z.po_number, po_value: 0, gr_value: 0, invoice_value: 0, open_value: 0, lines: 0 };
      byPo[z.po_number].po_value += z.po_value || 0;
      byPo[z.po_number].gr_value += z.gr_value || 0;
      byPo[z.po_number].invoice_value += z.invoice_value || 0;
      byPo[z.po_number].open_value += z.open_value || 0;
      byPo[z.po_number].lines += 1;
    }
    return Object.values(byPo);
  }, [data, chainPOs]);

  const aopLines = data?.aop_lines || [];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        className="fixed top-0 right-0 h-full w-full max-w-[520px] bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl"
        style={{ animation: "slideInRight 200ms ease-out" }}
        data-testid="opex-po-drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)] shrink-0">
          <div className="min-w-0">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">PO CHAIN DETAIL</div>
            <h2 className="font-display text-xl font-bold truncate">{poNumber}</h2>
          </div>
          <button className="btn-ghost shrink-0" onClick={onClose} aria-label="Close drawer"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-[var(--muted)]">
              <CircleNotch size={20} className="animate-spin mr-2" /> Loading…
            </div>
          )}
          {err && (
            <div className="p-3 bg-red-900/10 border border-red-700/30 text-red-400 text-xs">{err}</div>
          )}
          {!loading && !err && data && (
            <>
              {/* Chain timeline */}
              {chainPOs.length > 1 && (
                <div>
                  <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">PO CHAIN ({chainPOs.length} POs)</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {chainPOs.map((po, i) => (
                      <React.Fragment key={po.po_number}>
                        <button
                          className={`px-2.5 py-1 text-xs font-mono border transition-all ${po.po_number === selectedPo
                            ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10 font-semibold"
                            : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}
                          onClick={() => setSelectedPo(po.po_number)}
                          data-testid={`drawer-chain-${po.po_number}`}
                        >
                          {po.po_number}
                        </button>
                        {i < chainPOs.length - 1 && <ArrowRight size={12} className="text-[var(--muted)]" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {/* PO Selector dropdown (alternative for long chains) */}
              {chainPOs.length > 1 && (
                <div>
                  <label className="text-[10px] tracking-overline text-[var(--muted)] mb-1 block">SELECT PO</label>
                  <select
                    className="input text-xs w-full font-mono"
                    value={selectedPo}
                    onChange={e => setSelectedPo(e.target.value)}
                    data-testid="drawer-po-select"
                  >
                    {chainPOs.map(po => (
                      <option key={po.po_number} value={po.po_number}>
                        {po.po_number} ({formatDate(po.start_date)} → {formatDate(po.end_date)})
                        {po.is_active ? " ● Active" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Summary table when multiple POs */}
              {allZmmSummary && (
                <div>
                  <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">PO SUMMARY</div>
                  <table className="tbl text-xs" data-testid="drawer-summary-table">
                    <thead>
                      <tr>
                        <th>PO #</th>
                        <th className="num">PO Value</th>
                        <th className="num">GR Value</th>
                        <th className="num">Invoice</th>
                        <th className="num">Open</th>
                        <th>Lines</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allZmmSummary.map(s => (
                        <tr
                          key={s.po_number}
                          className={`cursor-pointer ${s.po_number === selectedPo ? "bg-[var(--gold)]/5" : ""}`}
                          onClick={() => setSelectedPo(s.po_number)}
                        >
                          <td className="font-mono">{s.po_number}</td>
                          <td className="num font-mono">{formatCurrency(s.po_value, mode, inrPerUsd)}</td>
                          <td className="num font-mono">{formatCurrency(s.gr_value, mode, inrPerUsd)}</td>
                          <td className="num font-mono">{formatCurrency(s.invoice_value, mode, inrPerUsd)}</td>
                          <td className="num font-mono">{formatCurrency(s.open_value, mode, inrPerUsd)}</td>
                          <td>{s.lines}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Selected PO detail (ZMM lines) */}
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">
                  {chainPOs.length <= 1 ? "PO DETAIL" : `DETAIL — ${selectedPo}`}
                </div>
                {selectedZmmRows.length === 0 && (
                  <div className="text-xs text-[var(--muted)] py-4">No ZMM rows for this PO.</div>
                )}
                {selectedZmmRows.map((z, i) => (
                  <div key={z.id || i} className="border border-[var(--border)] mb-3 last:mb-0" data-testid={`drawer-zmm-${z.id}`}>
                    <div className="px-4 py-2 bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold">{z.po_number} / {z.po_item || "—"}</span>
                      <StatusBadge value={z.triage_status} />
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <DetailRow label="Vendor" value={`${z.vendor_name || "—"} (${z.vendor_code || "—"})`} />
                      <DetailRow label="Material" value={z.material} />
                      <DetailRow label="Description" value={z.short_text} />
                      <DetailRow label="WBS Element" value={z.wbs_element} mono />
                      <DetailRow label="Cost Centre" value={z.cost_centre} />
                      <DetailRow label="GL Account" value={z.gl_account} mono />
                      <div className="border-t border-[var(--border)] pt-2 mt-2" />
                      <CurrRow label="PO Value" value={z.po_value} field="po_value" corrections={z._corrections} originals={z} mode={mode} inrPerUsd={inrPerUsd} />
                      <CurrRow label="GR Value" value={z.gr_value} field="gr_value" corrections={z._corrections} originals={z} mode={mode} inrPerUsd={inrPerUsd} />
                      <CurrRow label="Invoice Value" value={z.invoice_value} field="invoice_value" corrections={z._corrections} originals={z} mode={mode} inrPerUsd={inrPerUsd} />
                      <CurrRow label="Open Value" value={z.open_value} field="open_value" corrections={z._corrections} originals={z} mode={mode} inrPerUsd={inrPerUsd} />
                      <div className="border-t border-[var(--border)] pt-2 mt-2" />
                      <DetailRow label="PO Date" value={formatDate(z.po_date)} />
                      <DetailRow label="Start Date" value={formatDate(z.start_date)} />
                      <DetailRow label="End Date" value={formatDate(z.end_date)} />
                      <DetailRow label="Delivery Date" value={formatDate(z.delivery_date)} />
                      <DetailRow label="Plant" value={z.plant} />
                      <DetailRow label="Currency" value={z.currency} />
                      <DetailRow label="Purchasing Group" value={z.purchasing_group} />

                      {/* Correction tags */}
                      {z._corrections && z._corrections.length > 0 && (
                        <div className="border-t border-[var(--border)] pt-2 mt-2">
                          <div className="text-[10px] tracking-overline text-amber-400 mb-1 flex items-center gap-1">
                            <Tag size={10} weight="bold" /> CORRECTIONS APPLIED
                          </div>
                          {z._corrections.map((c, ci) => (
                            <div key={ci} className="flex items-center gap-2 text-[11px] py-0.5">
                              <span className="text-[var(--muted)]">{c.field}:</span>
                              <span className="line-through text-red-400/70">{String(z[`_orig_${c.field}`] ?? "—")}</span>
                              <ArrowRight size={10} className="text-[var(--muted)]" />
                              <span className="text-emerald-400 font-semibold">{String(z[c.field] ?? "—")}</span>
                              {c.reason && <span className="text-[var(--muted)] italic">({c.reason})</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Linked AOP lines */}
              {aopLines.length > 0 && (
                <div>
                  <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">LINKED AOP LINES</div>
                  {aopLines.map(a => (
                    <div key={a.id} className="border border-[var(--border)] p-3 mb-2 last:mb-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-xs font-semibold">{a.wbs_element || "—"}</span>
                        <span className="text-[10px] text-[var(--muted)]">{a.department}</span>
                      </div>
                      <div className="text-xs text-[var(--muted)] mb-1">{a.description || "—"}</div>
                      <div className="flex gap-4 text-xs">
                        <span>Budget: <span className="font-mono font-semibold">{formatCurrency(a.original_budget, mode, inrPerUsd)}</span></span>
                        <span>YTD: <span className="font-mono font-semibold">{formatCurrency(a.ytd_actual, mode, inrPerUsd)}</span></span>
                        <span>FY Est: <span className="font-mono font-semibold">{formatCurrency(a.full_year_estimate, mode, inrPerUsd)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}


/* ─── Drawer helpers ─── */

function DetailRow({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-[var(--muted)] shrink-0">{label}</span>
      <span className={`text-right ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

function CurrRow({ label, value, field, corrections, originals, mode, inrPerUsd }) {
  const isCorrected = corrections?.some(c => c.field === field);
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-[var(--muted)] shrink-0 flex items-center gap-1">
        {label}
        {isCorrected && <Tag size={9} weight="bold" className="text-amber-400" />}
      </span>
      <span className="font-mono font-semibold text-right">
        {formatCurrency(value || 0, mode, inrPerUsd)}
      </span>
    </div>
  );
}
