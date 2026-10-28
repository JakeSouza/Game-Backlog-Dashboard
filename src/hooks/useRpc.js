// ============================================================
// src/hooks/useRpc.js — call a Postgres RPC returning a list of rows.
// ============================================================
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function useRpc(name, limit, version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc(name, { p_limit: limit }).then(({ data, error }) => {
      if (error) console.error(`rpc ${name} failed:`, error.message);
      if (!cancelled) setRows(data || []);
    });
    return () => { cancelled = true; };
  }, [name, limit, version]);
  return rows;
}
