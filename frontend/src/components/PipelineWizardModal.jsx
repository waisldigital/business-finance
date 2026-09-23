import React, { useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { X, CheckCircle, Warning, CaretLeft, CaretRight } from "@phosphor-icons/react";
import AirplaneButton from "./AirplaneButton";

const CURRENCIES = ["USD", "INR", "AED", "AUD", "CNY", "EUR", "GBP", "JPY", "RUB", "SAR", "SGD"];
const SOLUTION_LINES = [
  "Airport IT", "Cybersecurity", "Network", "Command Center",
  "Cloud", "Managed Services", "Smart City", "Other",
];
const OPP_TYPES = ["New Business", "Existing Client Expansion", "Renewal", "Cross-sell", "Upsell"];
const NATURE_OF_WORK = ["High Resource Cost", "High TP Cost", "Hybrid"];
const LEAD_SOURCES = ["Referral", "Existing Client", "Tender", "RFP", "Partner", "Direct", "Event", "Govt Bid"];
const SOURCE_TYPES = ["Inbound", "Outbound", "Partner-led", "Consultant-led"];
const FORECAST_CATEGORIES = ["Commit", "Best Case", "Pipeline", "Upside"];

// Each stage has multiple sections (logical groups). Required fields are advisory only.
const STAGE_DEFS = [
  {
    key: "Prospecting",
    label: "Prospecting",
    description: "Basic qualification + customer identification",
    sections: [
      {
        title: "Opportunity",
        fields: [
          ["opportunity_title", "Opportunity Name", "text", { required: true, full: true }],
          ["opportunity_id", "Opportunity ID (auto)", "text", { readonly: true }],
          ["customer_name", "Customer", "customer", { required: true }],
          ["opportunity_category", "Opportunity Category", "select", { required: true, options: ["Project", "Change Request"] }],
          ["opportunity_type", "Opportunity Type", "select", { options: OPP_TYPES }],
          ["solution_line", "Solution / Service Line", "select", { options: SOLUTION_LINES }],
          ["nature_of_work", "Nature of Work", "select", { options: NATURE_OF_WORK }],
          ["business_need", "Business Need / Problem Statement", "textarea", { full: true }],
        ],
      },
      {
        title: "Ownership & Source",
        fields: [
          ["bd_owner", "Opportunity Owner (Email)", "email", { required: true }],
          ["lead_source", "Lead Source", "select", { options: LEAD_SOURCES }],
          ["opportunity_source_type", "Source Type", "select", { options: SOURCE_TYPES }],
          ["strategic_relevance", "Strategic Relevance", "select", { options: ["High", "Medium", "Low"] }],
          ["relationship_strength", "Relationship Strength", "select", { options: ["Strong", "Medium", "Weak"] }],
          ["industry", "Industry / Sector", "text"],
        ],
      },
      {
        title: "Initial Sizing",
        fields: [
          ["expected_revenue", "Expected Revenue", "number", { required: true }],
          ["currency", "Currency", "currency", { required: true }],
          ["business_category", "GMR / Non-GMR", "select", { required: true, options: ["GMR", "Non-GMR"] }],
          ["priority", "Priority", "select", { options: ["High", "Medium", "Low"] }],
        ],
      },
    ],
  },
  {
    key: "Active Discussion",
    label: "Active Discussion",
    description: "Detailed discussions + seriousness validation",
    sections: [
      {
        title: "Solution",
        fields: [
          ["solution_scope", "Solution Scope", "textarea", { required: true, full: true }],
          ["expected_timeline", "Expected Timeline", "text"],
          ["competitors", "Competitors Identified", "text"],
        ],
      },
      {
        title: "Stakeholders",
        fields: [
          ["decision_maker_name", "Decision Maker Name", "text"],
          ["decision_maker_designation", "Decision Maker Designation", "text"],
          ["influencer_contact", "Influencer / Tech Evaluator", "text"],
          ["procurement_contact", "Procurement Contact", "text"],
          ["finance_contact", "Finance Contact", "text"],
        ],
      },
      {
        title: "Qualification",
        fields: [
          ["is_rfp_available", "RFP Available?", "boolean"],
          ["rfp_number", "RFP / Tender Number", "text"],
          ["competitor_involved", "Competitor Involved?", "boolean"],
          ["key_competitors", "Key Competitors", "text"],
          ["customer_budget_approved", "Customer Budget Approved?", "boolean"],
          ["customer_funding_confirmed", "Customer Funding Confirmed?", "boolean"],
        ],
      },
      {
        title: "Sales Tracking",
        fields: [
          ["last_interaction_date", "Last Customer Interaction", "date"],
          ["next_action", "Next Action", "text", { full: true }],
          ["next_action_owner", "Next Action Owner", "text"],
          ["next_followup_date", "Next Follow-up Date", "date"],
          ["estimated_deal_value", "Estimated Deal Value", "number"],
          ["probability_pct", "Probability of Closure %", "number"],
        ],
      },
    ],
  },
  {
    key: "Proposal Submitted",
    label: "Proposal Submitted",
    description: "Formal commercial and technical submission",
    sections: [
      {
        title: "Commercials",
        fields: [
          ["proposal_value", "Proposal Value", "number", { required: true }],
          ["acv", "ACV (Annual Contract Value)", "number"],
          ["tcv", "TCV (Total Contract Value)", "number"],
          ["one_time_revenue", "One-time Revenue", "number"],
          ["recurring_revenue", "Recurring Revenue", "number"],
          ["expected_gross_margin_pct", "Expected Gross Margin %", "number"],
          ["expected_capex", "Expected Capex", "number"],
          ["expected_tp_opex", "Expected TP Opex", "number"],
          ["expected_resource_cost", "Expected Resource Cost", "number"],
        ],
      },
      {
        title: "Terms & Dates",
        fields: [
          ["payment_terms", "Payment Terms", "text"],
          ["contract_duration", "Contract Duration", "text"],
          ["revenue_start_date", "Revenue Start Date", "date"],
          ["expected_closure_date", "Expected Closure Date", "date"],
          ["expected_go_live_date", "Expected Go-Live Date", "date"],
          ["forecast_category", "Forecast Category", "select", { options: FORECAST_CATEGORIES }],
        ],
      },
      {
        title: "Sales Tracking",
        fields: [
          ["proposal_submitted_on", "Proposal Submitted Date", "date", { required: true }],
          ["commercial_submitted_date", "Commercial Submitted Date", "date"],
          ["proposal_validity", "Proposal Validity", "text"],
          ["deal_qualification_score", "Deal Qualification Score (0–10)", "number"],
          ["proposal_notes", "Proposal Notes", "textarea", { full: true }],
        ],
      },
    ],
  },
  {
    key: "Evaluation/Negotiation",
    label: "Evaluation / Negotiation",
    description: "POC + negotiations + approvals",
    sections: [
      {
        title: "Negotiation",
        fields: [
          ["negotiated_value", "Negotiated Value", "number", { required: true }],
          ["estimated_margin_pct", "Estimated Margin %", "number", { required: true }],
          ["expected_decision_date", "Expected Decision Date", "date", { required: true }],
          ["negotiation_notes", "Negotiation Notes", "textarea", { full: true }],
        ],
      },
      {
        title: "Evaluation",
        fields: [
          ["poc_required", "POC Required?", "boolean"],
          ["poc_status", "POC Status", "text"],
        ],
      },
      {
        title: "Approval Tracking",
        fields: [
          ["technical_evaluation_status", "Technical Evaluation Status", "select", { options: ["Pending", "Cleared", "Concerns"] }],
          ["legal_review_status", "Legal Review Status", "select", { options: ["Pending", "Cleared", "Concerns"] }],
          ["procurement_status", "Procurement Status", "select", { options: ["Pending", "Cleared", "Concerns"] }],
          ["approval_tracking_status", "Final Approval Status", "select", { options: ["Pending", "Approved", "Rejected"] }],
        ],
      },
    ],
  },
  {
    key: "Closed",
    label: "Closed",
    description: "Final closure with proof — Won / Lost / Deferred",
    sections: [
      {
        title: "Final Status",
        fields: [
          ["outcome", "Outcome", "select", { required: true, options: ["Open", "Won", "Lost", "Deferred"] }],
          ["closure_date", "Closure Date", "date", { required: true }],
        ],
      },
      // The form below is conditionally rendered by outcome
    ],
  },
];

// Closed-stage conditional sections
const CLOSED_WON_FIELDS = [
  ["customer_po_number", "Customer PO Number / Contract ID", "text", { required: true }],
  ["contract_id", "Contract ID (alt)", "text"],
  ["contract_signed_date", "Contract Signed Date", "date"],
  ["billing_frequency", "Billing Frequency", "select", { options: ["Recurring", "Milestone", "Hybrid"] }],
  ["final_commercial_value", "Final Commercial Value", "number", { required: true }],
  ["final_revenue_start_date", "Final Revenue Start Date", "date"],
  ["final_go_live_date", "Final Go-Live Date", "date"],
  ["won_against_competitor", "Won Against Competitor", "text"],
  ["lessons_learned", "Lessons Learned / Remarks", "textarea", { full: true }],
];
const CLOSED_LOST_FIELDS = [
  ["win_loss_reason", "Lost Reason", "textarea", { required: true, full: true }],
  ["competitor_won_against_us", "Competitor Won Against Us", "text"],
  ["lessons_learned", "Lessons Learned / Remarks", "textarea", { full: true }],
];
const CLOSED_DEFERRED_FIELDS = [
  ["win_loss_reason", "Deferred Reason", "textarea", { required: true, full: true }],
  ["expected_revisit_date", "Expected Revisit Date", "date"],
  ["lessons_learned", "Lessons Learned / Remarks", "textarea", { full: true }],
];

const MGMT_FLAGS = [
  ["md_review_required", "MD Review Required"],
  ["cfo_review_required", "CFO Review Required"],
  ["ceo_visibility", "CEO Visibility"],
  ["strategic_deal", "Strategic Deal"],
];

const emptyForm = {
  opportunity_title: "", opportunity_id: "", customer_id: "", customer_name: "", bd_owner: "",
  expected_revenue: 0, currency: "USD",
  opportunity_category: "Project", opportunity_type: "", solution_line: "",
  business_need: "", nature_of_work: "", lead_source: "", opportunity_source_type: "",
  strategic_relevance: "", relationship_strength: "", industry: "",
  solution_scope: "", expected_timeline: "", competitors: "",
  decision_maker_name: "", decision_maker_designation: "",
  influencer_contact: "", procurement_contact: "", finance_contact: "",
  is_rfp_available: false, rfp_number: "", competitor_involved: false, key_competitors: "",
  customer_budget_approved: false, customer_funding_confirmed: false,
  last_interaction_date: "", next_action: "", next_action_owner: "", next_followup_date: "",
  estimated_deal_value: 0, probability_pct: 0,
  proposal_value: 0, proposal_submitted_on: "", proposal_validity: "", proposal_notes: "",
  acv: 0, tcv: 0, one_time_revenue: 0, recurring_revenue: 0,
  expected_gross_margin_pct: 0, expected_capex: 0, expected_tp_opex: 0, expected_resource_cost: 0,
  payment_terms: "", contract_duration: "", revenue_start_date: "",
  expected_closure_date: "", expected_go_live_date: "", forecast_category: "",
  commercial_submitted_date: "", deal_qualification_score: "",
  negotiated_value: 0, estimated_margin_pct: 0, expected_decision_date: "", negotiation_notes: "",
  poc_required: false, poc_status: "",
  technical_evaluation_status: "", legal_review_status: "",
  procurement_status: "", approval_tracking_status: "",
  outcome: "Open", closure_date: "", win_loss_reason: "",
  customer_po_number: "", contract_id: "", contract_signed_date: "",
  billing_frequency: "", final_commercial_value: 0,
  final_revenue_start_date: "", final_go_live_date: "",
  lessons_learned: "", competitor_won_against_us: "", expected_revisit_date: "",
  business_category: "Non-GMR", priority: "Medium",
  md_review_required: false, cfo_review_required: false, ceo_visibility: false, strategic_deal: false,
  remarks: "",
};

export default function PipelineWizardModal({ opportunity, customers, onClose, onSaved }) {
  const [form, setForm] = useState(opportunity ? { ...emptyForm, ...opportunity } : emptyForm);
  const [activeStage, setActiveStage] = useState(0);
  const [validationPopup, setValidationPopup] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Soft validation: list missing required fields for upcoming stage
  const checkRequired = (stageIdx) => {
    const stage = STAGE_DEFS[stageIdx];
    const missing = [];
    const allFields = [...(stage.sections || [])].flatMap((s) => s.fields || []);
    if (stageIdx === 4) {
      // Closed — pull conditional list based on outcome
      const out = form.outcome;
      const conditional = out === "Won" ? CLOSED_WON_FIELDS
        : out === "Lost" ? CLOSED_LOST_FIELDS
        : out === "Deferred" ? CLOSED_DEFERRED_FIELDS : [];
      allFields.push(...conditional);
    }
    for (const [name, label, , opts] of allFields) {
      if (!opts?.required) continue;
      const v = form[name];
      const empty = v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v));
      if (empty) missing.push(label);
    }
    return missing;
  };

  const next = () => {
    if (activeStage >= STAGE_DEFS.length - 1) return;
    const missing = checkRequired(activeStage);
    if (missing.length) {
      setValidationPopup({ stageIdx: activeStage, nextIdx: activeStage + 1, missing });
    } else {
      setActiveStage(activeStage + 1);
    }
  };
  const prev = () => setActiveStage((i) => Math.max(0, i - 1));

  const onSubmit = async () => {
    setBusy(true); setErr("");
    try {
      const numericKeys = [
        "expected_revenue", "estimated_deal_value", "probability_pct",
        "proposal_value", "acv", "tcv", "one_time_revenue", "recurring_revenue",
        "expected_gross_margin_pct", "expected_capex", "expected_tp_opex", "expected_resource_cost",
        "negotiated_value", "estimated_margin_pct", "final_commercial_value",
      ];
      const payload = { ...form };
      for (const k of numericKeys) payload[k] = Number(payload[k] || 0);
      payload.deal_qualification_score = payload.deal_qualification_score === "" ? null : Number(payload.deal_qualification_score);
      if (opportunity?.id) {
        await api.put(`/pipeline/${opportunity.id}`, payload);
      } else {
        await api.post("/pipeline", payload);
      }
      onSaved();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="pipeline-wizard-modal">
      <div className="bg-[var(--surface)] w-full max-w-5xl max-h-[94vh] overflow-y-auto border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)] sticky top-0 bg-[var(--surface)] z-10">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">{opportunity ? "EDIT" : "NEW"} OPPORTUNITY</div>
            <h2 className="font-display text-xl font-bold">{opportunity?.opportunity_title || "New Pipeline Opportunity"}</h2>
            {form.opportunity_id && (
              <div className="text-[11px] font-mono text-[var(--muted)]">{form.opportunity_id}</div>
            )}
          </div>
          <button className="btn-ghost" onClick={onClose} data-testid="pipeline-modal-close"><X size={18} /></button>
        </div>

        {/* Stage tabs */}
        <div className="grid grid-cols-5 border-b border-[var(--border)] sticky top-[81px] bg-[var(--surface)] z-10" data-testid="pipeline-stage-tabs">
          {STAGE_DEFS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setActiveStage(i)}
              className={`px-3 py-3 text-left border-r border-[var(--border)] transition-colors last:border-r-0
                ${i === activeStage ? "bg-[var(--surface-2)] border-b-2 border-b-[var(--gold)]" : "opacity-70 hover:opacity-100"}`}
              data-testid={`pipeline-tab-${i}`}
            >
              <div className="text-[10px] tracking-overline text-[var(--muted)]">Stage {i + 1}</div>
              <div className="font-display text-xs font-bold text-[var(--text)] truncate">{s.label}</div>
            </button>
          ))}
        </div>

        <div className="p-5 space-y-5">
          <div className="text-[11px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--text)]">{STAGE_DEFS[activeStage].label}</span> — {STAGE_DEFS[activeStage].description}
            <span className="ml-3 text-[var(--gold)]">* marks required fields (informational only — validation is a soft checklist).</span>
          </div>

          {/* Render sections */}
          <div className="space-y-5" data-testid={`pipeline-stage-panel-${activeStage}`}>
            {STAGE_DEFS[activeStage].sections.map((sec, si) => (
              <div key={si} className="border border-[var(--border)] p-4">
                <div className="text-[10px] tracking-overline text-[var(--muted)] mb-3">{sec.title}</div>
                <div className="grid grid-cols-2 gap-4">
                  {sec.fields.map((f) => (
                    <FieldRenderer key={f[0]} fieldDef={f} form={form} set={set} customers={customers} />
                  ))}
                </div>
              </div>
            ))}

            {activeStage === 4 && (
              <div className="border border-[var(--border)] p-4" data-testid="pipeline-closed-conditional">
                <div className="text-[10px] tracking-overline text-[var(--muted)] mb-3">
                  {form.outcome === "Won" ? "Closed — Won Details (PO / Contract / Final Value)"
                    : form.outcome === "Lost" ? "Closed — Lost Details"
                    : form.outcome === "Deferred" ? "Closed — Deferred / Dropped Details"
                    : "Set Outcome above to reveal closure fields"}
                </div>
                {form.outcome !== "Open" && (
                  <div className="grid grid-cols-2 gap-4">
                    {(form.outcome === "Won" ? CLOSED_WON_FIELDS
                      : form.outcome === "Lost" ? CLOSED_LOST_FIELDS
                      : CLOSED_DEFERRED_FIELDS).map((f) => (
                        <FieldRenderer key={f[0]} fieldDef={f} form={form} set={set} customers={customers} />
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Management Review flags — visible on every stage */}
            <div className="border border-[var(--border)] p-4">
              <div className="text-[10px] tracking-overline text-[var(--muted)] mb-3">Management Review Flags</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {MGMT_FLAGS.map(([k, lbl]) => (
                  <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form[k]}
                      onChange={(e) => set(k, e.target.checked)}
                      data-testid={`flag-${k}`}
                    />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)] flex items-center gap-1"><Warning size={12} weight="bold" /> {err}</div>}

          <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={prev}
              disabled={activeStage === 0}
              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40"
              data-testid="pipeline-prev-btn"
            >
              <CaretLeft size={12} /> Previous Stage
            </button>

            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              {activeStage < STAGE_DEFS.length - 1 && (
                <button
                  type="button"
                  onClick={next}
                  className="btn-secondary text-xs flex items-center gap-1"
                  data-testid="pipeline-next-btn"
                >
                  Next Stage <CaretRight size={12} />
                </button>
              )}
              <AirplaneButton
                type="button"
                onClick={onSubmit}
                disabled={busy}
                testid="pipeline-submit"
              >
                {busy ? "Saving…" : (opportunity ? "Update" : "Save Opportunity")}
              </AirplaneButton>
            </div>
          </div>
        </div>
      </div>

      {validationPopup && (
        <ValidationPopup
          {...validationPopup}
          onProceed={() => { setActiveStage(validationPopup.nextIdx); setValidationPopup(null); }}
          onClose={() => setValidationPopup(null)}
        />
      )}
    </div>
  );
}

function ValidationPopup({ stageIdx, nextIdx, missing, onProceed, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4" data-testid="stage-validation-popup">
      <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-md">
        <div className="p-5 border-b border-[var(--border)]">
          <div className="text-[10px] tracking-overline text-[var(--muted)]">STAGE MOVEMENT CHECKLIST</div>
          <h3 className="font-display text-lg font-bold">Moving to {STAGE_DEFS[nextIdx].label}</h3>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-[var(--muted)]">
            The following fields on <span className="font-semibold text-[var(--text)]">{STAGE_DEFS[stageIdx].label}</span> are still empty.
            You can proceed anyway — validation is informational.
          </p>
          <ul className="space-y-1.5 max-h-56 overflow-auto">
            {missing.map((m) => (
              <li key={m} className="flex items-center gap-2 text-[var(--text)]">
                <span className="inline-block w-3 h-3 border border-[var(--gold)] rounded-sm" /> {m}
              </li>
            ))}
          </ul>
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} data-testid="validation-cancel">Stay & Fill</button>
          <button className="btn-primary" onClick={onProceed} data-testid="validation-proceed">Proceed Anyway</button>
        </div>
      </div>
    </div>
  );
}

function FieldRenderer({ fieldDef, form, set, customers }) {
  const [name, label, type, opts = {}] = fieldDef;
  const value = form[name] ?? (type === "number" ? 0 : type === "boolean" ? false : "");
  const lab = (
    <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">
      {label} {opts.required && <span className="text-[var(--gold)]">*</span>}
    </label>
  );
  const wrapCls = opts.full ? "col-span-2" : "";
  const tid = `pipe-field-${name}`;

  if (type === "textarea") {
    return (
      <div className={wrapCls}>{lab}
        <textarea className="input" rows={2} value={value} onChange={(e) => set(name, e.target.value)} data-testid={tid} disabled={opts.readonly} />
      </div>
    );
  }
  if (type === "boolean") {
    return (
      <div className={wrapCls}>
        <label className="flex items-center gap-2 mt-5 text-sm cursor-pointer">
          <input type="checkbox" checked={!!value} onChange={(e) => set(name, e.target.checked)} data-testid={tid} />
          <span>{label} {opts.required && <span className="text-[var(--gold)]">*</span>}</span>
        </label>
      </div>
    );
  }
  if (type === "currency") {
    return (
      <div className={wrapCls}>{lab}
        <select className="input" value={value || "USD"} onChange={(e) => set(name, e.target.value)} data-testid={tid}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    );
  }
  if (type === "select") {
    return (
      <div className={wrapCls}>{lab}
        <select className="input" value={value || ""} onChange={(e) => set(name, e.target.value)} data-testid={tid}>
          <option value="">— Select —</option>
          {(opts.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (type === "customer") {
    return (
      <div className={wrapCls}>{lab}
        <select
          className="input"
          value={form.customer_id || ""}
          onChange={(e) => {
            const id = e.target.value;
            const c = (customers || []).find((x) => x.id === id);
            set("customer_id", id);
            set("customer_name", c?.customer_name || "");
          }}
          data-testid={tid}
        >
          <option value="">— Select Customer —</option>
          {(customers || []).map((c) => <option key={c.id} value={c.id}>{c.customer_name}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className={wrapCls}>{lab}
      <input
        type={type === "number" ? "number" : type === "date" ? "date" : type === "email" ? "email" : "text"}
        className={type === "number" ? "input font-mono" : "input"}
        value={value}
        onChange={(e) => set(name, e.target.value)}
        readOnly={!!opts.readonly}
        data-testid={tid}
      />
    </div>
  );
}

export const PIPELINE_STAGES = STAGE_DEFS.map((s) => ({ key: s.key, label: s.label }));
