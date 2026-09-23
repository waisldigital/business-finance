import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, TrendUp, Warning, Receipt, Buildings, Truck, FunnelSimple } from "@phosphor-icons/react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";

// eslint-disable-next-line no-unused-vars
function KpiTile({ label, value, sub, icon: Icon, onClick, accent, testid }) {
  return (
    <div
      className={`tile ${onClick ? "tile-clickable" : ""} p-5 flex flex-col justify-between min-h-[112px]`}
      onClick={onClick}
      data-testid={testid}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
        {Icon && <Icon size={16} weight="duotone" className="text-[var(--gold)]" />}
      </div>
      <div>
        <div className={`font-mono font-semibold tracking-tight ${accent ? "text-[var(--gold)]" : "text-[var(--text)]"} text-3xl mt-2`}>
          {value}
        </div>
        {sub && <div className="text-[11px] text-[var(--muted)] mt-1">{sub}</div>}
      </div>
      {onClick && (
        <div className="text-[var(--gold)] flex items-center gap-1 text-[11px] tracking-overline mt-2 opacity-0 group-hover:opacity-100">
          DRILL DOWN <ArrowUpRight size={12} />
        </div>
      )}
    </div>
  );
}

const SECTIONS = [
  { key: "", label: "All" },
  { key: "projects", label: "Projects" },
  { key: "change_requests", label: "Change Requests" },
];

const CHART_PALETTE = [
  "#E07A3C", "#FFC000", "#7BB661", "#7B3F00", "#5C2B84",
  "#8B9A2B", "#D9A45B", "#3CA67A", "#C46A3C", "#3D8B7A",
];
const STAGE_COLORS = ["#E07A3C", "#FFC000", "#7BB661", "#5C2B84", "#7B3F00"];

