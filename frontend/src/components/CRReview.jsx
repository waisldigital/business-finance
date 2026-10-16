import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { formatMoney, formatDate } from "@/aop/format";
import StatTile from "@/components/common/StatTile";
import { Check, X, WarningCircle, Package, LinkSimple } from "@phosphor-icons/react";

const TERMINAL = ["approved", "completed", "rejected"];
const MARGIN_FLOOR = 25;
const num = (n) => (n || n === 0 ? Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");

/** Who may decide a CR: its designated approvers and admins, once the WBS is approved and the CR is open. */
export function canDecideCR(cr, user) {
  if (!cr || !user) return false;
  const mine = user.role === "admin" || (cr.approver_emails || []).map((e) => e.toLowerCase()).includes((user.email || "").toLowerCase());
  return mine && !!cr.wbs_approved && !TERMINAL.includes(cr.status) && cr.status !== "draft";
}

/**
 * A change request's key facts and, for its approver, the approve / reject decision with a comment.
 * Used in the CR list, the approvals inbox and notification links.
 */
export default function CRReview({ id, onDecided }) {
  const { user } = useAuth();
  const [cr, setCr] = useState(null);
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCr(null); setErr("");
    api.get(`/change-requests/${id}`).then((r) => setCr(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [id]);

  const decide = async (action) => {
    if (action === "reject" && !comment.trim()) { setErr("Add a comment explaining the rejection."); return; }
    setBusy(true); setErr("");
    try {
      const body = action === "approve" ? { comment } : { reason: comment };
      const { data } = await api.post(`/change-requests/${id}/${action}`, body);
      setCr(data);
      onDecided?.(data);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  if (err && !cr) return <div className="p-5 text-sm text-[var(--danger)]">{String(err)}</div>;
  if (!cr) return <div className="p-5 text-sm text-[var(--muted)]">Loading…</div>;
  const margin = Number(cr.estimated_margin_pct || 0);
  const decide_ok = canDecideCR(cr, user);
  return (
    <div className="p-5 space-y-4 text-sm" data-testid="cr-review">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Fact label="CR number" value={cr.cr_number} mono />
        <Fact label="Status" value={String(cr.status || "").replace(/_/g, " ")} />
        <Fact label="Customer" value={cr.customer_name || "—"} />
        <Fact label="Airport" value={cr.airport_name || "—"} />
        <Fact label="WBS" value={cr.wbs_element || "—"} mono />
        <Fact label="PO value" value={num(cr.po_value)} />
        <Fact label="Vendor cost" value={num(cr.vendor_cost)} />
        <Fact label="Margin" value={`${margin.toFixed(1)} %`} tone={margin >= MARGIN_FLOOR ? "ok" : "bad"}
              note={margin < MARGIN_FLOOR ? `Below the ${MARGIN_FLOOR}% threshold` : undefined} />
      </div>
      {cr.business_justification && (
        <div><div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">Business justification</div><div>{cr.business_justification}</div></div>
      )}
      <div className="text-xs text-[var(--muted)]">
        Approvers: {(cr.approver_emails || []).join(", ") || "—"}
        {cr.approved_by && <> · approved by {cr.approved_by}{cr.approval_comment ? ` — “${cr.approval_comment}”` : ""}</>}
        {cr.rejected_reason && <> · rejected: “{cr.rejected_reason}”</>}
      </div>
      {!cr.wbs_approved && !TERMINAL.includes(cr.status) && (
        <div className="text-xs text-[var(--warning)] flex items-center gap-1"><WarningCircle size={13} /> Waiting for Finance to approve the WBS before it can be decided.</div>
      )}
      {decide_ok && (
        <div className="border-t border-[var(--border)] pt-3 space-y-2" data-testid="cr-decision">
          <textarea className="input w-full" rows={3} placeholder="Comment (required to reject)" value={comment}
                    onChange={(e) => setComment(e.target.value)} data-testid="cr-decision-comment" />
          <div className="flex items-center gap-2 justify-end">
            {err && <span className="text-xs text-[var(--danger)] mr-auto">{String(err)}</span>}
            <button className="btn-secondary text-xs flex items-center gap-1" disabled={busy} onClick={() => decide("reject")} data-testid="cr-reject-btn">
              <X size={12} weight="bold" /> Reject
            </button>
            <button className="btn-primary text-xs flex items-center gap-1" disabled={busy} onClick={() => decide("approve")} data-testid="cr-approve-btn">
              <Check size={12} weight="bold" /> Approve
            </button>
          </div>
        </div>
      )}
      {cr.wbs_element && <CRPOTracker crId={id} wbs={cr.wbs_element} />}
    </div>
  );
}

function Fact({ label, value, mono, tone, note }) {
  const color = tone === "ok" ? "var(--success, #22c55e)" : tone === "bad" ? "var(--danger)" : undefined;
  return (
    <div className="border border-[var(--border)] px-3 py-2">
      <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
      <div className={`font-semibold capitalize-first ${mono ? "font-mono text-xs" : ""}`} style={{ color }}>{value}</div>
      {note && <div className="text-[10px]" style={{ color }}>{note}</div>}
    </div>
  );
}

function CRPOTracker({ crId, wbs }) {
  const { unit } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    api.get(`/change-requests/${crId}/matched-pos`)
      .then((r) => setData(r.data))
      .catch(() => setData({ wbs: null, pos: [], summary: { count: 0, total_value_inr: 0 } }))
      .finally(() => setLoading(false));
  }, [crId]);

  if (loading) return <div className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)] text-center py-4">Loading matched POs…</div>;
  if (!data?.wbs) return null;

  const pos = (data.pos || []).filter((po) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (po.purchase_order || "").toLowerCase().includes(s)
      || (po.supplier_name || "").toLowerCase().includes(s)
      || (po.material_description || "").toLowerCase().includes(s)
      || (po.wbs || "").toLowerCase().includes(s);
  });

  const uniquePOs = new Set(pos.map((p) => p.purchase_order)).size;

  return (
    <div className="border-t border-[var(--border)] pt-4 space-y-3" data-testid="cr-po-tracker">
      <div className="flex items-center gap-2">
        <Package size={16} weight="duotone" className="text-[var(--gold)]" />
        <span className="font-semibold text-sm">PO Tracker</span>
        <span className="text-[10px] text-[var(--muted)] font-mono">{wbs}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="PO Lines" value={data.summary.count} size="sm" testid="cr-po-count" />
        <StatTile label="Unique POs" value={uniquePOs} size="sm" testid="cr-po-unique" />
        <StatTile label="Value (INR)" value={formatMoney(data.summary.total_value_inr, unit)} size="sm" accent testid="cr-po-value" />
      </div>

      {data.summary.count > 0 && (
        <>
          <div className="relative max-w-xs">
            <input className="input pl-7 h-7 text-xs" placeholder="Search PO, supplier…" value={search}
                   onChange={(e) => setSearch(e.target.value)} data-testid="cr-po-search" />
            <Package size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          </div>
          <div className="overflow-auto max-h-[280px]">
            <table className="tbl" data-testid="cr-po-table">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Item</th>
                  <th>Supplier</th>
                  <th>Material</th>
                  <th className="num">Value (INR)</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((po, i) => (
                  <tr key={`${po.purchase_order}-${po.purchase_order_item}-${i}`}>
                    <td className="font-mono text-xs font-semibold">{po.purchase_order || "—"}</td>
                    <td className="font-mono text-xs">{po.purchase_order_item || "—"}</td>
                    <td className="text-xs">{po.supplier_name || "—"}</td>
                    <td className="text-xs max-w-[160px] truncate" title={po.material_description}>{po.material_description || po.material || "—"}</td>
                    <td className="num font-mono text-xs">{formatMoney(po.value_inr || po.net_order_value, unit)}</td>
                    <td className="text-xs">{formatDate(po.created_on)}</td>
                    <td>
                      {po.link_status ? (
                        <span className={`px-1.5 py-0.5 text-[10px] tracking-overline font-semibold ${po.link_status === "Linked" ? "bg-[rgba(34,197,94,0.18)] text-[#22c55e]" : "bg-[rgba(234,179,8,0.18)] text-[#eab308]"}`}>
                          {po.link_status}
                        </span>
                      ) : <span className="text-[var(--muted)] text-xs">—</span>}
                    </td>
                  </tr>
                ))}
                {pos.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-6 text-[var(--muted)]">
                    {search ? "No POs match your search." : "No PO rows found for this WBS."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data.summary.count === 0 && (
        <div className="text-xs text-[var(--muted)] flex items-center gap-1.5">
          <LinkSimple size={12} /> No PO register rows found for WBS {wbs}
        </div>
      )}
    </div>
  );
}
