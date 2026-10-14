// State kept in this browser (localStorage) under a key; falls back to the initial value when storage is
// unavailable (private mode, blocked). The base of every per-viewer preference hook.
import { useCallback, useState } from "react";

function read(key, fallback, restore) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return restore ? restore(v) : v;
  } catch { return fallback; }
}

/**
 * [value, set, reset]. set takes a value or an updater function; reset forgets the stored value.
 * restore(stored) can merge a stored value with newer defaults.
 */
export function usePersistentState(key, initial, { restore } = {}) {
  const [value, setValue] = useState(() => read(key, initial, restore));
  const set = useCallback((next) => setValue((cur) => {
    const v = typeof next === "function" ? next(cur) : next;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
    return v;
  }), [key]);
  const reset = useCallback(() => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    setValue(initial);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set, reset];
}
