// ============================================================
// src/App.jsx — Vite + React app deployed to GitHub Pages.
// CYBERPUNK EDITION — neon HUD aesthetic, mobile-first layout,
// glassmorphism panels, glitch effects, bottom nav on mobile.
//
// Requires: react, react-router-dom, @supabase/supabase-js, recharts
// Requires: src/index.css with cyberpunk theme (see gaming-backlog-css canvas)
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// ============================================================
import React, { useEffect, useMemo, useState } from "react";
import { HashRouter, Routes, Route, NavLink, Link } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const fmtHours = (m) => `${(m / 60).toFixed(1)}h`;

const FALLBACK =
  "https://images.unsplash.com/photo-1542751371-adc38448a05d?w=320&fit=crop";
const resized = (u) =>
  u ? u.replace("/media/games/", "/media/resize/420/-/games/") : null;

function GameImg({ src, alt = "", className }) {
  const stages = [resized(src), src, FALLBACK].filter(Boolean);
  const [idx, setIdx] = useState(0);
  return (
    <img src={stages[idx]} alt={alt} className={className}
      loading="lazy"
      onError={() => setIdx((i) => Math.min(i + 1, stages.length - 1))} />
  );
}

// ------------------------------------------------------------- data hooks
function useLibrary(version) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("library_entries")
        .select("playtime_forever,last_played,game:games(id,title,cover_url,rawg_rating,genres,released,rating:ratings(score,status))")
        .order("playtime_forever", { ascending: false });
      const norm = (data || []).map((r) => ({
        ...r,
        rating: r.game?.rating ?? null,
        game: r.game ? { ...r.game, rating: undefined } : r.game,
      }));
      setRows(norm);
      setLoading(false);
    })();
  }, [version]);
  return { rows, loading };
}

function useUpcoming(version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("upcoming_releases")
        .select("*")
        .gte("released", new Date().toISOString().slice(0, 10))
        .order("released", { ascending: true });
      setRows(data || []);
    })();
  }, [version]);
  return rows;
}

function useRpc(name, limit, version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    supabase.rpc(name, { p_limit: limit }).then(({ data }) => setRows(data || []));
  }, [name, limit, version]);
  return rows;
}

// ----------------------------------------------------------- nav icons
const NavIcon = ({ name }) => {
  const icons = {
    home: <path d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10" />,
    backlog: <path d="M4 6h16M4 12h16M4 18h7" />,
    recommend: <path d="M12 2l2.5 7H22l-6 4.5L18.5 21 12 16.5 5.5 21 8 13.5 2 9h7.5z" />,
    upcoming: <path d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    sync: <path d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3l2 2M20 15a8 8 0 01-14 3l-2-2" />,
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>
  );
};

