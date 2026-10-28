// useRpc — calls a Postgres RPC (recommend_play_next / recommend_discover)
// and returns its rows.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useRpc(name, limit, version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let stale = false; // guard: ignore results from a superseded run
    supabase.rpc(name, { p_limit: limit }).then(({ data }) => {
      if (!stale) setRows(data || []);
    });
    return () => { stale = true; };
  }, [name, limit, version]);
  return rows;
}
