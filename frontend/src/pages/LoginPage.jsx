import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, homeFor, nextPath } from "@/lib/auth";
import BrandMark from "@/components/common/BrandMark";
import { ChartLineUp, Lock, EnvelopeSimple, Target, Receipt, ShieldCheck } from "@phosphor-icons/react";

export default function LoginPage() {
  const { login, error, user } = useAuth();
  const navigate = useNavigate();
  const search = React.useRef(window.location.search); // ?next= as it was when the page opened
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (user && user.id) navigate(nextPath(search.current, user) || homeFor(user), { replace: true });
  }, [user, navigate]);

  const doLogin = async () => {
    setBusy(true);
    const ok = await login(email, password);
    setBusy(false);
    if (ok) navigate(nextPath(search.current, ok) || homeFor(ok), { replace: true });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    doLogin();
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      {/* Left: hero — airport / aviation imagery */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#0A1628]">
        <img
          src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1400&q=70"
          alt="Aircraft flying over the runway at sunset"
          className="absolute inset-0 w-full h-full object-cover opacity-55"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A1628]/80 via-[#0A1628]/40 to-[#0A1628]/85" />
        {/* India tricolor stripe on the very top of hero */}
        <div className="absolute top-0 left-0 right-0 h-[3px] flex z-20">
          <div className="flex-1 bg-[#FF9933]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#138808]" />
        </div>
        <div className="cloud-trail" />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          <div className="flex items-center gap-3">
            <BrandMark size={40} className="rounded-sm !bg-[#FFC000]" />
            <div>
              <div className="font-display text-xl font-bold tracking-tight">WAISL FinSight</div>
              <div className="text-[10px] tracking-overline text-[#FFD24A]">Business Finance &amp; FP&amp;A</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-overline text-[#FFD24A] mb-3">Business finance · simplified</div>
            <h2 className="font-display text-4xl xl:text-5xl font-bold leading-tight tracking-tight">
              One source of truth.
              <br />
              <span className="text-[#FFD24A]">Every number, explained.</span>
            </h2>
            <p className="mt-6 text-white/70 max-w-md text-sm leading-relaxed">
              AOP planning, monthly MIS and P&amp;L, opex, capex and resource cost on a single actual source —
              with drill-downs to every booking, controlled approvals and a full audit trail for WAISL's
              finance and business teams.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3 max-w-lg">
              {[[Target, "Plan", "AOP, forecast & next-year budget"], [ChartLineUp, "Report", "MIS P&L, segments & airports"],
                [Receipt, "Control", "Opex, POs, capex & overheads"]].map(([Icon, t, d]) => (
                <div key={t} className="border border-white/15 bg-white/5 px-3 py-2.5">
                  <Icon size={16} className="text-[#FFD24A]" />
                  <div className="mt-1.5 text-xs font-semibold">{t}</div>
                  <div className="text-[10.5px] text-white/60 leading-snug">{d}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[10px] tracking-overline text-white/40 flex items-center gap-2">
            <ShieldCheck size={12} />
            <span>© WAISL · FinSight — Business Finance &amp; FP&amp;A · Authorised access only</span>
          </div>
        </div>
      </div>

      {/* Right: form — with subtle aviation watermark */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-[#FAFAF8] aviation-watermark relative">
        <form onSubmit={onSubmit} className="w-full max-w-sm relative z-10" data-testid="login-form">
          <div className="text-[10px] tracking-overline text-[#5E5E5A] mb-3 flex items-center gap-2">
            <span className="inline-block w-3 h-[2px] bg-[#FF9933]" />
            <span className="inline-block w-3 h-[2px] bg-white border border-[#D8D6CC]" />
            <span className="inline-block w-3 h-[2px] bg-[#138808]" />
            Sign in to FinSight
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#111110] mb-1">Welcome back</h1>
          <p className="text-sm text-[#5E5E5A] mb-8">Use your WAISL email and the password issued by your administrator.</p>

          <label className="block text-[11px] tracking-overline text-[#5E5E5A] mb-1.5">Email</label>
          <div className="relative mb-4">
            <EnvelopeSimple size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5E5E5A] pointer-events-none z-10" />
            <input
              type="email"
              required
              className="input"
              style={{ paddingLeft: 38 }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              autoComplete="email"
            />
          </div>

          <label className="block text-[11px] tracking-overline text-[#5E5E5A] mb-1.5">Password</label>
          <div className="relative mb-2">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5E5E5A] pointer-events-none z-10" />
            <input
              type="password"
              required
              className="input"
              style={{ paddingLeft: 38 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-xs text-[#991B1B] bg-[#fdeaea] border border-[#f1c2c2] p-2 mt-3" data-testid="login-error">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full mt-6 justify-center" disabled={busy} data-testid="login-submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="mt-6 text-[11px] text-[#5E5E5A] border-t border-[#E5E5E0] pt-4">
            Forgot your password? Ask your FinSight administrator to reset it.
          </div>
        </form>
      </div>
    </div>
  );
}
