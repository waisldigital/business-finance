import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatNumber } from "@/aop/format";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight, TrendUp, Warning, Buildings, Truck, FunnelSimple,
  CurrencyInr, ChartPie, Receipt, CaretDown, X, Percent,
} from "@phosphor-icons/react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";

const SECTIONS = [
  { key: "", label: "All" },
  { key: "projects", label: "Projects" },
  { key: "change_requests", label: "Change Requests" },
];

const CHART_PALETTE = [
  "#C9A227", "#5C2B84", "#3CA67A", "#E07A3C", "#3D8B7A",
  "#7BB661", "#D9A45B", "#7B3F00", "#8B9A2B", "#C46A3C",
];
const STAGE_COLORS = ["#E07A3C", "#FFC000", "#7BB661", "#5C2B84", "#7B3F00"];

export default function DashboardPage() {
  const { unit } = useCurrency();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [section, setSection] = useState("");
  const [customerIds, setCustomerIds] = useState([]);
  const [projectIds, setProjectIds] = useState([]);
  const [businessCategory, setBusinessCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const customerKey = customerIds.join(",");
  const projectKey = projectIds.join(",");
  const hasFilters = !!(section || customerKey || projectKey || businessCategory || dateFrom || dateTo);

  const fetchData = useCallback(() => {
    const params = {};
    if (section) params.section = section;
    if (customerKey) params.customer_ids = customerKey;
    if (projectKey) params.project_ids = projectKey;
    if (businessCategory) params.business_category = businessCategory;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.get("/dashboard/summary", { params }).then((r) => setData(r.data)).catch(() => {});
  }, [section, customerKey, projectKey, businessCategory, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filterOptions = data?.filter_options || { customers: [], projects: [] };
  const availableProjects = useMemo(() => {
    if (!customerIds.length) return filterOptions.projects;
    return filterOptions.projects.filter((p) => customerIds.includes(p.customer_id));
  }, [filterOptions.projects, customerIds]);

  if (!data) {
    return (
      <div data-testid="dashboard-page">
        <PageHeader compact title="Finance Dashboard" subtitle="Loading..." testid="dashboard-header" />
        <div className="px-6 py-4 grid grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 skeleton" />)}
        </div>
      </div>
    );
  }

  const { totals, stage_summary, recognized_unbilled, top_customers, vendor_exposure, monthly_billing,
    delayed_milestones = [], low_margin_projects, approvals_pending } = data;

  const stageChart = stage_summary.map((s) => ({ name: s.stage, count: s.count, value: s.po_value / 1e7 }));
  const monthChart = monthly_billing.map((m) => ({
    month: m.month, billed: m.billed / 1e7, recognized: m.recognized / 1e7,
  }));
  const totalVendor = (vendor_exposure || []).reduce((s, v) => s + (v.amount || 0), 0) || 1;

  const clearAll = () => {
    setSection(""); setCustomerIds([]); setProjectIds([]);
    setBusinessCategory(""); setDateFrom(""); setDateTo("");
  };

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        compact
        title="Finance Dashboard"
        subtitle="Live overview of projects, pipeline, change requests and margins"
        breadcrumb="HOME · DASHBOARD"
        testid="dashboard-header"
        actions={
          <button
            className={`btn-ghost text-xs flex items-center gap-1.5 ${hasFilters ? "text-[var(--gold)]" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
            data-testid="dashboard-toggle-filters"
          >
            <FunnelSimple size={13} weight={hasFilters ? "fill" : "regular"} />
            Filters{hasFilters ? " (active)" : ""}
            <CaretDown size={10} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
          </button>
        }
      />

      <div className="px-6 py-4 space-y-4">
        {/* Collapsible Filters */}
        {filtersOpen && (
          <div className="tile p-3" data-testid="dashboard-filters">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 items-end">
              <div>
                <div className="text-[9px] tracking-overline text-[var(--muted)] mb-0.5">Section</div>
                <select className="input h-8 text-xs" value={section} onChange={(e) => { setSection(e.target.value); setProjectIds([]); }} data-testid="filter-section">
                  {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[9px] tracking-overline text-[var(--muted)] mb-0.5">Customer</div>
                <MultiSelect value={customerIds} options={filterOptions.customers.map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(v) => { setCustomerIds(v); setProjectIds([]); }} placeholder="Any" testid="filter-customers" />
              </div>
              <div>
                <div className="text-[9px] tracking-overline text-[var(--muted)] mb-0.5">Project / WBS</div>
                <MultiSelect value={projectIds} options={availableProjects.map((p) => ({ value: p.id, label: p.wbs_element ? `${p.name} · ${p.wbs_element}` : p.name }))}
                  onChange={setProjectIds} placeholder="Any" testid="filter-projects" />
              </div>
              <div>
                <div className="text-[9px] tracking-overline text-[var(--muted)] mb-0.5">Category</div>
                <select className="input h-8 text-xs" value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} data-testid="filter-business-category">
                  <option value="">Both</option>
                  <option value="GMR">GMR</option>
                  <option value="Non-GMR">Non-GMR</option>
                </select>
              </div>
              <div>
                <div className="text-[9px] tracking-overline text-[var(--muted)] mb-0.5">Date Range</div>
                <div className="flex items-center gap-1">
                  <input type="date" className="input h-8 text-xs flex-1 min-w-0" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="filter-date-from" />
                  <span className="text-[9px] text-[var(--muted)]">→</span>
                  <input type="date" className="input h-8 text-xs flex-1 min-w-0" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="filter-date-to" />
                </div>
              </div>
              <div className="flex items-end">
                {hasFilters && (
                  <button className="btn-ghost text-xs flex items-center gap-1 h-8" onClick={clearAll} data-testid="dashboard-filter-clear">
                    <X size={10} /> Clear all
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* KPI Strip — compact single row */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2" data-testid="dashboard-kpis">
          <Kpi label="Projects" value={formatNumber(totals.total_projects)} sub={`${stage_summary.length} stages`}
               icon={Buildings} onClick={() => navigate("/app/projects")} testid="kpi-total-projects" />
          <Kpi label="PO Value" value={formatMoney(totals.total_po_value, unit)} sub={`Rev ${formatMoney(totals.total_revenue, unit)}`}
               icon={CurrencyInr} onClick={() => navigate("/app/projects")} testid="kpi-total-po" />
          <Kpi label="Margin" value={formatMoney(totals.total_margin, unit)} sub={`${totals.margin_pct.toFixed(1)}% blended`}
               icon={Percent} accent onClick={() => navigate("/app/projects")} testid="kpi-total-margin" />
          <Kpi label="Unbilled" value={formatMoney(recognized_unbilled.unbilled, unit)} sub={`Billed ${formatMoney(recognized_unbilled.billed, unit)}`}
               icon={Receipt} onClick={() => navigate("/app/projects")} testid="kpi-unbilled" />
          <Kpi label="Delayed" value={delayed_milestones.length} sub={`${low_margin_projects.length} low-margin`}
               icon={Warning} danger={delayed_milestones.length > 0}
               onClick={() => document.getElementById("delayed-milestones-section")?.scrollIntoView({ behavior: "smooth" })} testid="kpi-delayed" />
          <Kpi label="Approvals" value={approvals_pending} sub="Pending action"
               icon={TrendUp} danger={approvals_pending > 0}
               onClick={() => navigate("/admin/approvals")} testid="kpi-approvals" />
        </div>

        {/* Charts — billing + funnel side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="tile p-4 lg:col-span-3" data-testid="chart-monthly-billing">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-0.5">Monthly Billing Trend</div>
            <div className="font-display text-sm font-bold mb-3">Recognized vs Billed (Cr)</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthChart} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-soft)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 2, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 11, padding: "4px 8px" }} />
                <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                <Line type="monotone" dataKey="recognized" name="Recognized" stroke="#5C2B84" strokeWidth={2} dot={{ r: 2, fill: "#5C2B84" }} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="billed" name="Billed" stroke="#C9A227" strokeWidth={2} dot={{ r: 2, fill: "#C9A227" }} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="tile p-4 lg:col-span-2" data-testid="chart-stage-funnel">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-0.5">Pipeline Funnel</div>
            <div className="font-display text-sm font-bold mb-3">Stage Distribution</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageChart} layout="vertical" margin={{ top: 0, left: 0, right: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-soft)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="var(--muted)" fontSize={10} width={80} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 2, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 11 }} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]} label={{ position: "right", fill: "var(--text)", fontSize: 10, fontWeight: 600 }} cursor="pointer"
                     onClick={(d) => d?.name && navigate(`/app/projects?stage=${encodeURIComponent(d.name)}`)}>
                  {stageChart.map((_, i) => <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Middle row: Customers + Vendor exposure */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="tile p-4 lg:col-span-3" data-testid="top-customers-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Top Customers</div>
                <div className="font-display text-sm font-bold">By PO Value</div>
              </div>
              <Buildings size={15} weight="duotone" className="text-[var(--gold)]" />
            </div>
            <table className="tbl">
              <thead><tr><th>Customer</th><th className="num">PO Value</th><th className="num">Projects</th></tr></thead>
              <tbody>
                {top_customers.map((c) => (
                  <tr key={c.customer_id} className="cursor-pointer hover:bg-[var(--row-hover)]" onClick={() => navigate(`/app/customers/${c.customer_id}`)} data-testid={`top-customer-${c.customer_id}`}>
                    <td className="font-medium text-[var(--text)]">{c.customer_name}</td>
                    <td className="num">{formatMoney(c.po_value, unit)}</td>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
                {top_customers.length === 0 && <tr><td colSpan={3} className="text-[var(--muted)] text-center py-3">No data</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="tile p-4 lg:col-span-2" data-testid="vendor-exposure-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Vendor Exposure</div>
                <div className="font-display text-sm font-bold">Top Suppliers</div>
              </div>
              <Truck size={15} weight="duotone" className="text-[var(--gold)]" />
            </div>
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="40%" height={160}>
                <PieChart>
                  <Pie data={vendor_exposure} dataKey="amount" nameKey="supplier_name" innerRadius={36} outerRadius={68} paddingAngle={2}
                    stroke="var(--surface)" strokeWidth={2} label={({ percent }) => percent > 0.05 ? `${Math.round(percent * 100)}%` : ""} labelLine={false} fontSize={10}>
                    {vendor_exposure.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [formatMoney(v, unit), n]}
                    contentStyle={{ borderRadius: 2, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1 min-w-0">
                {vendor_exposure.map((v, i) => (
                  <div key={v.supplier_name} className="flex items-center justify-between text-[11px] gap-1.5 cursor-pointer hover:bg-[var(--row-hover)] px-1 py-0.5 -mx-1 transition-colors" onClick={() => navigate("/app/wbs-budget")}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="truncate">{v.supplier_name}</span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--muted)] shrink-0">{(((v.amount || 0) / totalVendor) * 100).toFixed(1)}%</span>
                  </div>
                ))}
                {vendor_exposure.length === 0 && <div className="text-[11px] text-[var(--muted)]">No cost data</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row: Delayed milestones + Low margin */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" id="delayed-milestones-section">
          <div className="tile p-4" data-testid="delayed-milestones-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Delayed Milestones</div>
                <div className="font-display text-sm font-bold">Past due · Not yet billed</div>
              </div>
              {delayed_milestones.length > 0 && <span className="text-[10px] font-mono text-[var(--danger)]">{delayed_milestones.length}</span>}
            </div>
            <table className="tbl">
              <thead><tr><th>Milestone</th><th>Project</th><th>Due</th><th className="num">Value</th><th className="num">Days</th></tr></thead>
              <tbody>
                {delayed_milestones.slice(0, 8).map((m, i) => (
                  <tr key={i} className="cursor-pointer" onClick={() => navigate(`/app/projects/${m.project_id}`)} data-testid={`delayed-milestone-${i}`}>
                    <td className="font-medium">{m.milestone_name || "—"}</td>
                    <td>
                      <div className="text-[var(--text)]">{m.project_name}</div>
                      <div className="text-[10px] text-[var(--muted)]">{m.customer_name || ""}</div>
                    </td>
                    <td className="text-[var(--danger)] text-xs">{m.due_date}</td>
                    <td className="num">{formatMoney(m.value, unit)}</td>
                    <td className="num text-[var(--danger)]">{m.days_overdue}d</td>
                  </tr>
                ))}
                {delayed_milestones.length === 0 && <tr><td colSpan={5} className="text-[var(--muted)] text-center py-4">No delayed milestones</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="tile p-4" data-testid="low-margin-tile">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Low Margin Projects</div>
                <div className="font-display text-sm font-bold">Margin &lt; 15%</div>
              </div>
              {low_margin_projects.length > 0 && <span className="text-[10px] font-mono text-[var(--danger)]">{low_margin_projects.length}</span>}
            </div>
            <table className="tbl">
              <thead><tr><th>Project</th><th>Stage</th><th className="num">Margin %</th><th className="num">PO</th></tr></thead>
              <tbody>
                {low_margin_projects.slice(0, 8).map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/app/projects/${p.id}`)}>
                    <td className="font-medium">{p.project_name}</td>
                    <td className="text-[11px] text-[var(--muted)]">{p.current_stage}</td>
                    <td className="num text-[var(--danger)]">{(p.margin_pct || 0).toFixed(1)}%</td>
                    <td className="num">{formatMoney(p.po_value, unit)}</td>
                  </tr>
                ))}
                {low_margin_projects.length === 0 && <tr><td colSpan={4} className="text-[var(--muted)] text-center py-4">All projects healthy</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Compact KPI tile ─── */
function Kpi({ label, value, sub, icon: Icon, onClick, accent, danger, testid }) {
  const color = accent ? "var(--gold)" : danger ? "var(--danger)" : undefined;
  return (
    <div
      className="tile group cursor-pointer hover:border-[var(--gold)]/50 transition-colors px-3 py-2.5"
      onClick={onClick}
      data-testid={testid}
      role="button"
      tabIndex={0}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] tracking-overline text-[var(--muted)] leading-none">{label}</span>
        {Icon && <Icon size={12} weight="duotone" className="text-[var(--gold)] opacity-60" />}
      </div>
      <div className="font-mono font-semibold text-lg leading-tight" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--muted)] leading-tight mt-0.5 truncate">{sub}</div>}
      <div className="text-[var(--gold)] flex items-center gap-0.5 text-[9px] tracking-overline mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        DRILL DOWN <ArrowUpRight size={9} />
      </div>
    </div>
  );
}

