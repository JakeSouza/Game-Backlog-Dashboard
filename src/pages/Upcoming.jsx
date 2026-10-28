// Upcoming — releases queued for the next year, with one-click wishlist add.
import { useState } from "react";
import { addToWishlist } from "../lib/games";
import { useUpcoming } from "../hooks/useUpcoming";
import { useWishlist } from "../hooks/useWishlist";
import { useWishlistedIds } from "../hooks/useWishlistedIds";
import Layout from "../components/Layout";
import GameImg from "../components/GameImg";

export default function Upcoming({ version, onSyncDone }) {
  const rows = useUpcoming(version);
  const [added, setAdded] = useState({});
  const [wlVersion, setWlVersion] = useState(0);
  const wishlist = useWishlist(wlVersion);
  const wishlistedIds = useWishlistedIds(wishlist);

  async function handleAdd(r, e) {
    e?.stopPropagation();
    const key = String(r.rawg_id || r.title);
    setAdded((p) => ({ ...p, [key]: true }));
    await addToWishlist(r, true);
    setWlVersion((v) => v + 1);
  }

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl font-display font-black mb-1" style={{color:'var(--text)'}}>UPCOMING</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>{rows.length} releases queued · click + to add to wishlist</p>
        <div className="scan-bar mb-5" />

        {rows.length === 0 ? (
          <p className="font-mono-tech text-sm" style={{color:'var(--text-muted)'}}>No data — run sync</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {rows.map((r) => {
              const key = String(r.rawg_id || r.title);
              const isWishlisted = added[key] || wishlistedIds.has(String(r.rawg_id));
              return (
                <div key={r.id} className="game-card rounded-lg overflow-hidden">
                  <div className="card-img-wrap">
                    <GameImg key={r.rawg_id || r.id} src={r.cover_url} className="w-full h-28 sm:h-36 object-cover" />
                  </div>
                  <div className="p-2 sm:p-3">
                    <div className="text-xs sm:text-sm font-display font-bold truncate" style={{color:'var(--text)'}}>{r.title}</div>
                    <div className="text-[10px] sm:text-xs font-mono-tech mt-0.5" style={{color:'var(--accent)'}}>
                      {new Date(r.released).toLocaleDateString()}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(r.genres || []).slice(0, 2).map((g) => (
                        <span key={g} className="genre-tag">{g}</span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!isWishlisted) handleAdd(r, e); }}
                        className={`wishlist-add-btn ${isWishlisted ? 'added' : ''}`}
                        style={{ marginLeft: 'auto' }}
                      >
                        {isWishlisted ? '✓ Wishlisted' : '+ Wishlist'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
