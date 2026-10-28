// useWishlist — games with status='wishlist' (from Steam sync or manual add).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useWishlist(version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let stale = false; // guard: ignore results from a superseded run
    (async () => {
      const { data } = await supabase
        .from("ratings")
        .select("score,status,game:games(id,rawg_id,title,cover_url,rawg_rating,genres,released,steam_appid,deal_price,deal_regular,deal_cut,deal_shop,deal_url)")
        .eq("status", "wishlist")
        .eq("user_id", "me")
        .order("updated_at", { ascending: false });
      if (!stale) setRows((data || []).map((r) => ({ ...r, game: Array.isArray(r.game) ? r.game[0] : r.game })));
    })();
    return () => { stale = true; };
  }, [version]);
  return rows;
}