/* ─── Lightweight multi-select ─── */
function MultiSelect({ value, options, onChange, placeholder, testid }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));
  const labelText = value.length === 0 ? placeholder : `${value.length} selected`;

  return (
    <div className="relative" data-testid={testid}>
      <button type="button" className="input h-8 text-xs flex items-center justify-between text-left w-full" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{labelText}</span>
        <CaretDown size={10} className="text-[var(--muted)]" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--surface)] border border-[var(--border)] shadow-lg max-h-60 overflow-auto" data-testid={`${testid}-menu`}>
          <div className="p-1.5 border-b border-[var(--border)] sticky top-0 bg-[var(--surface)]">
            <input className="input text-xs h-7" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid={`${testid}-search`} />
          </div>
          {filtered.length === 0 && <div className="p-2 text-xs text-[var(--muted)]">No matches</div>}
          {filtered.map((o) => {
            const selected = value.includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-[var(--row-hover)]" data-testid={`${testid}-opt-${o.value}`}>
                <input type="checkbox" checked={selected} onChange={() => { if (selected) onChange(value.filter((v) => v !== o.value)); else onChange([...value, o.value]); }} />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })}
          <div className="p-1.5 border-t border-[var(--border)] sticky bottom-0 bg-[var(--surface)] flex justify-between">
            <button className="btn-ghost text-[10px]" onClick={() => onChange([])} data-testid={`${testid}-clear`}>Clear</button>
            <button className="btn-secondary text-[10px]" onClick={() => setOpen(false)} data-testid={`${testid}-done`}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
