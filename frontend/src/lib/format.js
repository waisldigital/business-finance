// Currency formatting utilities for ₹ Crore (Indian) and $ Million (US)
export function formatCurrency(amount, mode = "INR", inrPerUsd = 83) {
  const n = Number(amount || 0);
  if (mode === "INR") {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
    if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
    return `₹${n.toFixed(0)}`;
  }
  // USD using admin-set INR→USD conversion rate
  const rate = inrPerUsd && inrPerUsd > 0 ? inrPerUsd : 83;
  const usd = n / rate;
  if (Math.abs(usd) >= 1e9) return `$${(usd / 1e9).toFixed(2)} B`;
  if (Math.abs(usd) >= 1e6) return `$${(usd / 1e6).toFixed(2)} M`;
  if (Math.abs(usd) >= 1e3) return `$${(usd / 1e3).toFixed(1)} K`;
  return `$${usd.toFixed(0)}`;
}

export function formatNumber(n) {
  return new Intl.NumberFormat("en-IN").format(Math.round(Number(n || 0)));
}

export function formatDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return d;
  }
}

export function formatDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d;
  }
}
