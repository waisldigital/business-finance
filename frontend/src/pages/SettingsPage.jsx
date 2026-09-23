import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { Check, Sliders, IdentificationBadge, Database, Wallet, Palette } from "@phosphor-icons/react";
import RolesPage from "@/pages/RolesPage";
import ApprovalMatrixPage from "@/pages/ApprovalMatrixPage";

const TABS = [
  { key: "roles",        label: "Roles",          icon: IdentificationBadge },
  { key: "approval",     label: "Approval Matrix",icon: Database },
  { key: "currency",     label: "Currency",       icon: Wallet },
  { key: "appearance",   label: "Appearance",     icon: Palette },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "roles";

  const setTab = (k) => setParams({ tab: k });

  return (
    <div data-testid="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Roles · Approval Matrix · Currency · Appearance"
        breadcrumb="HOME · ADMINISTRATION · SETTINGS"
      />
      <div className="px-8 py-6 space-y-5">
        {/* Tab bar */}
        <div className="tile p-1 flex flex-wrap gap-1" data-testid="settings-tabs">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2 text-xs tracking-overline transition-all
                  ${active
                    ? "bg-[var(--gold)] text-[var(--bg)] font-semibold"
                    : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"}`}
                data-testid={`settings-tab-${t.key}`}
              >
                <t.icon size={14} weight={active ? "fill" : "duotone"} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        <div className="tile p-5" data-testid={`settings-panel-${tab}`}>
          {tab === "roles" && <RolesPage embedded />}
          {tab === "approval" && <ApprovalMatrixPage embedded />}
          {tab === "currency" && <CurrencyPanel />}
          {tab === "appearance" && <AppearancePanel />}
        </div>
      </div>
    </div>
  );
}

function CurrencyPanel() {
  const { setInrPerUsd } = useCurrency();
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/settings").then((r) => setSettings(r.data)).catch(() => {});
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(""); setErr("");
    try {
      const { data } = await api.put("/settings", {
        inr_per_usd: Number(settings.inr_per_usd),
        default_currency: settings.default_currency,
      });
      setSettings(data);
      setInrPerUsd(Number(data.inr_per_usd));
      setMsg("Saved");
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  if (!settings) return <div data-testid="settings-loading" className="text-[var(--muted)] text-sm">Loading…</div>;

  return (
    <form onSubmit={save} className="max-w-md" data-testid="fx-form">
      <h3 className="font-display text-lg font-bold mb-1 flex items-center gap-2"><Sliders size={18} weight="duotone" className="text-[var(--gold)]" /> FX & Default</h3>
      <div className="text-xs text-[var(--muted)] mb-4">Used everywhere $ Million is displayed.</div>

      <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">INR per 1 USD</label>
      <input
        type="number" step="0.01" min="1"
        className="input font-mono"
        value={settings.inr_per_usd}
        onChange={(e) => setSettings({ ...settings, inr_per_usd: e.target.value })}
        data-testid="fx-input"
      />

      <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5 mt-4">Default Currency</label>
      <select
        className="input"
        value={settings.default_currency}
        onChange={(e) => setSettings({ ...settings, default_currency: e.target.value })}
        data-testid="default-currency-select"
      >
        <option value="INR">₹ Indian Rupee (default)</option>
        <option value="USD">$ US Dollar</option>
      </select>

      {msg && <div className="text-xs text-[var(--success)] mt-3">{msg}</div>}
      {err && <div className="text-xs text-[var(--danger)] mt-3">{err}</div>}

      <button type="submit" className="btn-primary mt-5" disabled={busy} data-testid="save-settings-btn">
        {busy ? "Saving…" : "Save Settings"}
      </button>

      <div className="text-[11px] text-[var(--muted)] mt-3">Last updated by {settings.updated_by || "—"}</div>
    </form>
  );
}

function AppearancePanel() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <div data-testid="theme-picker-card">
      <h3 className="font-display text-lg font-bold mb-1">Visual Theme</h3>
      <p className="text-sm text-[var(--muted)] mb-5">Pick a luxury theme. Includes light, dark, and three premium luxury palettes.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {themes.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTheme(t.key)}
            className={`text-left border ${theme === t.key ? "border-[var(--gold)] ring-2 ring-[var(--gold)] ring-opacity-30" : "border-[var(--border)]"} p-4 transition-all hover:border-[var(--gold)]`}
            data-testid={`theme-${t.key}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-display font-bold">{t.label}</div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">{t.mode === "dark" ? "Dark Mode" : "Light Mode"}</div>
              </div>
              {theme === t.key && (
                <span className="badge badge-gold flex items-center gap-1">
                  <Check size={10} weight="bold" /> Active
                </span>
              )}
            </div>
            <div className="flex h-12 w-full">
              {t.swatch.map((c, i) => (
                <div key={i} style={{ background: c, flex: 1 }} />
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
