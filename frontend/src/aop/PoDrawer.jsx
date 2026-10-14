import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { X, Receipt, Package, Truck, FileText, LinkSimple, Flag, Warning, MapPin } from "@phosphor-icons/react";
import { fmtAmount, fmtCell } from "./format";
import StatTile from "@/components/common/StatTile";

const L = (v) => fmtAmount(v, "lakh");
export const reviewBase = () => (window.location.pathname.startsWith("/admin") ? "/admin/aop/review" : "/app/aop/review");
const pct = (v) => (v === null || v === undefined || v === "" ? "—" : `${(Number(v) * 100).toFixed(1)}%`);

/** One SAP PO: items (INR, deduped), GRN and invoices, the lines it is linked to, triage, open changes and corrections. */
export default function PoDrawer({ po, onClose, onOpenPo, onOpenLine }) {
  const isAdmin = window.location.pathname.startsWith("/admin"); // mapping and corrections are admin work
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => {
    setData(null); setErr("");
    api.get(`/aop/po/${encodeURIComponent(po)}`).then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, [po]); // eslint-disable-line react-hooks/exhaustive-deps
  const flag = async () => {
    const remarks = window.prompt(`Flag PO ${po} for correction in SAP — what is wrong?`);
    if (remarks === null) return;
    try {
      await api.post("/aop/review/corrections", { po, remarks, type: "Other", source: "drawer" });
      setMsg("Flagged — see Review → Corrections"); load();
    } catch (e) { setMsg(e.response?.data?.detail || e.message); }
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} data-testid="po-drawer">
      <div className="w-full max-w-4xl h-full bg-[var(--surface)] border-l border-[var(--border)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <Receipt size={18} className="text-[var(--gold)]" />
          <div className="flex-1">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Purchase order</div>
            <div className="font-semibold font-mono">{po}</div>
          </div>
          {isAdmin && <button className="icon-btn" onClick={flag} title="Flag this PO for correction in SAP" data-testid="po-flag-correction"><Flag size={13} />Flag for correction</button>}
          {isAdmin && <a className="icon-btn" href={`${reviewBase()}?tab=to-map&po=${encodeURIComponent(po)}`} title="Open the To map form for this PO"><MapPin size={13} />Map</a>}
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="overflow-auto p-4 space-y-4 text-xs">
          {err && <div className="text-[var(--danger)]">{String(err)}</div>}
          {msg && <div className="text-[var(--success)]">{msg}</div>}
          {!data && !err && <div className="text-[var(--muted)]">Loading…</div>}
          {data && <PoBody data={data} po={po} onOpenPo={onOpenPo} onOpenLine={onOpenLine} />}
        </div>
      </div>
    </div>
  );
}

