import React, { useRef, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { download } from "@/aop/format";
import { X, DownloadSimple, Warning } from "@phosphor-icons/react";
import Modal from "@/components/common/Modal";

/**
 * Excel / CSV bulk upload with Append or Replace-all mode, a template download and the saved / failed summary.
 *   endpoint      POST target (mode is added as ?mode=append|replace)
 *   templateUrl   API path of the template (downloaded with the user's session)
 *   testidPrefix  prefix for the dialog's test ids ("wbs-" → wbs-mode-append …; "" → mode-append …)
 */
export default function BulkUploadModal({ title, endpoint, templateUrl, templateLabel = "Download template", templateFile = "template.xlsx",
                                          appendHelp, replaceHelp, columnsHelp, replaceWarning, testidPrefix = "", testid,
                                          onClose, onUploaded }) {
  const [mode, setMode] = useState("append");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const ref = useRef();
  const t = (id) => `${testidPrefix}${id}`;

  const getTemplate = async () => {
    try {
      const r = await api.get(templateUrl, { responseType: "blob" });
      download(r.data, templateFile);
    } catch (e) { setErr(e.response?.status === 403 ? "Your role can't download this template" : e.message); }
  };

  const submit = async () => {
    if (!file) { setErr("Choose a file first"); return; }
    setBusy(true); setErr(""); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`${endpoint}?mode=${mode}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data);
      onUploaded?.();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} testid={testid} className="bg-[var(--surface)] w-full max-w-lg border border-[var(--border)]">
      <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
        <div>
          <div className="text-[10px] tracking-overline text-[var(--muted)]">{title}</div>
          <h2 className="font-display text-xl font-bold">Excel / CSV Upload</h2>
        </div>
        <button className="btn-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex justify-between items-center">
          <button type="button" className="btn-ghost text-xs flex items-center gap-1" onClick={getTemplate} data-testid={t("upload-template-link")}>
            <DownloadSimple size={12} weight="bold" /> {templateLabel}
          </button>
        </div>
        <div>
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Mode</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`p-3 border text-left ${mode === "append" ? "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_8%,transparent)]" : "border-[var(--border)]"}`}
              onClick={() => setMode("append")} data-testid={t("mode-append")}
            >
              <div className="font-display font-bold text-sm">Add (Append)</div>
              <div className="text-[11px] text-[var(--muted)] mt-1">{appendHelp}</div>
            </button>
            <button
              className={`p-3 border text-left ${mode === "replace" ? "border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]" : "border-[var(--border)]"}`}
              onClick={() => setMode("replace")} data-testid={t("mode-replace")}
            >
              <div className="font-display font-bold text-sm flex items-center gap-1">Replace All <Warning size={12} /></div>
              <div className="text-[11px] text-[var(--muted)] mt-1">{replaceHelp}</div>
            </button>
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">File (.xlsx, .csv)</div>
          <input type="file" ref={ref} className="hidden" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0])} data-testid={t("upload-file-input")} />
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" onClick={() => ref.current?.click()} data-testid={t("upload-file-pick")}>Choose file</button>
            <span className="text-xs text-[var(--muted)] truncate flex-1">{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "No file selected"}</span>
          </div>
          {columnsHelp && <div className="text-[10px] text-[var(--muted)] mt-2 leading-relaxed">{columnsHelp}</div>}
        </div>
        {mode === "replace" && replaceWarning && (
          <div className="text-[11px] text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-2 border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] flex items-start gap-1">
            <Warning size={12} weight="bold" className="mt-0.5" />{replaceWarning}
          </div>
        )}
        {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)]">{err}</div>}
        {result && (
          <div className="text-xs bg-[var(--surface-2)] p-3 border border-[var(--border)]" data-testid={t("upload-result")}>
            <div>Mode: <span className="font-mono">{result.mode}</span></div>
            <div>Total rows: <span className="font-mono">{result.total_rows}</span></div>
            <div>Saved: <span className="font-mono text-[var(--success)]">{result.saved}</span></div>
            <div>Failed: <span className="font-mono text-[var(--danger)]">{result.failed}</span></div>
            {result.failures?.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[var(--muted)]">Failures</summary>
                <pre className="font-mono text-[10px] whitespace-pre-wrap mt-1">{JSON.stringify(result.failures, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </div>
      <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !file} data-testid={t("upload-submit-btn")}>
          {busy ? "Uploading…" : mode === "replace" ? "Replace All" : "Upload & Append"}
        </button>
      </div>
    </Modal>
  );
}
