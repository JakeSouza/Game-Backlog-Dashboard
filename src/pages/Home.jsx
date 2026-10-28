// Home — dashboard: now-playing shelf, stat cards, all-time favorites,
// most played, and genre distribution.
import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { fmtHours, fmtScore } from "../lib/format";
import { useLibrary } from "../hooks/useLibrary";
import Layout from "../components/Layout";
import RateModal from "../components/RateModal";
import GameImg from "../components/GameImg";
import { SkeletonHome } from "../components/Skeletons";

const COLORS = ["#2de1c2", "#7b5cff", "#4fb8ff", "#4ddba3", "#ffcf5c", "#ff5a7a", "#9b6bff", "#6fa39c"];

function NowPlaying({ rows, onOpen }) {
  const playing = rows.filter((r) => r.game && r.rating?.status === "playing");
  if (!playing.length) return null;
  return (
    <div className="mb-6">
      <h2 className="font-display font-bold text-sm uppercase tracking-wider mb-3" style={{color:'var(--text-muted)'}}>Now Playing</h2>
      <div className="flex flex-col gap-3">
        {playing.map((r) => (
          <div
            key={r.game.id}
            className="now-playing-card"
            onClick={() => onOpen({ game: r.game, rating: r.rating, playtime_forever: r.playtime_forever })}
          >
            <div className="np-cover">
              <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} className="w-full h-full object-cover" />
            </div>
            <div className="np-info">
              <div className="np-live"><span className="np-dot" />NOW PLAYING</div>
              <div className="np-title">{r.game.title}</div>
              <div className="np-meta">
                <span>{fmtHours(r.playtime_forever || 0)} logged</span>
                {r.rating?.score > 0 && <span className="np-stars">★ {fmtScore(r.rating.score)}</span>}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(r.game.genres || []).slice(0, 3).map((g) => (
                  <span key={g} className="genre-tag">{g}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FavoritesGrid({ rows }) {
  const favs = rows
    .filter((r) => r.game && r.rating?.favorite_rank)
    .sort((a, b) => a.rating.favorite_rank - b.rating.favorite_rank);
  if (!favs.length) return null;
  return (
    <div className="favorites-shelf mb-6">
      <h2 className="favorites-shelf-title">
        <span className="favorites-shelf-icon">✦</span>
        All-Time Favorites
        <span className="favorites-shelf-icon">✦</span>
      </h2>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-4 sm:gap-5">
        {favs.map((r, i) => (
          <div key={r.game.id} className="mp-card fav-card stagger-in" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="mp-cover-wrap fav-cover-wrap">
              <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} className="w-full h-full object-cover" />
              <span className="fav-rank-badge">{r.rating.favorite_rank}</span>
            </div>
            <div className="mp-info">
              <div className="mp-title">{r.game.title}</div>
              {r.rating.score > 0 && (
                <div className="mp-meta"><span className="mp-stars">★ {fmtScore(r.rating.score)}</span></div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MostPlayedGrid({ rows }) {
  const top = rows.slice(0, 5).filter((r) => r.game);
  if (!top.length) return null;
  return (
    <div className="mb-6">
      <h2 className="font-display font-bold text-sm uppercase tracking-wider mb-3" style={{color:'var(--text-muted)'}}>Most Played</h2>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4">
        {top.map((r, i) => (
          <div key={r.game.id} className="mp-card stagger-in" style={{ animationDelay: `${i * 45}ms` }}>
            <div className="mp-cover-wrap">
              <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} className="w-full h-full object-cover" />
              <span className="mp-rank">{i + 1}</span>
            </div>
            <div className="mp-info">
              <div className="mp-title">{r.game.title}</div>
              <div className="mp-meta">
                <span>{fmtHours(r.playtime_forever || 0)}</span>
                {r.rating?.score > 0 && <span className="mp-stars">★ {fmtScore(r.rating.score)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="hud-card rounded-lg p-4 sm:p-5">
      <div className="hud-value text-2xl sm:text-3xl lg:text-4xl">{value}</div>
      <div className="text-xs sm:text-sm mt-1 font-display font-bold uppercase tracking-wider" style={{color:'var(--text-muted)'}}>{label}</div>
      {sub && <div className="text-[10px] sm:text-xs mt-0.5 font-mono-tech" style={{color:'var(--text-dim)'}}>{sub}</div>}
    </div>
  );
}

export default function Home({ version, onSyncDone }) {
  const { rows, loading, refetch } = useLibrary(version);
  const [rateGame, setRateGame] = useState(null);

  const onRatingSaved = () => {
    setRateGame(null);
    refetch();
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const played = rows.filter((r) => r.rating?.status === "played").length;
    const hours = rows.reduce((a, r) => a + (r.playtime_forever || 0), 0) / 60;
    const rated = rows.filter((r) => r.rating?.score > 0);
    const avg = rated.length
      ? (rated.reduce((a, r) => a + r.rating.score, 0) / rated.length).toFixed(2) : "—";
    const genreCount = {};
    rows.forEach((r) => (r.game?.genres || []).forEach((g) => genreCount[g] = (genreCount[g] || 0) + 1));
    const genres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { total, played, hours: hours.toFixed(0), avg, genres };
  }, [rows]);

  if (loading) return (
    <Layout onSyncDone={onSyncDone}>
      <div className="mb-6">
        <div className="skeleton skeleton-line" style={{ width: 180, height: 26 }} />
      </div>
      <div className="scan-bar mb-6" />
      <SkeletonHome />
    </Layout>
  );

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-black mb-1" style={{color:'var(--text)'}}>YOUR BACKLOG</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>system status: online</p>
        <div className="scan-bar mb-6" />

        <NowPlaying rows={rows} onOpen={setRateGame} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard label="Games Owned" value={stats.total} />
          <StatCard label="Played" value={stats.played} />
          <StatCard label="Hours" value={stats.hours} sub="total" />
          <StatCard label="Avg Rating" value={stats.avg} sub="your ratings" />
        </div>

        <FavoritesGrid rows={rows} />

        <MostPlayedGrid rows={rows} />

        <div className="cyber-panel rounded-lg p-4 sm:p-5">
          <h2 className="font-display font-bold text-sm uppercase tracking-wider mb-3" style={{color:'var(--text-muted)'}}>Genre Distribution</h2>
          {stats.genres.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={stats.genres.map(([name, value]) => ({ name, value }))}
                  dataKey="value" nameKey="name" outerRadius={80} innerRadius={40} label>
                  {stats.genres.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-sm font-mono-tech" style={{color:'var(--text-muted)'}}>No data — run sync</p>}
        </div>
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
