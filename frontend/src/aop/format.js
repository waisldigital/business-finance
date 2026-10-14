// Number formatting for AOP screens (Indian digit grouping, Crore / Lakh units).
// House style: amounts without decimals, percentages with one decimal.
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const UNITS = {
  cr: { label: "₹ Cr", div: 1e7, digits: 0 },
  lakh: { label: "₹ Lakh", div: 1e5, digits: 0 },
  usd: { label: "$ Mn", div: 1e6 * 83, digits: 0 }, // 83 is only the fallback until Settings' rate loads
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
  if (Math.abs(n) < 0.5) return n === 0 ? "–" : "0";
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: u.digits, maximumFractionDigits: u.digits }).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

/**
 * A money amount in the unit picked in the header (₹ Crore · ₹ Lakh · $ Million): ₹ Crore and $ Mn with two
 * decimals, ₹ Lakh whole; negatives in brackets; $ uses the admin-set INR per USD rate (Settings).
 */
const MONEY = { cr: { sym: "₹", suffix: " Cr", digits: 2 }, lakh: { sym: "₹", suffix: " L", digits: 0 }, usd: { sym: "$", suffix: " Mn", digits: 2 } };
export function formatMoney(value, unit = "cr") {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) return "—";
  const m = MONEY[unit] || MONEY.cr;
  const n = Number(value) / unitDiv(unit in MONEY ? unit : "cr");
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits }).format(Math.abs(n));
  const out = `${m.sym}${s}${m.suffix}`;
  return n < 0 && Number(s.replace(/,/g, "")) !== 0 ? `(${out})` : out;
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

export function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

export function fmtCell(v, type) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "percent") return fmtPct(v);
  if (type === "number" || type === "money") {
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    // fractions below 1 (factors, allocation shares) keep their decimals; everything else is whole numbers
    return Math.abs(n) < 1 && n !== 0 ? inr.format(n) : inr0.format(n);
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
