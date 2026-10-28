// ============================================================
// src/hooks/useLibrary.js — library rows (games + ratings), ordered by
// playtime. Refetches when `version` (the global refresh token) changes.
// ============================================================
import { useEffect, useState } from "react";
import { fetchLibrary } from "../lib/api";

export function useLibrary(version) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Guard against a stale response overwriting a newer one when `version`
    // bumps mid-flight (e.g. a sync finishing while a fetch is in progress).
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchLibrary();
      if (!cancelled) {
        setRows(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [version]);

  return { rows, setRows, loading };
}
