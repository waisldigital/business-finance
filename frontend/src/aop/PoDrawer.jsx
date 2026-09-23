import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { X, Receipt, ArrowRight, Package, Truck, FileText } from "@phosphor-icons/react";
import { fmtAmount, fmtCell } from "./format";

const Tile = ({ label, value, tone }) => (
  <div className="border border-[var(--border)] px-2.5 py-1.5">
    <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
    <div className={`text-sm font-semibold tabular-nums ${tone || ""}`}>{value}</div>
  </div>
);

export default function PoDrawer({ po, onClose, onOpenPo }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    api.get(`/aop/po/${encodeURIComponent(po)}`).then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [po]);

  const s = data?.summary || {};
  const L = (v) => fmtAmount(v, "lakh");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} data-testid="po-drawer">
      <div className="w-full max-w-3xl h-full bg-[var(--surface)] border-l border-[var(--border)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <Receipt size={18} className="text-[var(--gold)]" />
          <div className="flex-1">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Purchase order</div>
            <div className="font-semibold font-mono">{po}</div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="overflow-auto p-4 space-y-4 text-xs">
          {err && <div className="text-[var(--danger)]">{String(err)}</div>}
          {!data && !err && <div className="text-[var(--muted)]">Loading…</div>}
          {data && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Truck size={15} className="text-[var(--muted)]" />
                <span className="font-semibold">{s.supplier || "Supplier not in PO register"}</span>
                {s.supplier_code && <span className="chip">{s.supplier_code}</span>}
                {s.created_on && <span className="chip">Created {String(s.created_on).slice(0, 10)}</span>}
                {s.wbs?.map((w) => <span key={w} className="chip font-mono">{w}</span>)}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Tile label="PO value (₹ L)" value={L(s.po_value)} />
                <Tile label="GRN done (₹ L)" value={L(s.grn_amount)} tone="text-[var(--success)]" />
                <Tile label="Pending GRN (₹ L)" value={L(s.pending_grn)} tone="text-[var(--warning)]" />
                <Tile label="Invoiced (₹ L)" value={L(s.invoiced)} />
              </div>

              {!!data.tracker.length && (
                <section>
                  <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5 flex items-center gap-1"><ArrowRight size={12} /> Old ↔ new PO mapping (forecast tracker)</h3>
                  <table className="w-full border border-[var(--border)]">
                    <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
                      <tr><th className="text-left px-2 py-1">Line</th><th className="text-left px-2">Old PO</th><th className="text-left px-2">New PO</th><th className="text-left px-2">Vendor</th><th className="text-left px-2">AOP code</th><th className="text-left px-2">Nature</th><th className="text-right px-2">B plan (₹ L)</th><th className="text-right px-2">New PO amt (₹ L)</th></tr>
                    </thead>
                    <tbody>
                      {data.tracker.map((t) => (
                        <tr key={t.line_id} className="border-t border-[var(--border-soft)]">
                          <td className="px-2 py-1 font-mono">{t.line_id}</td>
                          <td className="px-2"><PoLink po={t.old_po} current={po} onOpenPo={onOpenPo} /></td>
                          <td className="px-2">{String(t.mapped_new_pos || t.new_po || "").split(/[,;/\s]+/).filter(Boolean).map((x) => <PoLink key={x} po={x} current={po} onOpenPo={onOpenPo} />)}</td>
                          <td className="px-2">{t.vendor}</td>
                          <td className="px-2">{t.aop_code}</td>
                          <td className="px-2">{t.recurring}</td>
                          <td className="px-2 text-right tabular-nums">{L(t.budget_plan)}</td>
                          <td className="px-2 text-right tabular-nums">{L(t.new_po_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <section>
                <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5 flex items-center gap-1"><Package size={12} /> PO items, GRN & invoices (ZMM) · {data.items.length}</h3>
                {data.items.length ? (
                  <div className="overflow-auto border border-[var(--border)]">
                    <table className="w-max min-w-full">
                      <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
                        <tr>{["Item", "Material / service", "Qty", "Net value", "Period", "GRN no.", "GRN date", "GRN amt", "Pending GR", "Invoice", "Inv. date", "Inv. amt", "G/L"].map((h) => <th key={h} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {data.items.map((i, k) => (
                          <tr key={k} className="border-t border-[var(--border-soft)] whitespace-nowrap">
                            <td className="px-2 py-1">{i.purchase_order_item}</td>
                            <td className="px-2 max-w-[240px] truncate" title={i.material_description}>{i.material_description}</td>
                            <td className="px-2 text-right">{fmtCell(i.order_quantity, "number")}</td>
                            <td className="px-2 text-right">{fmtCell(i.final_value, "number")}</td>
                            <td className="px-2">{fmtCell(i.start_date_for_period_of_performance, "date")} → {fmtCell(i.end_date_for_period_of_performance, "date")}</td>
                            <td className="px-2">{i.migo_no}</td>
                            <td className="px-2">{fmtCell(i.grn_posting_date, "date")}</td>
                            <td className="px-2 text-right">{fmtCell(i.gr_amount_in_lc, "number")}</td>
                            <td className="px-2 text-right">{fmtCell(i.pending_gr_amount_in_lc, "number")}</td>
                            <td className="px-2">{i.invoice_no}</td>
                            <td className="px-2">{fmtCell(i.invoice_posting_date, "date")}</td>
                            <td className="px-2 text-right">{fmtCell(i.invoiced_value_base_value, "number")}</td>
                            <td className="px-2">{i.g_l_account}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="text-[var(--muted)]">Not in the PO register (ZMM). Upload a newer ZMM report from Admin → Data manager.</div>}
              </section>

              {!!data.opex_lines.length && (
                <section>
                  <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5 flex items-center gap-1"><FileText size={12} /> Opex budget lines</h3>
                  <table className="w-full border border-[var(--border)]">
                    <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
                      <tr><th className="text-left px-2 py-1">Line</th><th className="text-left px-2">AOP code</th><th className="text-left px-2">WBS</th><th className="text-left px-2">Category</th><th className="text-left px-2">Tag</th><th className="text-left px-2">PO period</th><th className="text-right px-2">Net PO (₹ L)</th></tr>
                    </thead>
                    <tbody>
                      {data.opex_lines.map((l) => (
                        <tr key={l.line_id} className="border-t border-[var(--border-soft)]">
                          <td className="px-2 py-1 font-mono">{l.line_id}</td><td className="px-2">{l.aop_code}</td><td className="px-2 font-mono">{l.wbs}</td>
                          <td className="px-2">{l.category}</td><td className="px-2">{l.tag}</td>
                          <td className="px-2">{l.po_start} → {l.po_end}</td><td className="px-2 text-right tabular-nums">{L(l.net_po)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PoLink({ po, current, onOpenPo }) {
  if (!po) return null;
  const p = String(po);
  if (p === current || !onOpenPo) return <span className="font-mono mr-1">{p}</span>;
  return <button className="font-mono mr-1 text-[var(--gold)] underline decoration-dotted" onClick={() => onOpenPo(p)}>{p}</button>;
}
