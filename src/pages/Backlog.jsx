// Backlog — the full owned-library grid with search/filter/sort, quick
// inline star ratings, and per-card cover refresh.
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { STATUSES, fmtHours, fmtScore } from "../lib/format";
import { useLibrary } from "../hooks/useLibrary";
import Layout from "../components/Layout";
import RateModal from "../components/RateModal";
import GameImg from "../components/GameImg";
import RefreshCoverBtn from "../components/RefreshCoverBtn";
import StarRating from "../components/StarRating";
import StatusBadge from "../components/StatusBadge";
import GameSearch from "../components/GameSearch";
import { SkeletonGrid } from "../components/Skeletons";

export default function Backlog({ version, onSyncDone }) {
  const { rows, setRows, loading, refetch } = useLibrary(version);
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [genre, setGenre] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("playtime");
  const [rateGame, setRateGame] = useState(null);
  const [imgRefresh, setImgRefresh] = useState({}); // { gameId: cacheBustKey }

  const genres = useMemo(
    () => ["All", ...[...new Set(rows.flatMap((r) => r.game?.genres || []))].sort()],
    [rows]
  );
  const filtered = useMemo(() => {
    let r = rows.filter((x) => x.game);
    if (q) r = r.filter((x) => x.game.title.toLowerCase().includes(q.toLowerCase()));
    if (genre !== "All") r = r.filter((x) => (x.game.genres || []).includes(genre));
    if (status !== "All") r = r.filter((x) => (x.rating?.status || "backlog") === status);
    r.sort((a, b) => {
      if (sort === "playtime") return (b.playtime_forever || 0) - (a.playtime_forever || 0);
      if (sort === "rating") return (b.rating?.score || 0) - (a.rating?.score || 0);
      if (sort === "title") return a.game.title.localeCompare(b.game.title);
      return 0;
    });
    return r;
  }, [rows, q, genre, status, sort]);

  const onRatingSaved = useCallback(() => {
    setRateGame(null);
    refetch();
  }, [refetch]);

  // Manual cover refresh: patch the fresh art into local rows and
  // cache-bust that card's GameImg so the new image paints immediately.
  const onCoverRefreshed = useCallback((gameId, patch) => {
    setImgRefresh((p) => ({ ...p, [gameId]: Date.now() }));
    setRows((prev) => prev.map((r) => r.game?.id !== gameId ? r : {
      ...r,
      game: {
        ...r.game,
        ...(patch.cover_url ? { cover_url: patch.cover_url } : {}),
        ...(patch.steam_appid != null ? { steam_appid: patch.steam_appid } : {}),
      },
    }));
  }, [setRows]);

  // Quick inline star rating (click stars on card) — quarter-star precision
  async function quickRate(gameId, newScore) {
    // Optimistic: paint the new rating immediately, then reconcile. Snapshot
    // the previous value first so a failed write can roll back instead of
    // leaving the UI showing a rating that was never saved.
    let previous = null;
    setRows((prev) => prev.map((r) => {
      if (r.game?.id !== gameId) return r;
      previous = r.rating;
      return { ...r, rating: { ...(r.rating || {}), score: newScore, status: r.rating?.status || "played" } };
    }));
    const { error } = await supabase.from("ratings").upsert({
      game_id: gameId, user_id: "me", score: newScore,
      status: "played", logged_at: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }, { onConflict: "game_id,user_id" });
    if (error) {
      setRows((prev) => prev.map((r) => (r.game?.id === gameId ? { ...r, rating: previous } : r)));
      console.error("quickRate failed, rolled back:", error.message);
    }
  }

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl font-display font-black mb-1" style={{color:'var(--text)'}}>BACKLOG</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>{filtered.length} entries · click to rate</p>
        <div className="scan-bar mb-5" />

        <GameSearch mode="backlog" onAdded={refetch} />

        {/* filters — scrollable on mobile */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="cyber-input min-w-[120px] flex-shrink-0" />
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className="cyber-input flex-shrink-0">
            {genres.map((g) => <option key={g}>{g}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="cyber-input flex-shrink-0">
            {["All", ...STATUSES].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="cyber-input flex-shrink-0">
            <option value="playtime">Most Played</option>
            <option value="rating">Top Rated</option>
            <option value="title">Title A-Z</option>
          </select>
        </div>

        {loading ? <SkeletonGrid count={10} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map((r, i) => (
              <div key={r.game.id} className="game-card rounded-lg overflow-hidden cursor-pointer stagger-in"
                   style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
                   onClick={() => setRateGame({ game: r.game, rating: r.rating, playtime_forever: r.playtime_forever })}>
                <div className="card-img-wrap">
                  <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} refreshKey={imgRefresh[r.game.id] || 0} className="w-full h-28 sm:h-36 object-cover" />
                  <div className="absolute top-1.5 left-1.5 z-10">
                    <RefreshCoverBtn gameId={r.game.id} onDone={(d) => onCoverRefreshed(r.game.id, d)} />
                  </div>
                  {r.rating?.status && (
                    <div className="absolute top-1.5 right-1.5 z-10">
                      <StatusBadge status={r.rating.status} />
                    </div>
                  )}
                </div>
                <div className="p-2 sm:p-3">
                  <div className="text-xs sm:text-sm font-display font-bold truncate">{r.game.title}</div>
                  <div className="text-[10px] sm:text-xs font-mono-tech mt-0.5">{fmtHours(r.playtime_forever || 0)}</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(r.game.genres || []).slice(0, 2).map((g) => (
                      <span key={g} className="genre-tag">{g}</span>
                    ))}
                  </div>
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <StarRating score={r.rating?.score || 0} onRate={(s) => quickRate(r.game.id, s)} />
                  </div>
                  {r.rating?.score > 0 && (
                    <div className="text-[10px] mt-0.5 font-mono-tech" style={{color:'var(--success)'}}>{fmtScore(r.rating.score)} / 5</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {rateGame && (
        <RateModal
          game={rateGame.game}
          currentRating={rateGame.rating}
          currentPlaytime={rateGame.playtime_forever}
          onClose={() => setRateGame(null)}
          onSaved={onRatingSaved}
        />
      )}
    </Layout>
  );
}
