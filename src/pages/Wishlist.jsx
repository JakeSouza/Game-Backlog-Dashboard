// Wishlist — games with status='wishlist': Steam wishlist sync + manual
// adds, with price/discount badges and per-card cover refresh.
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useWishlist } from "../hooks/useWishlist";
import Layout from "../components/Layout";
import GameImg from "../components/GameImg";
import RefreshCoverBtn from "../components/RefreshCoverBtn";
import StatusBadge from "../components/StatusBadge";
import DealBadge from "../components/DealBadge";
import GameSearch from "../components/GameSearch";

export default function Wishlist({ version, onSyncDone }) {
  const [wlVersion, setWlVersion] = useState(0);
  const rows = useWishlist(`${version}:${wlVersion}`);
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [sortBy, setSortBy] = useState("discount");
  const [removed, setRemoved] = useState({});
  const [imgRefresh, setImgRefresh] = useState({}); // { gameId: cacheBustKey }

  const filtered = useMemo(() => {
    let r = rows.filter((x) => x.game && !removed[x.game.id]);
    if (q) r = r.filter((x) => x.game.title.toLowerCase().includes(q.toLowerCase()));
    const sorted = [...r];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.game.title.localeCompare(b.game.title));
    } else if (sortBy === "price") {
      // nulls (no price data yet) sort to the end regardless of direction
      sorted.sort((a, b) => {
        const pa = a.game.deal_price, pb = b.game.deal_price;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pa - pb;
      });
    } else if (sortBy === "discount") {
      sorted.sort((a, b) => (b.game.deal_cut ?? -1) - (a.game.deal_cut ?? -1));
    }
    return sorted;
  }, [rows, q, sortBy, removed]);

  // Optimistically drop the card immediately, then delete. Previously this
  // only hit the database and never touched local state, so the removed game
  // stayed visible until a navigation or refetch.
  async function removeWishlist(gameId) {
    setRemoved((p) => ({ ...p, [gameId]: true }));
    const { error } = await supabase.from("ratings").delete().eq("game_id", gameId).eq("user_id", "me");
    if (error) {
      setRemoved((p) => { const n = { ...p }; delete n[gameId]; return n; });
      console.error("removeWishlist failed, restored:", error.message);
    }
  }

  // Manual cover refresh: cache-bust the card's GameImg, then refetch the
  // wishlist rows so the PATCHed cover_url / steam_appid from the edge
  // function shows up.
  const onCoverRefreshed = useCallback((gameId) => {
    setImgRefresh((p) => ({ ...p, [gameId]: Date.now() }));
    setWlVersion((v) => v + 1);
  }, []);

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl font-display font-black mb-1" style={{color:'var(--text)'}}>WISHLIST</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>
          {filtered.length} games · synced from Steam + manually added
        </p>
        <div className="scan-bar mb-5" />

        <GameSearch mode="wishlist" onAdded={() => setWlVersion((v) => v + 1)} />

        <div className="flex gap-2 mb-5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="cyber-input flex-1" />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="cyber-input">
            <option value="name">Sort: Name</option>
            <option value="price">Sort: Price</option>
            <option value="discount">Sort: Discount %</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <p className="font-mono-tech text-sm" style={{color:'var(--text-muted)'}}>
            {rows.length === 0 ? "No wishlisted games — run sync or add from Upcoming/Discover" : "No matches"}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map((r, i) => (
              <div key={r.game.id} className="game-card rounded-lg overflow-hidden stagger-in"
                   style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}>
                <div className="card-img-wrap">
                  <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} refreshKey={imgRefresh[r.game.id] || 0} className="w-full h-28 sm:h-36 object-cover" />
                  <div className="absolute top-1.5 left-1.5 z-10">
                    <RefreshCoverBtn gameId={r.game.id} onDone={(d) => onCoverRefreshed(r.game.id, d)} />
                  </div>
                  <div className="absolute top-1.5 right-1.5 z-10">
                    <StatusBadge status="wishlist" />
                  </div>
                </div>
                <div className="p-2 sm:p-3">
                  <div className="text-xs sm:text-sm font-display font-bold truncate" style={{color:'var(--text)'}}>
                    {r.game.title}
                  </div>
                  {r.game.released && (
                    <div className="text-[10px] font-mono-tech mt-0.5" style={{color:'var(--text-muted)'}}>
                      {new Date(r.game.released).toLocaleDateString()}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(r.game.genres || []).slice(0, 2).map((g) => (
                      <span key={g} className="genre-tag">{g}</span>
                    ))}
                  </div>
                  <div className="mt-1.5"><DealBadge game={r.game} /></div>
                  <button
                    onClick={() => removeWishlist(r.game.id)}
                    className="wishlist-add-btn mt-1.5"
                    style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.15)' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
