import React, { useEffect, useState, useCallback } from "react";
import Popover from "@/components/common/Popover";
import { Bell, Check } from "@phosphor-icons/react";
import api from "@/lib/api";
import { useNavigate } from "react-router-dom";

const POLL_MS = 30000;

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const loadCount = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/in-app/count");
      setCount(data.unread || 0);
    } catch {}
  }, []);

  const loadList = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/in-app", { params: { limit: 20 } });
      setItems(data || []);
    } catch {}
  }, []);

  // poll the unread count while the tab is visible; catch up at once when it becomes visible again
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== "hidden") loadCount(); };
    tick();
    const t = setInterval(tick, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") loadCount(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [loadCount]);

  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  const openLink = async (n) => {
    if (!n.read) {
      try {
        await api.post(`/notifications/in-app/${n.id}/read`);
        setCount((c) => Math.max(0, c - 1));
        setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      } catch {}
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const markAllRead = async () => {
    try {
      await api.post("/notifications/in-app/mark-all-read");
      setCount(0);
      setItems((arr) => arr.map((x) => ({ ...x, read: true })));
    } catch {}
  };

  return (
    <Popover open={open} onOpenChange={setOpen} panelClassName="mt-2 w-[380px] bg-[var(--surface)] border border-[var(--border)] z-[70] shadow-xl"
             panelTestid="notif-dropdown" button={(isOpen, toggle) => (
      <button
        className="btn-secondary text-xs flex items-center gap-1.5 relative"
        onClick={toggle}
        data-testid="notif-bell-btn"
        title="Notifications"
      >
        <Bell size={14} weight="duotone" />
        {count > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
            style={{ background: "var(--danger)", color: "#fff" }}
            data-testid="notif-count-badge"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
    )}>
      <div className="px-3 py-2 border-b border-[var(--border)] flex justify-between items-center">
        <div className="text-[10px] tracking-overline text-[var(--muted)]">Notifications</div>
        {count > 0 && (
          <button className="btn-ghost text-[11px] flex items-center gap-1" onClick={markAllRead} data-testid="notif-mark-all-read">
            <Check size={12} /> Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {items.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[var(--muted)]">No notifications</div>
        )}
        {items.map((n) => (
          <button
            key={n.id}
            className={`w-full text-left px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--row-hover)] ${n.read ? "opacity-60" : ""}`}
            onClick={() => openLink(n)}
            data-testid={`notif-item-${n.id}`}
          >
            <div className="flex justify-between gap-2">
              <div className="text-sm font-medium truncate">{n.title}</div>
              {!n.read && <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: "var(--gold)" }} />}
            </div>
            {n.body && <div className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-2">{n.body}</div>}
            <div className="text-[10px] text-[var(--muted)] mt-1">{(n.created_at || "").replace("T", " ").slice(0, 16)}</div>
          </button>
        ))}
      </div>
    </Popover>
  );
}
