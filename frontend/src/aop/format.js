// Number formatting for AOP screens (Indian digit grouping, Crore / Lakh units).
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const UNITS = {
  cr: { label: "₹ Cr", div: 1e7, digits: 2 },
  lakh: { label: "₹ Lakh", div: 1e5, digits: 2 },
  usd: { label: "$ Mn", div: 1e6 * 83, digits: 2 },
  inr: { label: "₹", div: 1, digits: 0 },
};

// $ Million uses the admin-set INR per USD rate (Settings); the currency provider keeps it in sync
export function setUsdRate(rate) {
  if (rate > 0) UNITS.usd.div = 1e6 * rate;
}
export const unitDiv = (unit) => (UNITS[unit] || UNITS.cr).div;
export const unitLabel = (unit) => (UNITS[unit] || UNITS.cr).label;

export function fmtAmount(v, unit = "cr") {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "";
  const u = UNITS[unit] || UNITS.cr;
  const n = Number(v) / u.div;
  if (Math.abs(n) < 0.005 && u.digits) return "–";
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: u.digits, maximumFractionDigits: u.digits }).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

export function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

export function fmtCell(v, type) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "percent") return fmtPct(v, 2);
  if (type === "number" || type === "money") {
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return Math.abs(n) >= 1000 ? inr0.format(n) : inr.format(n);
  }
  if (type === "date" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00/.test(v))) return String(v).slice(0, 10);
  return String(v);
}

// Tab-separated text (what Excel puts on the clipboard) → 2-D array, honouring quoted cells.
export function parseTSV(text) {
  if (!text) return [];
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function toTSV(matrix) {
  return matrix.map((r) => r.map((c) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join("\t")).join("\n");
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
