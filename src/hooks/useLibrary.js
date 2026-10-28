// useLibrary — all library_entries joined to their game + rating, ordered
// by playtime. `version` bumps refetch everything (post-sync); `refetch()`
// lets a page refresh in place after a local mutation (rating saved, cover
// refreshed) without duplicating the query inline.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const LIBRARY_SELECT =
  "playtime_forever,last_played,game:games(id,title,cover_url,rawg_rating,genres,released,steam_appid,deal_price,deal_regular,deal_cut,deal_shop,deal_url,rating:ratings(score,status,favorite_rank))";

async function fetchLibrary() {
  const { data } = await supabase
    .from("library_entries")
    .select(LIBRARY_SELECT)
    .order("playtime_forever", { ascending: false });
  const norm = (data || []).map((r) => ({
    ...r,
    // PostgREST returns nested relations as arrays — unwrap to single object
    rating: Array.isArray(r.game?.rating) ? (r.game.rating[0] || null) : (r.game?.rating ?? null),
    game: r.game ? { ...r.game, rating: undefined } : r.game,
  }));
  return norm;
}

export function useLibrary(version) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false; // guard: ignore results from a superseded run
    (async () => {
      setLoading(true);
      const norm = await fetchLibrary();
      if (!stale) {
        setRows(norm);
        setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [version]);

  // In-place refresh used after local mutations (rating saved, etc.)
  const refetch = useCallback(async () => {
    setRows(await fetchLibrary());
  }, []);

  return { rows, setRows, loading, refetch };
}
