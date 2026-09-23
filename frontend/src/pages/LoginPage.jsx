import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AirplaneTilt, Lock, EnvelopeSimple } from "@phosphor-icons/react";
import AirplaneButton from "@/components/AirplaneButton";

export default function LoginPage() {
  const { login, error, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@crackerpro.com");
  const [password, setPassword] = useState("Admin@123");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (user && user.id) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const doLogin = async () => {
    setBusy(true);
    const ok = await login(email, password);
    setBusy(false);
    if (ok) navigate("/dashboard", { replace: true });
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
            <div className="w-10 h-10 bg-[#FFC000] flex items-center justify-center rounded-sm">
              <AirplaneTilt weight="fill" size={22} className="text-[#0A1628]" />
            </div>
            <div>
              <div className="font-display text-xl font-bold tracking-tight">WAISL · COLM</div>
              <div className="text-[10px] tracking-overline text-[#FFD24A]">Customer Order Lifecycle · Aviation</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-overline text-[#FFD24A] mb-3">Project Commercial Lifecycle</div>
            <h2 className="font-display text-4xl xl:text-5xl font-bold leading-tight tracking-tight">
              From Pipeline to Closure.
              <br />
              <span className="text-[#FFD24A]">Engineered for airports.</span>
            </h2>
            <p className="mt-6 text-white/70 max-w-md text-sm leading-relaxed">
              Replace fragile Excels with audit-tracked workflows, configurable approvals, and a real-time
              dashboard built for CFOs, controllers, and airport finance teams.
            </p>
          </div>
          <div className="text-[10px] tracking-overline text-white/40 flex items-center gap-2">
            <span>© WAISL · Customer Order Lifecycle Management · Authorised access only</span>
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
            Sign in to your workspace
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#111110] mb-1">Welcome aboard</h1>
          <p className="text-sm text-[#5E5E5A] mb-8">Use your WAISL credentials. Passwords are admin-managed.</p>

          <label className="block text-[11px] tracking-overline text-[#5E5E5A] mb-1.5">Email</label>
          <div className="relative mb-4">
            <EnvelopeSimple size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5E5E5A]" />
            <input
              type="email"
              required
              className="input pl-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              autoComplete="email"
            />
          </div>

          <label className="block text-[11px] tracking-overline text-[#5E5E5A] mb-1.5">Password</label>
          <div className="relative mb-2">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5E5E5A]" />
            <input
              type="password"
              required
              className="input pl-9"
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

          <AirplaneButton
            type="submit"
            disabled={busy}
            testid="login-submit"
            className="w-full mt-6 justify-center"
          >
            {busy ? "Signing in…" : "Sign in & take off"}
          </AirplaneButton>

          <div className="mt-6 text-[11px] text-[#5E5E5A] border-t border-[#E5E5E0] pt-4">
            Forgot your password? Contact your WAISL administrator. <span className="text-[#A67C00]">No OTP-based reset.</span>
          </div>
        </form>
      </div>
    </div>
  );
}
