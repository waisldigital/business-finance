import React, { useState } from "react";
import api from "@/lib/api";
import { X, UploadSimple, Plus, ArrowsCounterClockwise, PencilSimpleLine, Swap, FileCsv, DownloadSimple } from "@phosphor-icons/react";
import { download } from "./format";

const MODES = [
  { key: "upsert",  label: "Add + modify", icon: Swap,                   help: "New keys are added, existing keys are updated." },
  { key: "add",     label: "Add only",     icon: Plus,                   help: "Only rows whose key is new are added; existing keys are skipped." },
  { key: "modify",  label: "Modify only",  icon: PencilSimpleLine,       help: "Only existing keys are updated (only the columns in the file); unknown keys are skipped." },
  { key: "replace", label: "Replace all",  icon: ArrowsCounterClockwise, help: "Deletes every row of this dataset, then loads the file." },
];

export default function UploadDialog({ dataset, keyFields = [], onClose, onDone, admin = true }) {
  const [mode, setMode] = useState("upsert");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!file) return;
    if (mode === "replace" && !window.confirm("Replace ALL rows of this dataset with the file?")) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/aop/datasets/${dataset.key}/upload`, fd, { params: { mode } });
      setResult(data);
      onDone?.();
    } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };

  const template = async (fmt) => {
    const res = await api.get(`/aop/datasets/${dataset.key}/download`, { params: { fmt, template: true }, responseType: "blob" });
    download(res.data, `${dataset.key}_template.${fmt}`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-testid="aop-upload-dialog">
      <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-lg">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
          <div className="text-sm font-semibold flex items-center gap-2"><UploadSimple size={16} /> Upload · {dataset.label}</div>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3 text-xs">
          <div className="text-[var(--muted)]">
            Unique key: <span className="font-mono text-[var(--text)]">{keyFields.join(" + ") || "line_id"}</span>. Headers may be column keys or labels. CSV or XLSX (first sheet).
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MODES.filter((m) => admin || m.key !== "replace").map((m) => (
              <button key={m.key} onClick={() => setMode(m.key)} data-testid={`upload-mode-${m.key}`}
                      className={`flex items-start gap-2 p-2 border text-left ${mode === m.key ? "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_8%,transparent)]" : "border-[var(--border)]"}`}>
                <m.icon size={15} className={mode === m.key ? "text-[var(--gold)]" : "text-[var(--muted)]"} />
                <span><span className="font-semibold block">{m.label}</span><span className="text-[10.5px] text-[var(--muted)]">{m.help}</span></span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 border border-dashed border-[var(--border)] p-3 cursor-pointer hover:border-[var(--gold)]">
            <FileCsv size={20} className="text-[var(--muted)]" />
            <span className="flex-1 truncate">{file ? file.name : "Choose a .csv or .xlsx file"}</span>
            <input type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="upload-file" />
          </label>
          {err && <div className="text-[var(--danger)]">{String(err)}</div>}
          {result && (
            <div className="border border-[var(--border)] p-2 space-y-1" data-testid="upload-result">
              <div className="flex gap-3 font-semibold">
                <span className="text-[var(--success)]">+{result.added} added</span>
                <span>{result.updated} updated</span>
                <span className="text-[var(--muted)]">{result.skipped} skipped</span>
                {!!result.errors?.length && <span className="text-[var(--danger)]">{result.errors.length} errors</span>}
              </div>
              {!!result.new_columns?.length && <div className="text-[var(--muted)]">New columns added: {result.new_columns.join(", ")}</div>}
              {result.errors?.slice(0, 8).map((e, i) => <div key={i} className="text-[var(--danger)]">Row {e.row}: {e.reason}</div>)}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)]">
          <div className="flex gap-1">
            <button className="icon-btn" onClick={() => template("xlsx")} title="Blank template (xlsx)"><DownloadSimple size={14} /> xlsx</button>
            <button className="icon-btn" onClick={() => template("csv")} title="Blank template (csv)"><DownloadSimple size={14} /> csv</button>
          </div>
          <button className="icon-btn primary" disabled={!file || busy} onClick={run} data-testid="upload-run">
            <UploadSimple size={14} /> {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
