import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import DatasetWorkspace from "@/aop/DatasetWorkspace";
import { Database, LockKey, MagnifyingGlass } from "@phosphor-icons/react";

export default function AdminDataPage() {
  const [datasets, setDatasets] = useState([]);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const load = () => api.get("/aop/datasets").then((r) => setDatasets(r.data));
  useEffect(() => { load(); }, []);
  const groups = useMemo(() => {
    const g = {};
    datasets.filter((d) => !q || d.label.toLowerCase().includes(q.toLowerCase())).forEach((d) => { (g[d.group] = g[d.group] || []).push(d); });
    return g;
  }, [datasets, q]);
  const current = datasets.find((d) => d.key === params.get("ds")) || datasets[0];

  return (
    <div data-testid="admin-data-page">
      <PageHeader compact icon={Database} title="Data manager"
              subtitle="Every AOP dataset: columns, unique keys, bulk upload (add / replace / modify) and download — admin only" />
      <div className="flex">
        <aside className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] min-h-[calc(100vh-110px)]">
          <div className="p-2 relative">
            <MagnifyingGlass size={12} className="absolute left-4 top-4 text-[var(--muted)]" />
            <input className="input-sm pl-6 w-full" placeholder="Find dataset" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {Object.entries(groups).map(([g, list]) => (
            <div key={g} className="mb-1">
              <div className="px-3 py-1 text-[10px] tracking-overline text-[var(--muted)]">{g}</div>
              {list.map((d) => (
                <button key={d.key} onClick={() => setParams({ ds: d.key })} data-testid={`admin-ds-${d.key}`}
                        className={`w-full text-left px-3 py-1 text-xs flex items-center gap-1.5 ${current?.key === d.key ? "bg-[var(--surface-2)] text-[var(--gold)] font-semibold border-l-2 border-[var(--gold)]" : "hover:bg-[var(--row-hover)]"}`}>
                  {d.sensitive && <LockKey size={11} />}
                  <span className="flex-1 truncate">{d.label}</span>
                  <span className="text-[10px] text-[var(--muted)] tabular-nums">{d.rows.toLocaleString("en-IN")}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="flex-1 min-w-0 p-3">
          {current && (
            <>
              <div className="flex items-center gap-2 mb-1.5 text-[11px] text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)] text-sm">{current.label}</span>
                <span className="chip">key: {current.key_fields.join(" + ")}</span>
                <span className="truncate">{current.description}</span>
              </div>
              <DatasetWorkspace key={current.key} dataset={current} admin onChanged={load} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
