// useUpcoming — upcoming releases from today forward.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useUpcoming(version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let stale = false; // guard: ignore results from a superseded run
    (async () => {
      const { data } = await supabase
        .from("upcoming_releases")
        .select("*")
        .gte("released", new Date().toISOString().slice(0, 10))
        .order("released", { ascending: true });
      if (!stale) setRows(data || []);
    })();
    return () => { stale = true; };
  }, [version]);
  return rows;
}
