import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, EnvelopeSimple, Phone, Buildings, WarningOctagon } from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { mode, inrPerUsd } = useCurrency();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/customers/${id}/profile`).then((r) => setData(r.data)).catch(() => {});
  }, [id]);

  if (!data) return <div className="p-8" data-testid="customer-profile-loading">Loading…</div>;

  const { customer, totals, billing, ageing_buckets, stage_distribution, projects } = data;

  return (
    <div data-testid="customer-profile-page">
      <PageHeader
        title={customer.customer_name}
        subtitle={`SAP ${customer.sap_customer_code || "—"}  ·  ${customer.country || ""}`}
        breadcrumb={<><button onClick={() => navigate("/customers")} className="hover:text-[var(--gold)] inline-flex items-center gap-1"><ArrowLeft size={11}/> ALL CUSTOMERS</button> · PROFILE</>}
        testid="customer-profile-header"
      />

      <div className="px-8 py-6 space-y-6">
        {/* Contact + risk strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="tile p-5">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Primary Contact</div>
            <div className="font-display font-bold mt-1">{customer.contact_person || "—"}</div>
            <div className="text-xs text-[var(--muted)] mt-2 flex items-center gap-1.5"><EnvelopeSimple size={12}/> {customer.email || "—"}</div>
            <div className="text-xs text-[var(--muted)] mt-1 flex items-center gap-1.5"><Phone size={12}/> {customer.phone || "—"}</div>
            {customer.secondary_contact_person && (
              <div className="mt-3 pt-3 border-t border-[var(--border-soft)]">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Secondary Contact</div>
                <div className="text-sm mt-1">{customer.secondary_contact_person}</div>
                <div className="text-xs text-[var(--muted)] mt-1">{customer.secondary_email || ""} {customer.secondary_phone ? `· ${customer.secondary_phone}` : ""}</div>
              </div>
            )}
          </div>
          <div className="tile p-5">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">SAP Outstanding</div>
            <div className="font-mono font-semibold text-2xl mt-1 text-[var(--gold)]">{formatCurrency(customer.balance_outstanding_sap, mode, inrPerUsd)}</div>
            <div className="text-xs text-[var(--muted)] mt-1">Sync from SAP master</div>
            {(customer.industry || customer.sector) && (
              <div className="mt-3 pt-3 border-t border-[var(--border-soft)] text-xs">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Industry / Sector</div>
                <div className="mt-1">{[customer.industry, customer.sector].filter(Boolean).join(" · ") || "—"}</div>
              </div>
            )}
          </div>
          <div className={`tile p-5 ${customer.risk_notes ? "border-[#B45309]" : ""}`}>
            <div className="text-[10px] tracking-overline text-[var(--muted)] flex items-center gap-1"><WarningOctagon size={12}/> Risk Notes</div>
            <div className="text-sm mt-1 text-[var(--text)]">{customer.risk_notes || "No risk flagged"}</div>
            {customer.account_owner_email && (
              <div className="mt-3 pt-3 border-t border-[var(--border-soft)] text-xs">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Account Owner</div>
                <div className="mt-1">{customer.account_owner_email}</div>
              </div>
            )}
          </div>
        </div>

        {/* Addresses */}
        {(customer.address_billing || customer.address_shipping || customer.website) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="customer-addresses">
            {customer.address_billing && (
              <div className="tile p-5">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Billing Address</div>
                <div className="text-sm mt-1 whitespace-pre-line">{customer.address_billing}</div>
              </div>
            )}
            {customer.address_shipping && (
              <div className="tile p-5">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Shipping Address</div>
                <div className="text-sm mt-1 whitespace-pre-line">{customer.address_shipping}</div>
              </div>
            )}
            {customer.website && (
              <div className="tile p-5">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Website</div>
                <a href={customer.website} target="_blank" rel="noreferrer" className="text-sm mt-1 block text-[var(--gold)] underline">{customer.website}</a>
              </div>
            )}
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Projects" value={totals.project_count} />
          <Stat label="Total PO" value={formatCurrency(totals.total_po, mode, inrPerUsd)} />
          <Stat label="Revenue" value={formatCurrency(totals.total_revenue, mode, inrPerUsd)} />
          <Stat label="Margin" value={formatCurrency(totals.total_margin, mode, inrPerUsd)} accent />
          <Stat label="Margin %" value={`${(totals.margin_pct || 0).toFixed(1)}%`}
                accent={totals.margin_pct >= 15}
                danger={totals.margin_pct < 15} />
        </div>

        {/* Billing + Ageing */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="tile p-5">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Billing Position</div>
            <div className="font-display text-lg font-bold mb-3">Recognized vs Billed vs Unbilled</div>
            <div className="space-y-2">
              <Row label="Recognized" value={formatCurrency(billing.recognized, mode, inrPerUsd)} />
              <Row label="Billed" value={formatCurrency(billing.billed, mode, inrPerUsd)} />
              <Row label="Unbilled" value={formatCurrency(billing.unbilled, mode, inrPerUsd)} accent />
            </div>
          </div>

          <div className="tile p-5" data-testid="ageing-chart">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Unbilled Ageing</div>
            <div className="font-display text-lg font-bold mb-3">Recognized but Not Billed (days)</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={ageing_buckets}>
                <CartesianGrid strokeDasharray="2 4" stroke="#E5E5E0" />
                <XAxis dataKey="bucket" stroke="#5E5E5A" fontSize={11} />
                <YAxis stroke="#5E5E5A" fontSize={11} />
                <Tooltip formatter={(v) => formatCurrency(v, mode, inrPerUsd)} contentStyle={{ borderRadius: 2, borderColor: "#E5E5E0", fontSize: 12 }} />
                <Bar dataKey="amount">
                  {ageing_buckets.map((b, i) => (
                    <Cell key={i} fill={b.bucket === "90+" ? "#991B1B" : b.bucket === "61-90" ? "#B45309" : "#A67C00"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Linked projects */}
        <div className="tile p-5" data-testid="customer-projects-table">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] tracking-overline text-[var(--muted)]">Linked Projects</div>
              <div className="font-display text-lg font-bold">{projects.length} project(s)</div>
            </div>
            <Buildings size={18} weight="duotone" className="text-[var(--gold)]" />
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th><th>WBS</th><th>Stage</th><th>Approval</th>
                <th className="num">PO</th><th className="num">Margin %</th><th>Start</th><th>End</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.id}`)} data-testid={`cust-project-${p.id}`}>
                  <td className="font-medium">{p.project_name}</td>
                  <td className="font-mono text-xs">{p.wbs_element || "—"}</td>
                  <td><StatusBadge status={p.current_stage} /></td>
                  <td><StatusBadge status={p.approval_status} /></td>
                  <td className="num">{formatCurrency(p.po_value, mode, inrPerUsd)}</td>
                  <td className={`num ${(p.margin_pct || 0) < 15 ? "text-[var(--danger)]" : ""}`}>{(p.margin_pct || 0).toFixed(1)}%</td>
                  <td>{formatDate(p.start_date)}</td>
                  <td>{formatDate(p.end_date)}</td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-[var(--muted)]">No linked projects</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Stage distribution */}
        {stage_distribution.length > 0 && (
          <div className="tile p-5">
            <div className="text-[10px] tracking-overline text-[var(--muted)]">Stage Distribution</div>
            <div className="font-display text-lg font-bold mb-3">Where this customer's projects sit today</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {stage_distribution.map((s) => (
                <div key={s.stage} className="border border-[var(--border)] p-3">
                  <div className="text-[10px] tracking-overline text-[var(--muted)]">{s.stage}</div>
                  <div className="font-mono text-2xl font-semibold mt-1">{s.count}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, danger }) {
  return (
    <div className="tile p-4">
      <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
      <div className={`font-mono font-semibold text-xl mt-1 ${accent ? "text-[var(--gold)]" : danger ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-[var(--border)] pb-2">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`font-mono font-semibold ${accent ? "text-[var(--gold)]" : ""}`}>{value}</span>
    </div>
  );
}