// ----------------------------------------------------------- sync button
function SyncButton({ onDone, compact }) {
  const [state, setState] = useState("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("running");
    setMsg("Syncing…");
    const { data, error } = await supabase.functions.invoke("sync-games", { method: "POST" });
    if (error || data?.error) {
      setState("error");
      setMsg(data?.error || error?.message || "Sync failed.");
      return;
    }
    setState("done");
    setMsg(`${data.steamGames ?? 0} games · ${data.enriched ?? 0} enriched · ${((data.ms ?? 0) / 1000).toFixed(1)}s`);
    onDone?.();
  }

  const label = state === "running" ? "Syncing…" : state === "done" ? "Synced ✓" : "Sync";
  const cls = `cyber-btn flex items-center gap-1.5 px-3 py-2 rounded text-xs ${
    state === "running" ? "pulse-glow" : ""} ${
    state === "error" ? "border-rose-500 text-rose-400" : ""} ${
    state === "done" ? "border-emerald-400 text-emerald-400" : ""}`;

  return (
    <div className="flex items-center gap-2">
      {!compact && msg && (
        <span className={`text-[11px] font-mono-tech hidden sm:inline ${
          state === "error" ? "text-rose-400" : "text-cyan-400/60"}`}>{msg}</span>
      )}
      <button onClick={run} disabled={state === "running"} className={cls}>
        <NavIcon name="sync" />
        <span className="uppercase tracking-wider">{label}</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- shell
function TopNav({ onSyncDone }) {
  const link = ({ isActive }) =>
    `px-3 py-2 rounded text-sm font-display font-bold uppercase tracking-wider transition ${
      isActive ? "cyber-nav-active" : "text-white/40 hover:text-cyan-300/80"}`;
  return (
    <nav className="hidden md:flex items-center gap-1 px-6 py-3 border-b border-cyan-500/10 bg-[#07070d]/80 backdrop-blur-md sticky top-0 z-30">
      <Link to="/" className="mr-4 text-lg font-display font-black neon-text-cyan tracking-widest">
        ◈ BACKLOG<span className="neon-text-magenta">.EXE</span>
      </Link>
      <NavLink to="/" end className={link}>Home</NavLink>
      <NavLink to="/backlog" className={link}>Backlog</NavLink>
      <NavLink to="/recommend" className={link}>Recommend</NavLink>
      <NavLink to="/upcoming" className={link}>Upcoming</NavLink>
      <div className="ml-auto"><SyncButton onDone={onSyncDone} /></div>
    </nav>
  );
}

function BottomNav({ onSyncDone }) {
  const link = ({ isActive }) => isActive ? "active" : "";
  return (
    <>
      {/* mobile top bar — logo + sync only */}
      <div className="md:hidden flex items-center justify-between px-4 py-2.5 border-b border-cyan-500/10 bg-[#07070d]/80 backdrop-blur-md sticky top-0 z-30">
        <Link to="/" className="text-base font-display font-black neon-text-cyan tracking-widest">
          ◈ BACKLOG<span className="neon-text-magenta">.EXE</span>
        </Link>
        <SyncButton onDone={onSyncDone} compact />
      </div>
      {/* mobile bottom nav */}
      <nav className="bottom-nav md:hidden">
        <NavLink to="/" end className={link}><NavIcon name="home" /><span>Home</span></NavLink>
        <NavLink to="/backlog" className={link}><NavIcon name="backlog" /><span>Backlog</span></NavLink>
        <NavLink to="/recommend" className={link}><NavIcon name="recommend" /><span>Recs</span></NavLink>
        <NavLink to="/upcoming" className={link}><NavIcon name="upcoming" /><span>Soon</span></NavLink>
      </nav>
    </>
  );
}

function Layout({ onSyncDone, children }) {
  return (
    <div className="min-h-screen text-white/90 font-body relative">
      <div className="cyber-bg" />
      <div className="relative z-10">
        <TopNav onSyncDone={onSyncDone} />
        <BottomNav onSyncDone={onSyncDone} />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">{children}</main>
        <footer className="hidden md:block text-center text-[11px] font-mono-tech text-white/15 py-6">
          // LIVE_DATA :: SUPABASE :: EDGE_FUNCTION :: sync-games //
        </footer>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Home
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="hud-card rounded-lg p-4 sm:p-5">
      <div className="hud-value text-2xl sm:text-3xl lg:text-4xl">{value}</div>
      <div className="text-xs sm:text-sm text-white/40 mt-1 font-display font-bold uppercase tracking-wider">{label}</div>
      {sub && <div className="text-[10px] sm:text-xs text-white/25 mt-0.5 font-mono-tech">{sub}</div>}
    </div>
  );
}

function Home({ version, onSyncDone }) {
  const { rows, loading } = useLibrary(version);
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

  if (loading) return <Layout onSyncDone={onSyncDone}><p className="text-cyan-400/40 font-mono-tech text-sm">// LOADING_DATA…</p></Layout>;

  const COLORS = ["#00f0ff", "#ff2a6d", "#b026ff", "#05ffa1", "#f9f002", "#ff6b1a", "#1a8fff", "#ff1ade"];

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="glitch text-xl sm:text-2xl lg:text-3xl font-display font-black mb-1 text-white" data-text="YOUR BACKLOG">YOUR BACKLOG</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs text-cyan-400/40 mb-5">// SYSTEM_STATUS: ONLINE</p>
        <div className="scan-bar mb-6" />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard label="Games Owned" value={stats.total} />
          <StatCard label="Played" value={stats.played} />
          <StatCard label="Hours" value={stats.hours} sub="total" />
          <StatCard label="Avg Rating" value={stats.avg} sub="backloggd scale" />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="cyber-panel rounded-lg p-4 sm:p-5">
            <h2 className="font-display font-bold text-sm uppercase tracking-wider neon-text-cyan mb-3">// Genre Distribution</h2>
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
            ) : <p className="text-white/30 text-sm font-mono-tech">// NO_DATA — run sync</p>}
          </div>
          <div className="cyber-panel rounded-lg p-4 sm:p-5">
            <h2 className="font-display font-bold text-sm uppercase tracking-wider neon-text-magenta mb-3">// Most Played</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={rows.slice(0, 6).map((r) => ({ name: r.game?.title?.slice(0, 12), hours: +(r.playtime_forever / 60).toFixed(1) }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,240,255,0.06)" />
                <XAxis type="number" stroke="rgba(0,240,255,0.3)" tick={{ fontFamily: 'Share Tech Mono', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" stroke="rgba(0,240,255,0.3)" width={80} tick={{ fontFamily: 'Share Tech Mono', fontSize: 10 }} />
                <Bar dataKey="hours" fill="#00f0ff" radius={[0, 4, 4, 0]} />
                <Tooltip />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// --------------------------------------------------------------- Backlog
function Backlog({ version, onSyncDone }) {
  const { rows, loading } = useLibrary(version);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("playtime");

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

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="glitch text-xl sm:text-2xl font-display font-black mb-1 text-white" data-text="BACKLOG">BACKLOG</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs text-cyan-400/40 mb-5">// {filtered.length} ENTRIES</p>
        <div className="scan-bar mb-5" />

        {/* filters — scrollable on mobile */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="cyber-input min-w-[120px] flex-shrink-0" />
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className="cyber-input flex-shrink-0">
            {genres.map((g) => <option key={g}>{g}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="cyber-input flex-shrink-0">
            {["All", "played", "playing", "backlog", "wishlist", "dropped"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="cyber-input flex-shrink-0">
            <option value="playtime">Most Played</option>
            <option value="rating">Top Rated</option>
            <option value="title">Title A-Z</option>
          </select>
        </div>

        {loading ? <p className="text-cyan-400/40 font-mono-tech text-sm">// LOADING…</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map((r) => (
              <div key={r.game.id} className="game-card rounded-lg overflow-hidden">
                <div className="card-img-wrap">
                  <GameImg src={r.game.cover_url} className="w-full h-28 sm:h-36 object-cover" />
                </div>
                <div className="p-2 sm:p-3">
                  <div className="text-xs sm:text-sm font-display font-bold truncate text-white/90">{r.game.title}</div>
                  <div className="text-[10px] sm:text-xs text-cyan-400/40 font-mono-tech mt-0.5">{fmtHours(r.playtime_forever || 0)}</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(r.game.genres || []).slice(0, 2).map((g) => (
                      <span key={g} className="genre-tag">{g}</span>
                    ))}
                  </div>
                  {r.rating?.score > 0 && (
                    <div className="text-xs neon-text-lime mt-1 font-mono-tech">★ {r.rating.score}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

// ------------------------------------------------------ Recommendations
function MatchBar({ score, max = 10 }) {
  const pct = Math.min(100, (Number(score) / max) * 100);
  return (
    <div className="mt-1.5">
      <div className="flex justify-between items-center mb-0.5">
        <span className="text-[10px] font-mono-tech text-white/30">MATCH</span>
        <span className="text-[10px] font-mono-tech neon-text-cyan">{Number(score).toFixed(2)}</span>
      </div>
      <div className="match-bar"><div className="match-bar-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Recommend({ version, onSyncDone }) {
  const playNext = useRpc("recommend_play_next", 12, version);
  const discover = useRpc("recommend_discover", 12, version);
  const [tab, setTab] = useState("play");
  const items = tab === "play" ? playNext : discover;

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="glitch text-xl sm:text-2xl font-display font-black mb-1 text-white" data-text="RECOMMEND">RECOMMEND</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs text-cyan-400/40 mb-5">// AI_MATCH :: GENRE_AFFINITY_ENGINE</p>
        <div className="scan-bar mb-5" />

        <div className="flex gap-2 mb-5">
          {[["play", "Play Next"], ["discover", "Discover"]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded text-sm font-display font-bold uppercase tracking-wider transition ${
                tab === t ? "cyber-nav-active" : "border border-white/10 text-white/40 hover:text-cyan-300/70"}`}>
              {label}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <p className="text-white/30 font-mono-tech text-sm">
            {tab === "play" ? "// RATE GAMES TO SEED RECOMMENDATIONS" : "// NO MATCHES — RATE MORE GAMES"}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {items.map((r, i) => (
              <div key={tab === "play" ? r.game_id : i} className="game-card rounded-lg overflow-hidden">
                <div className="card-img-wrap">
                  <GameImg src={r.cover_url} className="w-full h-28 sm:h-36 object-cover" />
                </div>
                <div className="p-2 sm:p-3">
                  <div className="text-xs sm:text-sm font-display font-bold truncate text-white/90">{r.title}</div>
                  {tab === "play" ? (
                    <div className="text-[10px] sm:text-xs text-cyan-400/40 font-mono-tech mt-0.5">
                      {fmtHours(r.playtime_forever)} · {r.status}
                    </div>
                  ) : (
                    <div className="text-[10px] sm:text-xs text-cyan-400/40 font-mono-tech mt-0.5">
                      {new Date(r.released).toLocaleDateString()}
                    </div>
                  )}
                  <MatchBar score={r.score} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

// ------------------------------------------------------------- Upcoming
function Upcoming({ version, onSyncDone }) {
  const rows = useUpcoming(version);
  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="glitch text-xl sm:text-2xl font-display font-black mb-1 text-white" data-text="UPCOMING">UPCOMING</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs text-cyan-400/40 mb-5">// {rows.length} RELEASES QUEUED</p>
        <div className="scan-bar mb-5" />

        {rows.length === 0 ? (
          <p className="text-white/30 font-mono-tech text-sm">// NO DATA — RUN SYNC</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {rows.map((r) => (
              <div key={r.id} className="game-card rounded-lg overflow-hidden">
                <div className="card-img-wrap">
                  <GameImg src={r.cover_url} className="w-full h-28 sm:h-36 object-cover" />
                </div>
                <div className="p-2 sm:p-3">
                  <div className="text-xs sm:text-sm font-display font-bold truncate text-white/90">{r.title}</div>
                  <div className="text-[10px] sm:text-xs neon-text-magenta font-mono-tech mt-0.5">
                    {new Date(r.released).toLocaleDateString()}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(r.genres || []).slice(0, 2).map((g) => (
                      <span key={g} className="genre-tag">{g}</span>
                    ))}
                  </div>
                  {r.rawg_rating && (
                    <div className="text-xs neon-text-lime mt-1 font-mono-tech">★ {r.rawg_rating}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

// -------------------------------------------------------------------- App
export default function App() {
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home version={version} onSyncDone={bump} />} />
        <Route path="/backlog" element={<Backlog version={version} onSyncDone={bump} />} />
        <Route path="/recommend" element={<Recommend version={version} onSyncDone={bump} />} />
        <Route path="/upcoming" element={<Upcoming version={version} onSyncDone={bump} />} />
      </Routes>
    </HashRouter>
  );
}