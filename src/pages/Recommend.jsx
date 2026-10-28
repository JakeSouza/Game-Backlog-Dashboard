// Recommend — the two genre-affinity RPCs: "Play Next" (owned, barely
// played) and "Discover" (upcoming, not owned). Tap a card's match bar to
// expand which genres contributed to the score.
import { useState } from "react";
import { fmtHours } from "../lib/format";
import { addToWishlist } from "../lib/games";
import { useRpc } from "../hooks/useRpc";
import { useWishlist } from "../hooks/useWishlist";
import { useWishlistedIds } from "../hooks/useWishlistedIds";
import Layout from "../components/Layout";
import GameImg from "../components/GameImg";
import MatchBar from "../components/MatchBar";

export default function Recommend({ version, onSyncDone }) {
  const playNext = useRpc("recommend_play_next", 12, version);
  const discover = useRpc("recommend_discover", 12, version);
  const [tab, setTab] = useState("play");
  const [added, setAdded] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [wlVersion, setWlVersion] = useState(0);
  const wishlist = useWishlist(wlVersion);
  const wishlistedIds = useWishlistedIds(wishlist);
  const items = tab === "play" ? playNext : discover;

  async function handleAdd(r, e) {
    e?.stopPropagation();
    // Use a stable unique key: game_id for DB games, rawg_id for discovery games
    const key = String(r.game_id || r.rawg_id || r.title);
    setAdded((p) => ({ ...p, [key]: true }));
    // Pass game_id if available (DB game), otherwise let addToWishlist create by rawg_id
    const payload = r.game_id ? { ...r, id: r.game_id } : { ...r, id: null };
    await addToWishlist(payload);
    setWlVersion((v) => v + 1);
  }

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl font-display font-black mb-1" style={{color:'var(--text)'}}>RECOMMEND</h1>
        <div className="cyber-panel rounded-lg p-3 sm:p-4 mb-5">
          <p className="font-mono-tech text-[11px] sm:text-xs leading-relaxed" style={{color:'var(--text-muted)'}}>
            Score (0–10) = the average of your star-rating average in each genre this game shares with
            games you've rated, doubled to fit a 0–10 scale. Only genres you've actually rated something
            in count — unrated genres are ignored rather than dragging the score down.
            <br /><br />
            <span style={{color:'var(--warning)'}}>Note:</span> a genre backed by only one or two rated
            games can swing to an extreme average — tap a card's match bar to see exactly which genres
            contributed and how many rated games back each one.
          </p>
        </div>
        <div className="scan-bar mb-5" />

        <div className="flex gap-2 mb-5">
          {[["play", "Play Next"], ["discover", "Discover"]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded text-sm font-display font-bold uppercase tracking-wider transition ${
                tab === t ? "cyber-nav-active" : "border hover:opacity-70"}`}
              style={tab === t ? {} : {color:'var(--text-muted)'}}>
              {label}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <p className="font-mono-tech text-sm" style={{color:'var(--text-muted)'}}>
            {tab === "play" ? "Rate games to seed recommendations" : "No matches — rate more games"}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {items.map((r, i) => {
              const gid = String(r.game_id || r.rawg_id || r.title);
              const isWishlisted = tab === "discover" && (added[gid] || wishlistedIds.has(gid) || wishlistedIds.has(String(r.rawg_id)));
              const expanded = expandedId === gid;
              return (
                <div key={tab === "play" ? r.game_id : i} className="game-card rounded-lg overflow-hidden stagger-in"
                     style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}>
                  <div className="card-img-wrap">
                    <GameImg key={r.game_id || r.rawg_id || r.title} src={r.cover_url} steamAppid={r.steam_appid || null} className="w-full h-28 sm:h-36 object-cover" />
                  </div>
                  <div className="p-2 sm:p-3">
                    <div className="text-xs sm:text-sm font-display font-bold truncate" style={{color:'var(--text)'}}>{r.title}</div>
                    {tab === "play" ? (
                      <div className="text-[10px] sm:text-xs font-mono-tech mt-0.5" style={{color:'var(--text-muted)'}}>
                        {fmtHours(r.playtime_forever)} · {r.status}
                      </div>
                    ) : (
                      <div className="text-[10px] sm:text-xs font-mono-tech mt-0.5" style={{color:'var(--text-muted)'}}>
                        {r.released ? new Date(r.released).toLocaleDateString() : ''}
                      </div>
                    )}
                    <div onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : gid); }} style={{cursor:'pointer'}}>
                      <MatchBar score={r.score} label={tab === "play" ? "REPLAY VALUE" : "GENRE MATCH"} />
                    </div>
                    {expanded && (
                      <div className="mt-2 pt-2" style={{borderTop:'1px solid var(--border)'}} onClick={(e) => e.stopPropagation()}>
                        {(!r.matched_genres || r.matched_genres.length === 0) ? (
                          <p className="text-[10px] font-mono-tech" style={{color:'var(--text-muted)'}}>No genre overlap with your rated games.</p>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {r.matched_genres.map((mg) => (
                              <div key={mg.genre} className="flex items-center justify-between text-[10px] font-mono-tech">
                                <span style={{color:'var(--text)'}}>{mg.genre}</span>
                                <span style={{color: mg.n <= 2 ? 'var(--warning)' : 'var(--text-muted)'}}>
                                  {mg.weight}★ avg ({mg.n} rated)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {tab === "discover" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!isWishlisted) handleAdd(r, e); }}
                        className={`wishlist-add-btn mt-1.5 ${isWishlisted ? 'added' : ''}`}
                      >
                        {isWishlisted ? '✓ Wishlisted' : '+ Wishlist'}
                      </button>
                    )}
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
