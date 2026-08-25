// ============================================================
// src/App.jsx — Vite + React app deployed to GitHub Pages.
// Reads read-only from Supabase (anon key + RLS). The "Sync now"
// button calls the sync-games Edge Function directly — it fetches
// Steam + RAWG + backloggd and writes to Postgres server-side.
// No GitHub Actions, no PAT. Use HashRouter for GitHub Pages.
//
// Requires: react, react-router-dom, @supabase/supabase-js, recharts
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

// RAWG hands back full-res screenshots (often 2–5MB each). Use their
// resize endpoint for small, fast covers, then fall back to the original
// URL, then a generic placeholder if both fail.
const FALLBACK =
  "https://images.unsplash.com/photo-1542751371-adc38448a05d?w=320&fit=crop";
const resized = (u) =>
  u ? u.replace("/media/games/", "/media/resize/420/-/games/") : null;

function GameImg({ src, alt = "", className }) {
  const stages = [resized(src), src, FALLBACK].filter(Boolean);
  const [idx, setIdx] = useState(0);
  return (
    <img
      src={stages[idx]}
      alt={alt}
      className={className}
      onError={() => setIdx((i) => Math.min(i + 1, stages.length - 1))}
    />
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
      // ratings joins on games, not library_entries, so PostgREST can't
      // embed it directly. Nest it under game and flatten to r.rating so the
      // rest of the app keeps using r.rating?.score / r.rating?.status.
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

// ----------------------------------------------------------- sync button
// Calls the sync-games edge function directly. It returns a summary
// of what it wrote; on success we bump `version` so every page refetches
// live data instantly — no rebuild needed.
function SyncButton({ onDone }) {
  const [state, setState] = useState("idle"); // idle | running | done | error
  const [msg, setMsg] = useState("");

  async function run() {
    setState("running");
    setMsg("Syncing Steam + RAWG + backloggd…");
    const { data, error } = await supabase.functions.invoke("sync-games", { method: "POST" });
    if (error || data?.error) {
      setState("error");
      setMsg(data?.error || error?.message || "Sync failed.");
      return;
    }
    setState("done");
    const parts = [
      `${data.steamGames ?? 0} games`,
      data.enriched ? `${data.enriched} enriched` : null,
      data.ratingsUpserted ? `${data.ratingsUpserted} ratings` : null,
      `${data.upcoming ?? 0} upcoming`,
    ].filter(Boolean).join(" · ");
    setMsg(`✓ ${parts} · ${((data.ms ?? 0) / 1000).toFixed(1)}s`);
    onDone?.();
  }

  const cls = `px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ml-auto ${
    state === "running" ? "bg-slate-700 text-slate-300 cursor-wait"
    : state === "done" ? "bg-emerald-700 text-white"
    : state === "error" ? "bg-rose-700 text-white"
    : "bg-violet-600 text-white hover:bg-violet-500"}`;

  return (
    <div className="flex items-center gap-3">
      {msg && (
        <span className={`text-xs hidden sm:inline ${state === "error" ? "text-rose-400" : "text-slate-400"}`}>
          {msg}
        </span>
      )}
      <button onClick={run} disabled={state === "running"} className={cls}>
        {state === "running" ? "⟳ Syncing…" : state === "done" ? "↻ Sync again" : "↻ Sync now"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- shell
function Nav({ onSyncDone }) {
  const link = ({ isActive }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition ${
      isActive ? "bg-violet-600 text-white" : "text-slate-300 hover:bg-slate-800"}`;
  return (
    <nav className="flex items-center gap-1 bg-slate-900/80 backdrop-blur sticky top-0 z-10 px-4 py-3 border-b border-slate-800">
      <Link to="/" className="mr-3 text-lg font-bold text-white">🎮 Backlog</Link>
      <NavLink to="/" end className={link}>Home</NavLink>
      <NavLink to="/backlog" className={link}>Backlog</NavLink>
      <NavLink to="/recommend" className={link}>Recommendations</NavLink>
      <NavLink to="/upcoming" className={link}>Upcoming</NavLink>
      <SyncButton onDone={onSyncDone} />
    </nav>
  );
}

function Layout({ onSyncDone, children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Nav onSyncDone={onSyncDone} />
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <footer className="text-center text-xs text-slate-600 py-6">
        Live data from Supabase · Sync button calls the sync-games Edge Function
      </footer>
    </div>
  );
}

// -------------------------------------------------------------------- Home
function StatCard({ label, value, sub }) {
  return (
    <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
      <div className="text-3xl font-bold text-violet-400">{value}</div>
      <div className="text-sm text-slate-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
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

  if (loading) return <Layout onSyncDone={onSyncDone}><p className="text-slate-500">Loading…</p></Layout>;
  const COLORS = ["#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#a3e635"];
  return (
    <Layout onSyncDone={onSyncDone}>
      <h1 className="text-2xl font-bold mb-4">Your gaming backlog</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Games owned" value={stats.total} />
        <StatCard label="Played" value={stats.played} />
        <StatCard label="Hours played" value={stats.hours} />
        <StatCard label="Avg rating" value={stats.avg} sub="backloggd scale" />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
          <h2 className="font-semibold mb-3">Genre breakdown</h2>
          {stats.genres.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={stats.genres.map(([name, value]) => ({ name, value }))}
                  dataKey="value" nameKey="name" outerRadius={90} label>
                  {stats.genres.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-slate-600 text-sm">No genre data yet. Hit Sync now.</p>}
        </div>
        <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
          <h2 className="font-semibold mb-3">Most played</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={rows.slice(0, 6).map((r) => ({ name: r.game?.title?.slice(0, 14), hours: +(r.playtime_forever / 60).toFixed(1) }))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" stroke="#64748b" />
              <YAxis type="category" dataKey="name" stroke="#64748b" width={90} />
              <Bar dataKey="hours" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
              <Tooltip />
            </BarChart>
          </ResponsiveContainer>
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
      <h1 className="text-2xl font-bold mb-4">Backlog</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm" />
        <select value={genre} onChange={(e) => setGenre(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm">
          {genres.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm">
          {["All", "played", "playing", "backlog", "wishlist", "dropped"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm">
          <option value="playtime">Most played</option>
          <option value="rating">Top rated</option>
          <option value="title">Title A-Z</option>
        </select>
      </div>
      {loading ? <p className="text-slate-500">Loading…</p> : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filtered.map((r) => (
            <div key={r.game.id} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
              <GameImg src={r.game.cover_url} className="w-full h-32 object-cover" />
              <div className="p-2">
                <div className="text-sm font-medium truncate">{r.game.title}</div>
                <div className="text-xs text-slate-500">{fmtHours(r.playtime_forever || 0)} played</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(r.game.genres || []).slice(0, 2).map((g) => (
                    <span key={g} className="text-[10px] bg-slate-800 rounded px-1.5 py-0.5">{g}</span>
                  ))}
                </div>
                {r.rating?.score > 0 && (
                  <div className="text-xs text-amber-400 mt-1">★ {r.rating.score}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

// ------------------------------------------------------ Recommendations
function Recommend({ version, onSyncDone }) {
  const playNext = useRpc("recommend_play_next", 12, version);
  const discover = useRpc("recommend_discover", 12, version);
  const [tab, setTab] = useState("play");
  return (
    <Layout onSyncDone={onSyncDone}>
      <h1 className="text-2xl font-bold mb-1">Recommendations</h1>
      <p className="text-slate-500 text-sm mb-4">
        Ranked by your genre affinity — the genres you rate highest score higher.
      </p>
      <div className="flex gap-2 mb-4">
        {["play", "discover"].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              tab === t ? "bg-violet-600 text-white" : "bg-slate-900 border border-slate-800"}`}>
            {t === "play" ? "Play next" : "Discover"}
          </button>
        ))}
      </div>
      {tab === "play" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {playNext.map((r) => (
            <div key={r.game_id} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
              <GameImg src={r.cover_url} className="w-full h-32 object-cover" />
              <div className="p-2">
                <div className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-slate-500">{fmtHours(r.playtime_forever)} · {r.status}</div>
                <div className="text-xs text-violet-400 mt-1">match {Number(r.score).toFixed(2)}</div>
              </div>
            </div>
          ))}
          {!playNext.length && <p className="text-slate-600">Rate a few games to seed recommendations.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {discover.map((r, i) => (
            <div key={i} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
              <GameImg src={r.cover_url} className="w-full h-32 object-cover" />
              <div className="p-2">
                <div className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-slate-500">{new Date(r.released).toLocaleDateString()}</div>
                <div className="text-xs text-violet-400 mt-1">match {Number(r.score).toFixed(2)}</div>
              </div>
            </div>
          ))}
          {!discover.length && <p className="text-slate-600">No upcoming matches. Rate more games to tune affinity.</p>}
        </div>
      )}
    </Layout>
  );
}

// ------------------------------------------------------------- Upcoming
function Upcoming({ version, onSyncDone }) {
  const rows = useUpcoming(version);
  return (
    <Layout onSyncDone={onSyncDone}>
      <h1 className="text-2xl font-bold mb-4">Upcoming releases</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {rows.map((r) => (
          <div key={r.id} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
            <GameImg src={r.cover_url} className="w-full h-32 object-cover" />
            <div className="p-2">
              <div className="text-sm font-medium truncate">{r.title}</div>
              <div className="text-xs text-slate-500">{new Date(r.released).toLocaleDateString()}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(r.genres || []).slice(0, 2).map((g) => (
                  <span key={g} className="text-[10px] bg-slate-800 rounded px-1.5 py-0.5">{g}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-slate-600">No upcoming releases synced yet. Hit Sync now.</p>}
      </div>
    </Layout>
  );
}

// -------------------------------------------------------------------- App
// One `version` counter: SyncButton bumps it on success and every page
// refetches live data instantly. No rebuild, no polling.
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