export default function DashboardPage() {
  const { mode, inrPerUsd } = useCurrency();
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  // Filters
  const [section, setSection] = useState("");
  const [customerIds, setCustomerIds] = useState([]);
  const [projectIds, setProjectIds] = useState([]);
  const [businessCategory, setBusinessCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchData = () => {
    const params = {};
    if (section) params.section = section;
    if (customerIds.length) params.customer_ids = customerIds.join(",");
    if (projectIds.length) params.project_ids = projectIds.join(",");
    if (businessCategory) params.business_category = businessCategory;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.get("/dashboard/summary", { params }).then((r) => setData(r.data)).catch(() => {});
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [section, customerIds.join(","), projectIds.join(","), businessCategory, dateFrom, dateTo]);

  const filterOptions = data?.filter_options || { customers: [], projects: [] };

  // Cascading: when filters applied, only show available options
  const availableProjects = useMemo(() => {
    if (!customerIds.length) return filterOptions.projects;
    return filterOptions.projects.filter((p) => customerIds.includes(p.customer_id));
  }, [filterOptions.projects, customerIds]);

  if (!data) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Loading insights..." testid="dashboard-header" />
        <div className="px-8 py-6 grid grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-28 skeleton" />)}
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
        title="Finance Dashboard"
        subtitle="Live overview of the customer order lifecycle"
        breadcrumb="HOME · DASHBOARD"
        testid="dashboard-header"
      />

      <div className="px-8 py-6 space-y-6">
        {/* Cascading Filters */}
        <div className="tile p-4" data-testid="dashboard-filters">
          <div className="flex items-center gap-2 mb-3">
            <FunnelSimple size={14} className="text-[var(--muted)]" />
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Filters</div>
            <button className="ml-auto btn-ghost text-xs" onClick={clearAll} data-testid="dashboard-filter-clear">Clear all</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Section */}
            <div>
              <div className="text-[9px] tracking-overline text-[var(--muted)] mb-1">Section</div>
              <select className="input" value={section} onChange={(e) => { setSection(e.target.value); setProjectIds([]); }} data-testid="filter-section">
                {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            {/* Customer multi-select */}
            <div>
              <div className="text-[9px] tracking-overline text-[var(--muted)] mb-1">Customer (multi)</div>
              <MultiSelect
                value={customerIds}
                options={filterOptions.customers.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => { setCustomerIds(v); setProjectIds([]); }}
                placeholder="Any customer"
                testid="filter-customers"
              />
            </div>
            {/* Project / WBS multi-select */}
            <div>
              <div className="text-[9px] tracking-overline text-[var(--muted)] mb-1">Project / WBS (multi)</div>
              <MultiSelect
                value={projectIds}
                options={availableProjects.map((p) => ({
                  value: p.id,
                  label: p.wbs_element ? `${p.name} · ${p.wbs_element}` : p.name,
                }))}
                onChange={setProjectIds}
                placeholder="Any project"
                testid="filter-projects"
              />
            </div>
            {/* Business category */}
            <div>
              <div className="text-[9px] tracking-overline text-[var(--muted)] mb-1">GMR / Non-GMR</div>
              <select className="input" value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} data-testid="filter-business-category">
                <option value="">Both</option>
                <option value="GMR">GMR</option>
                <option value="Non-GMR">Non-GMR</option>
              </select>
            </div>
            {/* Date range */}
            <div>
              <div className="text-[9px] tracking-overline text-[var(--muted)] mb-1">Recognition Date Range</div>
              <div className="flex items-center gap-2">
                <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="filter-date-from" />
                <span className="text-[10px] text-[var(--muted)]">to</span>
                <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="filter-date-to" />
              </div>
            </div>
          </div>
        </div>

        {/* KPI ROW */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile
            label="Total Projects"
            value={formatNumber(totals.total_projects)}
            sub={`Across ${stage_summary.length} stages`}
            icon={Buildings}
            onClick={() => navigate("/projects")}
            testid="kpi-total-projects"
          />
          <KpiTile
            label="Total PO Value"
            value={formatCurrency(totals.total_po_value, mode, inrPerUsd)}
            sub={`Revenue ${formatCurrency(totals.total_revenue, mode, inrPerUsd)}`}
            icon={TrendUp}
            onClick={() => navigate("/projects")}
            testid="kpi-total-po"
          />
          <KpiTile
            label="Total Margin"
            value={formatCurrency(totals.total_margin, mode, inrPerUsd)}
            sub={`${totals.margin_pct.toFixed(1)}% blended margin`}
            icon={Receipt}
            accent
            testid="kpi-total-margin"
          />
          <KpiTile
            label="Approvals Pending"
            value={formatNumber(approvals_pending)}
            sub="Click to action"
            icon={Warning}
            onClick={() => navigate("/approvals")}
            testid="kpi-approvals"
          />
        </div>

        {/* Secondary KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiTile
            label="Revenue"
            value={formatCurrency(recognized_unbilled.recognized, mode, inrPerUsd)}
            sub={`Billed ${formatCurrency(recognized_unbilled.billed, mode, inrPerUsd)}`}
            testid="kpi-recognized"
          />
          <KpiTile
            label="Recognized but Unbilled"
            value={formatCurrency(recognized_unbilled.unbilled, mode, inrPerUsd)}
            sub="Working capital exposure"
            accent
            testid="kpi-unbilled"
          />
          <KpiTile
            label="Delayed Milestones"
            value={formatNumber(delayed_milestones.length)}
            sub={`${low_margin_projects.length} low-margin alerts`}
            icon={Warning}
            onClick={() => { /* scroll to delayed milestones */ }}
            testid="kpi-delayed"
          />
        </div>

        {/* CHART ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="tile p-5 lg:col-span-2" data-testid="chart-monthly-billing">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Monthly Billing Trend</div>
                <div className="font-display text-lg font-bold">Recognized vs Billed (Cr)</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={monthChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-soft)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Line type="monotone" dataKey="recognized" name="Recognized (Cr)" stroke="#5C2B84" strokeWidth={2.5} dot={{ r: 3, fill: "#5C2B84" }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="billed" name="Billed (Cr)" stroke="#FFC000" strokeWidth={2.5} dot={{ r: 3, fill: "#FFC000" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="tile p-5" data-testid="chart-stage-funnel">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">Pipeline Funnel</div>
            <div className="font-display text-lg font-bold mb-4">Stage Distribution</div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stageChart} layout="vertical" margin={{ top: 4, left: 8, right: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-soft)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="var(--muted)" fontSize={11} width={90} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12 }} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} label={{ position: "right", fill: "var(--text)", fontSize: 11, fontWeight: 600 }}>
                  {stageChart.map((_, i) => <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="tile p-5" data-testid="top-customers-tile">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Top Customers</div>
                <div className="font-display text-lg font-bold">By PO Value</div>
              </div>
              <Buildings size={18} weight="duotone" className="text-[var(--gold)]" />
            </div>
            <table className="tbl">
              <thead>
                <tr><th>Customer</th><th className="num">PO Value</th><th className="num">Projects</th></tr>
              </thead>
              <tbody>
                {top_customers.map((c) => (
                  <tr key={c.customer_id}>
                    <td>{c.customer_name}</td>
                    <td className="num">{formatCurrency(c.po_value, mode, inrPerUsd)}</td>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
                {top_customers.length === 0 && (
                  <tr><td colSpan={3} className="text-[var(--muted)] text-center py-4">No data</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="tile p-5" data-testid="vendor-exposure-tile">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Vendor Exposure</div>
                <div className="font-display text-lg font-bold">Top 10 Suppliers · Cost Spend</div>
              </div>
              <Truck size={18} weight="duotone" className="text-[var(--gold)]" />
            </div>
            <div className="grid grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={vendor_exposure}
                    dataKey="amount"
                    nameKey="supplier_name"
                    innerRadius={42}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    label={({ percent }) => percent > 0.04 ? `${Math.round(percent * 100)}%` : ""}
                    labelLine={false}
                    fontSize={11}
                  >
                    {vendor_exposure.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => [formatCurrency(v, mode, inrPerUsd), n]}
                    contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {vendor_exposure.map((v, i) => {
                  const pct = ((v.amount || 0) / totalVendor) * 100;
                  return (
                    <div key={v.supplier_name} className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                        <span className="truncate">{v.supplier_name}</span>
                      </div>
                      <span className="font-mono text-[var(--muted)]">{pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
                {vendor_exposure.length === 0 && <div className="text-xs text-[var(--muted)]">No cost data yet</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Delayed Milestones (replaces Delayed Projects) + Low margin */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="tile p-5" data-testid="delayed-milestones-tile">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Delayed Milestones</div>
                <div className="font-display text-lg font-bold">Past due · Not yet billed</div>
              </div>
            </div>
            <table className="tbl">
              <thead><tr><th>Milestone</th><th>Project</th><th>Flag</th><th>Due</th><th className="num">Value</th><th className="num">Days</th></tr></thead>
              <tbody>
                {delayed_milestones.slice(0, 8).map((m, i) => (
                  <tr key={i} className="cursor-pointer" onClick={() => navigate(`/projects/${m.project_id}`)} data-testid={`delayed-milestone-${i}`}>
                    <td className="font-medium">{m.milestone_name || "—"}</td>
                    <td>
                      <div className="text-[var(--text)]">{m.project_name}</div>
                      <div className="text-[11px] text-[var(--muted)]">{m.customer_name || ""}</div>
                    </td>
                    <td><span className="badge flag-delayed">Delayed</span></td>
                    <td className="text-[var(--danger)]">{m.due_date}</td>
                    <td className="num">{formatCurrency(m.value, mode, inrPerUsd)}</td>
                    <td className="num text-[var(--danger)]">{m.days_overdue}d</td>
                  </tr>
                ))}
                {delayed_milestones.length === 0 && (
                  <tr><td colSpan={6} className="text-[var(--muted)] text-center py-6">No delayed milestones</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="tile p-5" data-testid="low-margin-tile">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Low Margin Projects</div>
                <div className="font-display text-lg font-bold">Margin &lt; 15%</div>
              </div>
            </div>
            <table className="tbl">
              <thead><tr><th>Project</th><th>Flag</th><th className="num">Margin %</th><th className="num">PO</th></tr></thead>
              <tbody>
                {low_margin_projects.slice(0, 8).map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.id}`)}>
                    <td>
                      <div>{p.project_name}</div>
                      <div className="text-[11px] text-[var(--muted)]">{p.current_stage}</div>
                    </td>
                    <td><span className="badge flag-low-margin">Low Margin</span></td>
                    <td className="num text-[var(--danger)]">{(p.margin_pct || 0).toFixed(1)}%</td>
                    <td className="num">{formatCurrency(p.po_value, mode, inrPerUsd)}</td>
                  </tr>
                ))}
                {low_margin_projects.length === 0 && (
                  <tr><td colSpan={4} className="text-[var(--muted)] text-center py-6">All projects healthy</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lightweight multi-select using native checkboxes inside a popover
function MultiSelect({ value, options, onChange, placeholder, testid }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));
  const labelText = value.length === 0 ? placeholder : `${value.length} selected`;

  return (
    <div className="relative" data-testid={testid}>
      <button type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
        <span className="truncate">{labelText}</span>
        <span className="text-[var(--muted)] text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--surface)] border border-[var(--border)] shadow-lg max-h-72 overflow-auto" data-testid={`${testid}-menu`}>
          <div className="p-2 border-b border-[var(--border)] sticky top-0 bg-[var(--surface)]">
            <input
              className="input text-xs"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid={`${testid}-search`}
            />
          </div>
          {filtered.length === 0 && <div className="p-3 text-xs text-[var(--muted)]">No matches</div>}
          {filtered.map((o) => {
            const selected = value.includes(o.value);
            return (
              <label key={o.value} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-[var(--row-hover)]" data-testid={`${testid}-opt-${o.value}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    if (selected) onChange(value.filter((v) => v !== o.value));
                    else onChange([...value, o.value]);
                  }}
                />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })}
          <div className="p-2 border-t border-[var(--border)] sticky bottom-0 bg-[var(--surface)] flex justify-between">
            <button className="btn-ghost text-xs" onClick={() => onChange([])} data-testid={`${testid}-clear`}>Clear</button>
            <button className="btn-secondary text-xs" onClick={() => setOpen(false)} data-testid={`${testid}-done`}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
