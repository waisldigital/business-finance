import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { X, ClockCounterClockwise, Swap, Receipt } from "@phosphor-icons/react";
import { fmtAmount, fmtCell } from "./format";
import StatTile from "@/components/common/StatTile";
import { PoBody } from "./PoDrawer";

const L = (v) => fmtAmount(v, "lakh");

/** A tracker line's PO history: header, timeline (own PO first, then every linked SAP PO) and the clicked PO in full.
 *  Any PO number inside opens that PO in place. */
export default function PoHistoryDrawer({ lineId, po, onClose }) {
  const [cur, setCur] = useState({ lineId, po });
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    const q = cur.po ? `?po=${encodeURIComponent(cur.po)}` : "";
    api.get(`/aop/opex/lines/${encodeURIComponent(cur.lineId)}/history${q}`).then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [cur]);
  const open = (p) => setCur((c) => ({ ...c, po: p }));
  const openLine = (l, p) => setCur({ lineId: l, po: p });
  const h = data?.line || {};
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose} data-testid="po-history-drawer">
      <div className="w-full max-w-5xl h-full bg-[var(--surface)] border-l border-[var(--border)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <ClockCounterClockwise size={18} className="text-[var(--gold)]" />
          <div className="flex-1">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Opex line · PO history</div>
            <div className="font-semibold font-mono">{cur.lineId}{h.aop_code ? ` · ${h.aop_code}` : ""}{h.vendor ? ` · ${h.vendor}` : ""}</div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="overflow-auto p-4 space-y-4 text-xs">
          {err && <div className="text-[var(--danger)]">{String(err)}</div>}
          {!data && !err && <div className="text-[var(--muted)]">Loading…</div>}
          {data && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {h.wbs && <span className="chip font-mono">{h.wbs}</span>}
                {h.tag && <span className="chip">{h.tag}</span>}
                {h.recurring && <span className="chip">{h.recurring}</span>}
                {h.mapping_status && <span className="chip">{h.mapping_status}</span>}
                {h.parent_line_id && <span className="chip">Add-on of <button className="underline ml-1" onClick={() => openLine(h.parent_line_id)}>{h.parent_line_id}</button></span>}
                {h.add_ons?.map((a) => <button key={a} className="chip underline" onClick={() => openLine(a)}>Add-on {a}</button>)}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatTile size="sm" label={`Budget FY'${(h.plan_fy || "").slice(2)} (₹ L)`} value={L(h.budget)} />
                <StatTile size="sm" label="Forecast (₹ L)" value={L(h.forecast)} />
                <StatTile size="sm" label="Budget − forecast (₹ L)" value={L((h.budget || 0) - (h.forecast || 0))} />
              </div>
              <section>
                <h3 className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1.5">Timeline (oldest → latest)</h3>
                <div className="space-y-1">
                  {data.timeline.map((t, i) => (
                    <div key={i} className={`flex items-center gap-2 border px-2 py-1 ${String(t.po) === String(data.po) ? "border-[var(--gold)] bg-[var(--surface-2)]" : "border-[var(--border)]"}`}>
                      <span className="chip w-14 justify-center">{t.own ? "Own PO" : `Gen ${t.generation}`}</span>
                      <Receipt size={12} className="text-[var(--muted)]" />
                      <button className="font-mono text-[var(--gold)] underline decoration-dotted" onClick={() => open(String(t.po))}>{t.po}</button>
                      {(t.material || t.po_item) && <span className="chip font-mono">{[t.material, t.po_item].filter(Boolean).join(" / ")}</span>}
                      <span className="flex-1 truncate">{t.supplier}</span>
                      {t.supplier_changed && <span className="chip !text-[var(--warning)]"><Swap size={10} />supplier changed</span>}
                      <span className="text-[var(--muted)]">{fmtCell(t.period_start, "date")} → {fmtCell(t.period_end, "date")}</span>
                      <span className="tabular-nums w-20 text-right">₹{L(t.allocated_inr)} L</span>
                      {t.alloc_pct !== undefined && t.alloc_pct !== null && <span className="tabular-nums">{(t.alloc_pct * 100).toFixed(0)}%</span>}
                      <span className="w-14 text-right">{t.grn_pct !== undefined && t.grn_pct !== null ? `GRN ${(t.grn_pct * 100).toFixed(0)}%` : ""}</span>
                      <span className="chip">{t.status}</span>
                    </div>
                  ))}
                </div>
              </section>
              {data.detail?.kind === "sap" && (
                <section className="border-t border-[var(--border)] pt-3 space-y-4">
                  <div className="font-semibold">PO <span className="font-mono">{data.po}</span></div>
                  <PoBody data={data.detail} po={data.po} onOpenPo={open} onOpenLine={openLine} />
                </section>
              )}
              {data.detail?.kind === "legacy" && (
                <section className="border-t border-[var(--border)] pt-3">
                  <div className="font-semibold mb-1">PO <span className="font-mono">{data.po}</span> <span className="chip">legacy (not in the ZMM)</span></div>
                  <table className="border border-[var(--border)]">
                    <tbody>
                      {Object.entries(data.detail.fields).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                        <tr key={k} className="border-t border-[var(--border-soft)]">
                          <td className="px-2 py-0.5 text-[var(--muted)]">{k.replace(/_/g, " ")}</td>
                          <td className="px-2 py-0.5">{typeof v === "number" ? fmtCell(v, "number") : String(v)}</td>
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
