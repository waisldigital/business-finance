// Browser storage keys are prefixed fs_ (WAISL FinSight). Earlier builds used cp_ (CRacker Pro): on first load
// each old value is copied to its new key and the old key removed, so sessions and preferences carry over.
const RENAMED = ["token", "refresh", "currency", "inr_scale", "theme", "sidebar_collapsed", "col_widths_v1"];

export function migrateStorageKeys() {
  try {
    for (const k of RENAMED) {
      const old = localStorage.getItem(`cp_${k}`);
      if (old === null) continue;
      if (localStorage.getItem(`fs_${k}`) === null) localStorage.setItem(`fs_${k}`, old);
      localStorage.removeItem(`cp_${k}`);
    }
  } catch { /* storage unavailable (private mode, blocked) — nothing to migrate */ }
}

migrateStorageKeys();
