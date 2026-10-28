// GameSearch — shared RAWG search panel used by the Wishlist and Backlog
// pages. Replaces the two ~90%-identical AddGameSearch / AddBacklogSearch
// components with one component and a `mode` prop:
//
//   mode="wishlist" → adds the game to ratings via addToWishlist()
//   mode="backlog"  → adds it to library_entries via addToBacklog(),
//                     with an optional "hours played" entry
//
// Both modes search through the search-games edge function (RAWG's API
// doesn't send CORS headers permitting browser calls), debounce input, and
// offer an optional per-result Steam ID entry — populating steam_appid is
// what makes Steam CDN art and price tracking work for manual adds.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { addToBacklog, addToWishlist } from "../lib/games";
import GameImg from "./GameImg";

export default function GameSearch({ mode = "wishlist", onAdded }) {
  const isBacklog = mode === "backlog";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState({});
  const [error, setError] = useState("");
  const [steamIds, setSteamIds] = useState({});
  const [hoursMap, setHoursMap] = useState({});
  const [addErrors, setAddErrors] = useState({});

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(""); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const { data, error: fnError } = await supabase.functions.invoke("search-games", { body: { q: query } });
        if (fnError || data?.error) throw new Error(data?.error || fnError.message);
        setResults(data?.results || []);
      } catch (e) {
        setResults([]);
        setError(e?.message || "Search failed — check the browser console for details.");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  async function handleAdd(g) {
    setAddErrors((p) => ({ ...p, [g.id]: "" }));
    const raw = (steamIds[g.id] || "").trim();
    const steamAppid = raw ? parseInt(raw, 10) : null;
    const game = {
      rawg_id: g.id,
      title: g.name,
      cover_url: g.background_image,
      released: g.released,
      genres: (g.genres || []).map((x) => x.name),
      platforms: (g.platforms || []).map((x) => x.platform.name),
      rawg_rating: g.rating,
      steam_appid: Number.isFinite(steamAppid) ? steamAppid : null,
    };
    const result = isBacklog
      ? await addToBacklog(game, Math.round((parseFloat(hoursMap[g.id] || "0") || 0) * 60))
      : await addToWishlist({ ...game, id: null });
    if (result.ok) {
      setAdded((p) => ({ ...p, [g.id]: true }));
      onAdded?.();
    } else {
      setAddErrors((p) => ({ ...p, [g.id]: result.error || "Failed to add — see console." }));
      console.error(`addTo${isBacklog ? "Backlog" : "Wishlist"} failed:`, result.error);
    }
  }

  return (
    <div className="cyber-panel rounded-lg p-3 sm:p-4 mb-5">
      <div className="text-[11px] font-mono-tech uppercase tracking-wider mb-2" style={{color:'var(--text-muted)'}}>
        {isBacklog
          ? "Add a game not synced from Steam (Epic, handheld, physical, etc.)"
          : "Add a game to your wishlist"}
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any released game…" className="cyber-input w-full" />
      {searching && <p className="text-[11px] font-mono-tech mt-2" style={{color:'var(--text-muted)'}}>Searching…</p>}
      {error && <p className="text-[11px] font-mono-tech mt-2" style={{color:'var(--danger)'}}>{error}</p>}
      {results.length > 0 && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {results.map((g) => (
            <div key={g.id} className="game-card rounded-lg overflow-hidden">
              <div className="card-img-wrap">
                <GameImg
                  key={g.id}
                  src={g.background_image}
                  steamAppid={steamIds[g.id] ? parseInt(steamIds[g.id], 10) : null}
                  alt={g.name}
                  className="w-full h-20 object-cover"
                />
              </div>
              <div className="p-2">
                <div className="text-[11px] font-display font-bold truncate">{g.name}</div>
                <div className="text-[10px] font-mono-tech mt-0.5" style={{color:'var(--text-muted)'}}>
                  {g.released ? new Date(g.released).getFullYear() : ''}
                </div>
                <input
                  value={steamIds[g.id] || ''}
                  onChange={(e) => setSteamIds((p) => ({ ...p, [g.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="Steam ID (optional)"
                  inputMode="numeric"
                  className="cyber-input w-full mt-1.5 !text-[10px] !py-1 !px-2"
                  disabled={added[g.id]}
                />
                {isBacklog && (
                  <input
                    value={hoursMap[g.id] || ''}
                    onChange={(e) => setHoursMap((p) => ({ ...p, [g.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                    placeholder="Hours played (optional)"
                    inputMode="decimal"
                    className="cyber-input w-full mt-1.5 !text-[10px] !py-1 !px-2"
                    disabled={added[g.id]}
                  />
                )}
                <button
                  onClick={() => handleAdd(g)}
                  className={`wishlist-add-btn mt-1.5 ${added[g.id] ? 'added' : ''}`}
                >
                  {added[g.id] ? (isBacklog ? '✓ Added' : '✓ Wishlisted') : (isBacklog ? '+ Backlog' : '+ Wishlist')}
                </button>
                {addErrors[g.id] && (
                  <p className="text-[9px] font-mono-tech mt-1" style={{color:'var(--danger)'}}>{addErrors[g.id]}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
