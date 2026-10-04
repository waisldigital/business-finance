import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { SECTION_META, DatasetBody } from "@/pages/aop/AopSectionPage";
import { SquaresFour, Eye, FloppyDisk } from "@phosphor-icons/react";

const SECTIONS = ["aop_inputs", "aop_revenue", "aop_opex", "aop_overheads", "aop_payroll", "aop_capex"];

/**
 * Admin control of the AOP sections users see: which tabs (datasets) each section shows, and a preview of every tab
 * exactly as users get it — arrange columns, sort, filter, then "Default for everyone" in the grid settings (⚙)
 * makes that layout the users' starting view.
 */
export default function AdminAopSections() {
  const [params, setParams] = useSearchParams();
  const section = params.get("s") || "aop_opex";
  const [datasets, setDatasets] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [tabs, setTabs] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api.get("/aop/datasets").then((r) => setDatasets(r.data));
    api.get("/aop/config").then((r) => setCfg(r.data));
  }, []);
  const inSection = useMemo(() => datasets.filter((d) => d.section === section), [datasets, section]);
  useEffect(() => {
    if (!cfg) return;
    const t = (cfg.user_tabs || {})[section];
    setTabs(t ? [...t] : inSection.map((d) => d.key));
  }, [cfg, section, inSection]);
  const shown = inSection.filter((d) => (tabs || []).includes(d.key));
  const [current, setCurrent] = useState(null);
  const cur = shown.find((d) => d.key === current) || shown[0];
  const dirty = cfg && tabs && JSON.stringify((cfg.user_tabs || {})[section] || inSection.map((d) => d.key)) !== JSON.stringify(tabs);
  const save = async () => {
    const all = { ...(cfg.user_tabs || {}), [section]: tabs };
    try {
      const { data } = await api.put("/aop/config", { user_tabs: all });
      setCfg(data); setMsg("Saved — users now see these tabs");
    } catch (e) { setMsg(e.response?.data?.detail || e.message); }
  };
  const toggle = (k, on) => setTabs((t) => {
    const next = on ? [...t, k] : t.filter((x) => x !== k);
    return inSection.map((d) => d.key).filter((x) => next.includes(x)); // keep catalogue order
  });
  return (
    <div data-testid="admin-aop-sections">
      <PageHeader compact icon={SquaresFour} title="AOP sections"
                  subtitle="What users see in each AOP section: the tabs, and each tab's default layout (columns, order, sort, filters)" />
      <div className="flex">
        <aside className="w-48 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] min-h-[calc(100vh-110px)] py-2">
          {SECTIONS.map((s) => {
            const M = SECTION_META[s] || {};
            return (
              <button key={s} onClick={() => { setParams({ s }); setCurrent(null); setMsg(""); }} data-testid={`sections-${s}`}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${section === s ? "bg-[var(--surface-2)] text-[var(--gold)] font-semibold border-l-2 border-[var(--gold)]" : "hover:bg-[var(--row-hover)]"}`}>
                {M.icon && <M.icon size={14} />}{M.title || s}
              </button>
            );
          })}
        </aside>
        <div className="flex-1 min-w-0 p-3 space-y-2 text-xs">
          <div className="border border-[var(--border)] bg-[var(--surface)] p-2 flex items-center gap-3 flex-wrap">
            <span className="font-semibold">Tabs users see</span>
            {inSection.map((d) => (
              <label key={d.key} className="flex items-center gap-1" title={d.description}>
                <input type="checkbox" className="accent-[var(--gold)]" checked={(tabs || []).includes(d.key)} onChange={(e) => toggle(d.key, e.target.checked)}
                       data-testid={`user-tab-${d.key}`} />{d.label}
              </label>
            ))}
            <button className="icon-btn primary" disabled={!dirty || !tabs?.length} onClick={save} data-testid="user-tabs-save"><FloppyDisk size={13} />Save</button>
            {msg && <span className="text-[var(--success)]">{msg}</span>}
          </div>
          {shown.length > 1 && (
            <div className="flex items-center gap-1 border-b border-[var(--border)]">
              {shown.map((d) => (
                <button key={d.key} onClick={() => setCurrent(d.key)}
                        className={`px-3 py-1.5 whitespace-nowrap border-b-2 -mb-px ${cur?.key === d.key ? "border-[var(--gold)] font-semibold" : "border-transparent text-[var(--muted)]"}`}>{d.label}</button>
              ))}
            </div>
          )}
          {cur && (
            <>
              <div className="text-[var(--muted)]"><Eye size={12} className="inline -mt-0.5 mr-1" />Users' view of <b className="text-[var(--text)]">{cur.label}</b> — arrange it, then ⚙ → “Default for everyone” to make it their starting layout (users keep their own changes on top). Table tools: + adds a line, the columns button adds / removes / renames columns, select lines to delete them.</div>
              <DatasetBody key={cur.key} dataset={cur} preview manage />
            </>
          )}
          {!shown.length && <div className="text-[var(--muted)]">No tabs selected — users would see an empty section.</div>}
        </div>
      </div>
    </div>
  );
}
