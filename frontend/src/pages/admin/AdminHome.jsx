import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import Header from "@/aop/Header";
import { Gauge, Database, FileArrowUp, CheckSquareOffset, SlidersHorizontal, Table, UserCircle, Gear, Warning } from "@phosphor-icons/react";

const Tile = ({ to, icon: Icon, label, value, sub, tone }) => (
  <Link to={to} className="border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--gold)] flex items-start gap-3">
    <Icon size={22} weight="duotone" className={tone || "text-[var(--gold)]"} />
    <div className="min-w-0">
      <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[10.5px] text-[var(--muted)] truncate">{sub}</div>}
    </div>
  </Link>
);

export default function AdminHome() {
  const [ds, setDs] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [pending, setPending] = useState([]);
  const [imports, setImports] = useState([]);
  useEffect(() => {
    api.get("/aop/datasets").then((r) => setDs(r.data));
    api.get("/aop/config").then((r) => setCfg(r.data));
    api.get("/aop/changes").then((r) => setPending(r.data));
    api.get("/aop/imports").then((r) => setImports(r.data));
  }, []);
  const rows = ds.filter((d) => d.key !== "actuals").reduce((a, d) => a + d.rows, 0);
  const actuals = ds.find((d) => d.key === "actuals")?.rows || 0;
  const last = imports[0];
  const empty = ds.length > 0 && rows === 0;
  return (
    <div data-testid="admin-home">
      <Header icon={Gauge} title="Admin overview" subtitle={cfg ? `Actuals ${cfg.base_fy} to ${cfg.cutoffs?.default} · approved plan ${cfg.plan_fy} · drafting ${cfg.draft_fy}` : ""} />
      <div className="p-3 space-y-3">
        {empty && (
          <div className="border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-3 text-xs flex items-center gap-2">
            <Warning size={16} className="text-[var(--warning)]" />
            No AOP data yet — start with <Link to="/admin/aop/imports" className="underline font-semibold">Imports</Link>: upload the consolidated AOP workbook, then the Opex forecast workbook.
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Tile to="/admin/aop/data" icon={Database} label="Dataset rows" value={rows.toLocaleString("en-IN")} sub={`${ds.length} datasets`} />
          <Tile to="/admin/aop/data?ds=actuals" icon={Database} label="Actual entries" value={actuals.toLocaleString("en-IN")} sub="single actual source" />
          <Tile to="/admin/aop/approvals" icon={CheckSquareOffset} label="Pending approvals" value={pending.length} tone={pending.length ? "text-[var(--warning)]" : undefined} />
          <Tile to="/admin/aop/imports" icon={FileArrowUp} label="Last import" value={last ? new Date(last.at).toLocaleDateString("en-IN") : "—"} sub={last?.file} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Tile to="/admin/aop/pnl" icon={Table} label="P&L check" value="Open" sub="reconcile against the workbook" />
          <Tile to="/admin/aop/settings" icon={SlidersHorizontal} label="Plan settings" value={cfg?.draft_fy || "—"} sub="cycle, cut-off, approval modes" />
          <Tile to="/admin/employees" icon={UserCircle} label="Users & employees" value="Manage" sub="logins and role assignment" />
          <Tile to="/admin/settings?tab=roles" icon={Gear} label="Roles" value="Access" sub="sections, payroll, airport scope" />
        </div>
      </div>
    </div>
  );
}
