import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatDate } from "@/aop/format";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { STAGES } from "@/config/stages";
import StatTile from "@/components/common/StatTile";
import {
  Plus, MagnifyingGlass, FunnelSimple, PencilSimple, UploadSimple,
  DownloadSimple, Briefcase, CurrencyInr, TrendUp, ChartPie,
  CaretDown, Warning, ShieldCheck, Eye, X, ArrowsClockwise,
} from "@phosphor-icons/react";
import ProjectFormModal from "@/components/ProjectFormModal";
import { useCan } from "@/lib/permissions";

const CR_KEYWORDS = /change\s*request|cr\b|change\s*order|co\b|amendment/i;
function isChangeRequest(p) {
  return CR_KEYWORDS.test(p.category1 || "");
}

function stageColor(s) {
  const map = {
    Pipeline: "var(--muted)",
    "Deal P&L": "var(--gold)",
    "Customer PO": "#3b82f6",
    Operations: "var(--success, #22c55e)",
    Closure: "#a855f7",
  };
  return map[s] || "var(--muted)";
}

export default function ProjectsPage() {
  const { unit } = useCurrency();
  const navigate = useNavigate();
  const canEdit = useCan("projects", "edit");
  const [aop, setAop] = useState({ projects: {} }); // AOP / actual figures of the AOP-linked projects
  const [syncMsg, setSyncMsg] = useState("");
  const [projects, setProjects] = useState([]);
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [sortCol, setSortCol] = useState("project_name");
  const [sortDir, setSortDir] = useState(1);
  const fileRef = useRef();

  const load = async () => {
    const params = {};
    if (stage) params.stage = stage;
    if (search) params.search = search;
    const { data } = await api.get("/projects", { params });
    setProjects(data.filter((p) => !isChangeRequest(p)));
  };

  const loadAop = () => api.get("/aop/projects/summary").then((r) => setAop(r.data)).catch(() => {});
  useEffect(() => {
    load();
    loadAop();
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, [stage]); // eslint-disable-line

  const syncAop = async () => {
    setSyncMsg("Syncing…");
    try {
      const { data } = await api.post("/aop/projects/sync");
      setSyncMsg(`${data.created} added · ${data.linked} linked · ${data.candidates} in the AOP / package`);
      load(); loadAop();
    } catch (e) {
      setSyncMsg(e.response?.data?.detail || e.message);
    }
  };

  const filtered = useMemo(() => {
    let out = projects.filter((p) => {
      const d = (p.po_date || p.start_date || "").slice(0, 10);
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      return true;
    });
    out.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number") return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });
    return out;
  }, [projects, dateFrom, dateTo, sortCol, sortDir]);

  const stats = useMemo(() => {
    let totalPO = 0, totalRev = 0, totalCost = 0, lowMargin = 0;
    for (const p of filtered) {
      totalPO += Number(p.po_value || 0);
      totalRev += Number(p.revenue_total || 0);
      totalCost += Number(p.cost_total || 0);
      if ((p.margin_pct || 0) < 15) lowMargin++;
    }
    const margin = totalRev ? ((totalRev - totalCost) / totalRev * 100) : 0;
    return { count: filtered.length, totalPO, totalRev, totalCost, margin, lowMargin };
  }, [filtered]);

  const byStage = useMemo(() => {
    const map = {};
    for (const s of STAGES) map[s] = 0;
    for (const p of filtered) map[p.current_stage] = (map[p.current_stage] || 0) + 1;
    return map;
  }, [filtered]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d * -1);
    else { setSortCol(col); setSortDir(1); }
  };
  const SortIcon = ({ col }) => {
    if (sortCol !== col) return null;
    return <CaretDown size={10} weight="bold" className={`inline ml-0.5 transition-transform ${sortDir < 0 ? "rotate-180" : ""}`} />;
  };

  const downloadTemplate = async () => {
    const r = await api.get("/uploads/template/project", { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a"); a.href = url; a.download = "project_template.xlsx"; a.click();
    window.URL.revokeObjectURL(url);
  };

  const onUpload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post("/uploads/project", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setUploadResult(data);
      load();
    } catch (e) {
      setUploadResult({ error: e.response?.data?.detail || e.message });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div data-testid="projects-page">
      <PageHeader
        title="Projects"
        subtitle="End-to-end commercial lifecycle"
        breadcrumb="HOME · PROJECTS"
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <button className="btn-secondary text-xs flex items-center gap-1" onClick={syncAop} title="Bring the AOP workbook / reporting package projects into this list" data-testid="sync-aop-projects-btn">
                <ArrowsClockwise size={12} weight="bold" /> Sync from AOP
              </button>
            )}
            <button className="btn-secondary text-xs flex items-center gap-1" onClick={downloadTemplate} data-testid="dl-project-template">
              <DownloadSimple size={12} weight="bold" /> Template
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} data-testid="project-upload-input" />
            <button className="btn-secondary text-xs flex items-center gap-1" onClick={() => fileRef.current?.click()} data-testid="upload-projects-btn">
              <UploadSimple size={12} weight="bold" /> Upload Excel
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)} data-testid="new-project-btn">
              <Plus size={14} weight="bold" /> New Project
            </button>
          </div>
        }
      />

      {syncMsg && (
        <div className="mx-8 mt-5 tile p-3 flex items-center justify-between text-sm" data-testid="sync-aop-result">
          <span>{syncMsg}</span><button className="btn-ghost text-xs" onClick={() => setSyncMsg("")}>Dismiss</button>
        </div>
      )}

      {uploadResult && (
        <div className="mx-8 mt-5 tile p-4" data-testid="project-upload-result">
          {uploadResult.error ? (
            <div className="text-sm text-[var(--danger)]">Upload failed: {uploadResult.error}</div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-semibold">{uploadResult.success_rows}</span> created ·{" "}
                <span className="text-[var(--danger)] font-semibold">{uploadResult.failed_rows}</span> failed ·{" "}
                <span className="text-[var(--muted)]">file: {uploadResult.file_name}</span>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setUploadResult(null)}>Dismiss</button>
            </div>
          )}
        </div>
      )}

      <div className="px-8 py-5 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="project-stats">
          <StatTile label="Active Projects" value={stats.count} icon={Briefcase} testid="stat-count" />
          <StatTile label="Total PO Value" value={formatMoney(stats.totalPO, unit)} icon={CurrencyInr} testid="stat-po-value" />
          <StatTile label="Total Revenue" value={formatMoney(stats.totalRev, unit)} icon={TrendUp} testid="stat-revenue" />
          <StatTile label="Total Cost" value={formatMoney(stats.totalCost, unit)} testid="stat-cost" />
          <StatTile label="Blended Margin" value={`${stats.margin.toFixed(1)}%`} accent={stats.margin >= 15} danger={stats.margin < 15} icon={ChartPie} testid="stat-margin" />
          <StatTile label="Low Margin (<15%)" value={stats.lowMargin} danger={stats.lowMargin > 0} icon={Warning} testid="stat-low-margin" />
        </div>

        {/* Stage Pipeline Bar */}
        <div className="tile p-4" data-testid="stage-pipeline">
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-3">Pipeline by Stage</div>
          <div className="flex gap-1 h-2 overflow-hidden" style={{ borderRadius: 1 }}>
            {STAGES.map((s) => {
              const pct = stats.count ? (byStage[s] / stats.count * 100) : 0;
              if (!pct) return null;
              return <div key={s} style={{ width: `${pct}%`, background: stageColor(s), minWidth: 4 }} title={`${s}: ${byStage[s]}`} />;
            })}
          </div>
          <div className="flex flex-wrap gap-4 mt-2">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => setStage(stage === s ? "" : s)}
                className={`flex items-center gap-1.5 text-[11px] transition-all ${stage === s ? "font-semibold" : "opacity-70 hover:opacity-100"}`}
                data-testid={`stage-${s.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}
              >
                <span className="w-2 h-2" style={{ background: stageColor(s) }} />
                {s}
                <span className="font-mono text-[10px] text-[var(--muted)]">{byStage[s]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="tile p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 h-9"
              placeholder="Search by project, WBS or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              data-testid="project-search"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-overline text-[var(--muted)]">Date</span>
            <input type="date" className="input h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="projects-date-from" />
            <span className="text-xs text-[var(--muted)]">to</span>
            <input type="date" className="input h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="projects-date-to" />
            {(dateFrom || dateTo) && (
              <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => { setDateFrom(""); setDateTo(""); }} data-testid="projects-date-clear">
                <X size={10} /> Clear
              </button>
            )}
          </div>

          <button className="btn-secondary h-9 text-xs" onClick={load} data-testid="apply-search-btn">
            <MagnifyingGlass size={12} weight="bold" /> Search
          </button>

          <div className="ml-auto text-[11px] text-[var(--muted)]">
            {filtered.length} of {projects.length}
          </div>
        </div>

        {/* Table */}
        <div className="tile overflow-hidden">
          <table className="tbl" data-testid="projects-table">
            <thead>
              <tr>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("project_name")}>Project <SortIcon col="project_name" /></th>
                <th>WBS / PO</th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("customer_name")}>Customer <SortIcon col="customer_name" /></th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("current_stage")}>Stage <SortIcon col="current_stage" /></th>
                <th>Flags</th>
                <th>Approval</th>
                <th className="num" title={`${aop.plan_fy || "Plan year"} AOP revenue`}>AOP Rev (FY)</th>
                <th className="num" title="Actual revenue to the latest closed month">Actual Rev (YTD)</th>
                <th className="num" title="Actual gross margin to the latest closed month: revenue less TP opex and direct resource cost">Actual GM %</th>
                <th className="num cursor-pointer select-none" onClick={() => toggleSort("po_value")}>PO Value <SortIcon col="po_value" /></th>
                <th className="num cursor-pointer select-none" onClick={() => toggleSort("revenue_total")}>Revenue <SortIcon col="revenue_total" /></th>
                <th className="num cursor-pointer select-none" onClick={() => toggleSort("cost_total")}>Cost <SortIcon col="cost_total" /></th>
                <th className="num cursor-pointer select-none" onClick={() => toggleSort("margin_pct")}>Margin % <SortIcon col="margin_pct" /></th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("end_date")}>End Date <SortIcon col="end_date" /></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/app/projects/${p.id}`)} data-testid={`project-row-${p.id}`}>
                  <td>
                    <div className="font-medium text-[var(--text)]">{p.project_name}{p.aop_project_id && <span className="chip !text-[9.5px] ml-1.5 align-middle" title={`AOP / package project ${p.aop_project_id}`}>AOP</span>}</div>
                    <div className="text-[11px] text-[var(--muted)]">{p.business_category} · {p.location}</div>
                  </td>
                  <td className="font-mono text-xs">
                    <div>{p.wbs_element || "—"}</div>
                    <div className="text-[var(--muted)]">{p.customer_po_number || ""}</div>
                  </td>
                  <td>{p.customer_name || "—"}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] tracking-overline font-semibold" style={{ background: `color-mix(in srgb, ${stageColor(p.current_stage)} 18%, transparent)`, color: stageColor(p.current_stage) }}>
                      <span className="w-1.5 h-1.5" style={{ background: stageColor(p.current_stage) }} />
                      {p.current_stage}
                    </span>
                  </td>
                  <td className="space-x-1 space-y-1">
                    {p.business_category && <span className={`badge ${p.business_category === "GMR" ? "flag-gmr" : "flag-non-gmr"}`}>{p.business_category}</span>}
                    {p.strategic_deal && <span className="badge flag-high" title="Strategic Deal">STRATEGIC</span>}
                    {p.md_review_required && <span className="badge flag-low-margin" title="MD Review">MD</span>}
                    {p.cfo_review_required && <span className="badge flag-low-margin" title="CFO Review">CFO</span>}
                    {p.ceo_visibility && <span className="badge flag-low-margin" title="CEO Visibility">CEO</span>}
                  </td>
                  <td><StatusBadge status={p.approval_status} /></td>
                  {(() => {
                    const a = aop.projects?.[p.id];
                    return a?.linked ? (
                      <>
                        <td className="num" data-testid={`aop-rev-${p.id}`}>{formatMoney(a.rev_aop_fy, unit)}</td>
                        <td className="num">{formatMoney(a.rev_act_ytd, unit)}</td>
                        <td className={`num ${a.gm_pct_ytd !== null && a.gm_pct_ytd < 0.15 ? "text-[var(--danger)]" : ""}`}>{a.gm_pct_ytd === null || a.gm_pct_ytd === undefined ? "—" : `${(a.gm_pct_ytd * 100).toFixed(1)}%`}</td>
                      </>
                    ) : <><td className="num text-[var(--muted)]">—</td><td className="num text-[var(--muted)]">—</td><td className="num text-[var(--muted)]">—</td></>;
                  })()}
                  <td className="num">{formatMoney(p.po_value, unit)}</td>
                  <td className="num">{formatMoney(p.revenue_total, unit)}</td>
                  <td className="num">{formatMoney(p.cost_total, unit)}</td>
                  <td className={`num font-semibold ${(p.margin_pct || 0) < 15 ? "text-[var(--danger)]" : ""}`}>{(p.margin_pct || 0).toFixed(1)}%</td>
                  <td className="text-xs">{formatDate(p.end_date)}</td>
                  <td className="text-right">
                    <button
                      className="btn-ghost"
                      title="Edit project"
                      onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                      data-testid={`project-edit-${p.id}`}
                    >
                      <PencilSimple size={16} weight="duotone" className="text-[var(--gold)]" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={15} className="text-center py-12 text-[var(--muted)]">
                  No projects found. Click <span className="text-[var(--gold)]">New Project</span> to create one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <ProjectFormModal
          customers={customers}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
      {editing && (
        <ProjectFormModal
          project={editing}
          customers={customers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
