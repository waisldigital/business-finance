import React, { useEffect, useRef, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { UploadSimple, Trash, DownloadSimple, CheckCircle, Circle } from "@phosphor-icons/react";
import { formatDateTime } from "@/aop/format";

/**
 * The project's document checklist — agreement, customer PO, LOI, deal P&L, vendor POs … Each slot is empty until the
 * document is available; upload it then (several files per slot are fine).
 */
export default function ProjectDocumentSlots({ projectId, docs, onChanged, onDownload, onRemove }) {
  const [types, setTypes] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const input = useRef(null);
  const [slot, setSlot] = useState(null);
  useEffect(() => { api.get("/projects/document-types").then((r) => setTypes(r.data)).catch(() => {}); }, []);

  const pick = (t) => { setSlot(t); setErr(""); input.current?.click(); };
  const upload = async (file) => {
    if (!file || !slot) return;
    setBusy(slot.key); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const params = new URLSearchParams({ name: slot.label, doc_type: slot.key, parse: slot.key === "customer_po" ? "true" : "false" });
      await api.post(`/projects/${projectId}/documents?${params}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChanged();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(""); if (input.current) input.current.value = ""; }
  };

  const have = (k) => docs.filter((d) => (d.doc_type || "other") === k);
  const done = types.filter((t) => t.key !== "other" && have(t.key).length).length;
  return (
    <div className="tile mb-5" data-testid="doc-slots">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3">
        <div className="text-[10px] tracking-overline text-[var(--muted)] flex-1">DOCUMENT CHECKLIST</div>
        <div className="text-xs text-[var(--muted)]">{done} of {Math.max(types.length - 1, 0)} on file · upload each as it becomes available</div>
      </div>
      <input ref={input} type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="doc-slot-input" />
      {err && <div className="text-xs text-[var(--danger)] px-4 py-2">{err}</div>}
      <div className="divide-y divide-[var(--border)]">
        {types.map((t) => {
          const files = have(t.key);
          return (
            <div key={t.key} className="px-4 py-2 flex items-start gap-3" data-testid={`doc-slot-${t.key}`}>
              {files.length ? <CheckCircle size={16} weight="fill" className="text-[var(--success)] mt-0.5" /> : <Circle size={16} className="text-[var(--muted)] mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t.label}</div>
                {files.length === 0 && <div className="text-[11px] text-[var(--muted)]">Not uploaded yet</div>}
                {files.map((d) => (
                  <div key={d.id} className="text-[11px] flex items-center gap-2" data-testid={`doc-slot-file-${d.id}`}>
                    <button className="underline decoration-dotted hover:text-[var(--gold)] truncate" onClick={() => onDownload(d)}>{d.file_name}</button>
                    <span className="text-[var(--muted)]">{formatDateTime(d.uploaded_at)} · {d.uploaded_by}</span>
                    <button className="btn-ghost !p-0.5" onClick={() => onDownload(d)} title="Download"><DownloadSimple size={12} /></button>
                    <button className="btn-ghost !p-0.5" onClick={() => onRemove(d)} title="Delete"><Trash size={12} /></button>
                  </div>
                ))}
              </div>
              <button className="btn-secondary text-xs flex items-center gap-1 whitespace-nowrap" onClick={() => pick(t)} disabled={busy === t.key} data-testid={`doc-slot-upload-${t.key}`}>
                <UploadSimple size={12} />{busy === t.key ? "Uploading…" : files.length ? "Add another" : "Upload"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
