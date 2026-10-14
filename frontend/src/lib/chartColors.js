// Chart colours come from the theme's CSS variables (App.css: --mis-cacr, --mis-sol, --mis-tot). Recharts sets
// colours as SVG attributes, so the value is read once from the stylesheet rather than passed as var(--…).
const read = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};

export const CHART = {
  get aop() { return read("--mis-cacr", "#31869b"); },     // AOP / plan (teal)
  get actual() { return read("--mis-sol", "#963634"); },   // actual (maroon)
  get navy() { return read("--mis-tot", "#1e3a5f"); },
};
