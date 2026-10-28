// useWishlistedIds — derives the set of ids (games.id and rawg_id, both as
// strings) already on the wishlist, so pages can show "✓ Wishlisted" without
// re-implementing the logic each time.
import { useMemo } from "react";

export function useWishlistedIds(wishlist) {
  return useMemo(() => {
    const s = new Set();
    wishlist.forEach((w) => {
      if (w.game?.id) s.add(String(w.game.id));
      if (w.game?.rawg_id) s.add(String(w.game.rawg_id));
    });
    return s;
  }, [wishlist]);
}
