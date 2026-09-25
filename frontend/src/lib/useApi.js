// GET data for a screen: the last response for the same URL + params shows at once (switching between reports
// is instant), a fresh copy is always fetched behind it, and identical requests in flight are shared.
import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";

const cache = new Map();    // key → data
const inflight = new Map(); // key → promise

function fetchShared(key, url, params) {
  if (!inflight.has(key)) {
    inflight.set(key, api.get(url, { params }).then((r) => { cache.set(key, r.data); return r.data; })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

/** [data, error, reload, loading] for GET url?params; url null/empty → nothing is fetched. */
export function useApi(url, params) {
  const key = url ? `${url}?${JSON.stringify(params || {})}` : null;
  const [state, setState] = useState(() => ({ data: key ? cache.get(key) ?? null : null, err: "", loading: !!key }));
  const current = useRef(key);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const load = useCallback(() => {
    current.current = key;
    if (!key) { setState({ data: null, err: "", loading: false }); return; }
    setState((s) => ({ data: cache.get(key) ?? (s.data && current.current === key ? s.data : null), err: "", loading: true }));
    fetchShared(key, url, paramsRef.current)
      .then((data) => { if (current.current === key) setState({ data, err: "", loading: false }); })
      .catch((e) => { if (current.current === key) setState((s) => ({ ...s, err: e.response?.data?.detail || e.message, loading: false })); });
  }, [key, url]);
  useEffect(load, [load]);
  return [state.data, state.err, load, state.loading];
}