export function PoBody({ data, po, onOpenPo, onOpenLine }) {
  const s = data.summary || {};
  return (
    <>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <Truck size={15} className="text-[var(--muted)]" />
        <span className="font-semibold">{s.supplier || "Not in the ZMM"}</span>
        {s.supplier_code && <span className="chip">{s.supplier_code}</span>}
        {s.created_on && <span className="chip">Created {String(s.created_on).slice(0, 10)}</span>}
        {s.currency && s.currency !== "INR" && <span className="chip">{s.currency}</span>}
        {s.pr_no && <span className="chip">PR {s.pr_no}</span>}
        {s.wbs?.map((w) => <span key={w} className="chip font-mono">{w}</span>)}
      </div>
      <div className="grid grid-cols-5 gap-2">
        <StatTile size="sm" label="PO value (₹ L)" value={L(s.po_value)} />
        <StatTile size="sm" label="GRN done (₹ L)" value={L(s.grn_amount)} tone="text-[var(--success)]" />
        <StatTile size="sm" label="Pending GRN (₹ L)" value={L(s.pending_grn)} tone="text-[var(--warning)]" />
        <StatTile size="sm" label="Invoiced (₹ L)" value={L(s.invoiced)} />
        <StatTile size="sm" label="Allocated to lines (₹ L)" value={L(s.allocated)} />
      </div>
      {s.allocation_warning && <div className="text-[var(--warning)] flex items-center gap-1"><Warning size={12} />{s.allocation_warning}</div>}

      {(!!data.changes?.length || !!data.corrections?.length) && (
        <section className="border border-[var(--warning)] p-2 space-y-1">
          {data.changes.map((c) => (
            <div key={c.key} className="flex items-center gap-2"><Warning size={12} className="text-[var(--warning)]" />
              <span>Item {c.item} · {c.label}: <b>{fmtCell(c.old, "text")}</b> → SAP now <b>{fmtCell(c.new, "text")}</b> (pending review)</span></div>
          ))}
          {data.corrections.map((c) => (
            <div key={c.key} className="flex items-center gap-2"><Flag size={12} className="text-[var(--danger)]" />
              <span>{c.key} · {c.type} · {c.status}{c.remarks ? ` — ${c.remarks}` : ""}</span></div>
          ))}
        </section>
      )}

      <section>
        <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5 flex items-center gap-1"><LinkSimple size={12} /> Linked Opex lines · {data.links.length}</h3>
        {data.links.length ? (
          <table className="w-full border border-[var(--border)]">
            <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
              <tr>{["Line", "AOP code", "Vendor", "Old PO", "Material / item", "%", "Allocated (₹ L)", "Status", "Flags"].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.links.map((l) => (
                <tr key={l.key} className="border-t border-[var(--border-soft)]">
                  <td className="px-2 py-1 font-mono">{onOpenLine ? <button className="text-[var(--gold)] underline decoration-dotted" onClick={() => onOpenLine(l.line_id, po)}>{l.line_id}</button> : l.line_id}</td>
                  <td className="px-2">{l.aop_code}</td><td className="px-2">{l.vendor}</td>
                  <td className="px-2"><PoLink po={l.line_po} current={po} onOpenPo={onOpenPo} /></td>
                  <td className="px-2 font-mono">{[l.material, l.po_item].filter(Boolean).join(" / ") || "whole PO"}</td>
                  <td className="px-2">{l.alloc_pct === null || l.alloc_pct === undefined ? "100%" : pct(l.alloc_pct)}{l.alloc_auto ? " (auto)" : ""}</td>
                  <td className="px-2 text-right tabular-nums">{L(l.alloc_value_inr)}</td>
                  <td className="px-2">{l.status || "Active"}</td>
                  <td className="px-2 text-[var(--warning)]">{l.flags}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-[var(--muted)]">Not linked to an Opex line{data.triage?.[0]?.type ? ` · triaged as ${data.triage[0].type}` : ""}.</div>}
        {!!data.own_lines?.length && <div className="mt-1 text-[var(--muted)]">Old PO of: {data.own_lines.map((l) => l.line_id).join(", ")}</div>}
      </section>

      <section>
        <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5 flex items-center gap-1"><Package size={12} /> PO items (ZMM, INR) · {data.items.length}</h3>
        {data.items.length ? (
          <div className="overflow-auto border border-[var(--border)]">
            <table className="w-max min-w-full">
              <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
                <tr>{["Item", "Material", "Description", "Qty", "Doc value", "Value ₹", "FX source", "Period", "GRN ₹", "GRN %", "Pending ₹", "Invoiced ₹", "Active", "Triage"].map((h) => <th key={h} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.items.map((i) => {
                  const t = data.triage?.find((x) => String(x.item) === String(i.item));
                  const now = i.sap_now || {};
                  return (
                    <tr key={i.item} className="border-t border-[var(--border-soft)] whitespace-nowrap">
                      <td className="px-2 py-1">{i.item}</td>
                      <td className="px-2 font-mono">{i.material}</td>
                      <td className="px-2 max-w-[220px] truncate" title={i.material_description}>{i.material_description}</td>
                      <td className="px-2 text-right">{fmtCell(i.quantity, "number")}</td>
                      <td className="px-2 text-right">{fmtCell(i.net_order_value, "number")} {i.currency !== "INR" ? i.currency : ""}</td>
                      <td className="px-2 text-right">{fmtCell(i.value_inr, "number")}</td>
                      <td className={`px-2 ${/^(FX assumption|No FX)/.test(i.fx_source || "") ? "text-[var(--warning)]" : ""}`}>{i.fx_source}</td>
                      <td className="px-2">{fmtCell(i.period_start, "date")} → {fmtCell(i.period_end, "date")}
                        {(now.period_start || now.period_end) && <span className="text-[var(--warning)]"> · SAP now {now.period_start || i.period_start} → {now.period_end || i.period_end}</span>}</td>
                      <td className="px-2 text-right">{fmtCell(i.grn_inr, "number")}</td>
                      <td className="px-2 text-right">{pct(i.grn_pct)}</td>
                      <td className="px-2 text-right">{fmtCell(i.pending_inr, "number")}</td>
                      <td className="px-2 text-right">{fmtCell(i.invoiced_inr, "number")}</td>
                      <td className="px-2">{i.active === false ? <span className="text-[var(--danger)]">{i.deletion_indicator || "No"}</span> : "Yes"}{i.in_latest_zmm === false ? " · not in latest ZMM" : ""}</td>
                      <td className="px-2">{t?.type || t?.suggested_type ? `${t.type || `${t.suggested_type}?`}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="text-[var(--muted)]">Not in the ZMM — a legacy PO (non-SAP) or not yet in the latest report.</div>}
      </section>

      {(!!data.grn?.length || !!data.invoices?.length) && (
        <section className="grid md:grid-cols-2 gap-3">
          <MiniTable title={`GRN / SRN · ${data.grn.length}`} cols={[["item", "Item"], ["migo_no", "MIGO"], ["migo_line", "Line"], ["date", "Date", "date"], ["amount_inr", "₹", "number"]]} rows={data.grn} />
          <MiniTable title={`Invoices · ${data.invoices.length}`} cols={[["item", "Item"], ["invoice_no", "Invoice"], ["date", "Date", "date"], ["amount_inr", "₹", "number"]]} rows={data.invoices} />
        </section>
      )}

      {!!data.opex_lines?.length && (
        <section>
          <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5 flex items-center gap-1"><FileText size={12} /> Opex budget lines (approved AOP)</h3>
          <div className="text-[var(--muted)]">{data.opex_lines.map((l) => `${l.line_id} · ${l.aop_code || ""} · ${l.vendor || ""}`).join("  |  ")}</div>
        </section>
      )}
    </>
  );
}

function MiniTable({ title, cols, rows }) {
  return (
    <div>
      <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5">{title}</h3>
      <div className="overflow-auto border border-[var(--border)] max-h-64">
        <table className="w-full">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)] sticky top-0">
            <tr>{cols.map(([k, h]) => <th key={k} className="text-left px-2 py-1">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[var(--border-soft)]">
                {cols.map(([k, , t]) => <td key={k} className={`px-2 py-0.5 ${t === "number" ? "text-right tabular-nums" : ""}`}>{fmtCell(r[k], t || "text")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PoLink({ po, current, onOpenPo }) {
  if (!po) return null;
  const p = String(po);
  if (p === current || !onOpenPo) return <span className="font-mono mr-1">{p}</span>;
  return <button className="font-mono mr-1 text-[var(--gold)] underline decoration-dotted" onClick={() => onOpenPo(p)}>{p}</button>;
}
