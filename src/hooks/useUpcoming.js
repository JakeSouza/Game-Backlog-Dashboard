// ============================================================
// src/hooks/useUpcoming.js — upcoming releases with a future date.
// ============================================================
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function useUpcoming(version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("upcoming_releases")
        .select("*")
        .gte("released", new Date().toISOString().slice(0, 10))
        .order("released", { ascending: true });
      if (!cancelled) setRows(data || []);
    })();
    return () => { cancelled = true; };
  }, [version]);
  return rows;
}
