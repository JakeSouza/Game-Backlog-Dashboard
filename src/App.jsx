// ============================================================
// src/App.jsx — Vite + React app deployed to GitHub Pages.
// ONYX EDITION — sleek dark theme, single warm accent, mobile-first layout,
//
// Requires: react, react-router-dom, @supabase/supabase-js, recharts
// Requires: src/index.css with cyberpunk theme (see gaming-backlog-css canvas)
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// ============================================================
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { HashRouter, Routes, Route, NavLink, Link } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const fmtHours = (m) => `${(m / 60).toFixed(1)}h`;

// RAWG's CDN blocks hotlinking from GitHub Pages. Route all cover images
// through wsrv.nl (a free image proxy) which fetches server-side, resizes,
// and caches — bypassing referrer checks entirely.
const FALLBACK =
  "https://wsrv.nl/?url=" + encodeURIComponent("https://images.unsplash.com/photo-1542751371-adc38448a05d?w=320&fit=crop") + "&w=420&h=420&fit=cover&q=80";

function proxied(u) {
  if (!u) return FALLBACK;
  return `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=420&h=300&fit=cover&a=attention&q=80`;
}

function GameImg({ src, steamAppid, alt = "", className }) {
  const stages = [
    steamAppid ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppid}/library_600x900.jpg` : null,
    proxied(src),
    FALLBACK,
  ].filter(Boolean);
  const [idx, setIdx] = useState(0);
  return (
    <img src={stages[idx]} alt={alt} className={className}
      loading="lazy"
      onError={() => setIdx((i) => Math.min(i + 1, stages.length - 1))} />
  );
}

// ----------------------------------------------------------- rating system
// fmtScore — strip trailing zeros: 3.25, 3.5, 3.75, 4, 4.5 …
const fmtScore = (s) => (s ? parseFloat(s.toFixed(2)).toString() : "0");

const STATUSES = ["played", "playing", "backlog", "wishlist", "dropped"];

// StarRating — 5 stars, quarter-star (0.25) precision by default.
// Overlay technique: gray bg stars + cyan fg stars clipped by width.
// Mouse/touch X position snaps to the configured precision.
// Works on desktop (hover preview) and mobile (touch-drag).
function StarRating({ score, onRate, size = 14, precision = 0.25 }) {
  const [hover, setHover] = useState(0);
  const ref = useRef(null);

  const compute = useCallback((clientX) => {
    if (!ref.current) return score;
    const rect = ref.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const starW = rect.width / 5;
    const idx = Math.floor(x / starW);       // 0-4
    const frac = x / starW - idx;             // 0-1 within star
    const snapped = Math.ceil(frac / precision) * precision;
    const val = idx + (snapped > 0 ? snapped : precision);
    return Math.min(5, Math.round(val / precision) * precision);
  }, [precision, score]);

  const display = hover || score;
  const pct = (display / 5) * 100;
  const chars = "★".repeat(5);

  return (
    <span
      className="star-rating"
      ref={ref}
      style={{ fontSize: size, cursor: "pointer" }}
      onMouseMove={(e) => setHover(compute(e.clientX))}
      onMouseLeave={() => setHover(0)}
      onClick={(e) => { e.stopPropagation(); onRate?.(compute(e.clientX)); }}
      onTouchStart={(e) => setHover(compute(e.touches[0].clientX))}
      onTouchMove={(e) => { setHover(compute(e.touches[0].clientX)); e.preventDefault(); }}
      onTouchEnd={(e) => { e.stopPropagation(); onRate?.(compute(e.changedTouches[0].clientX)); setHover(0); }}
    >
      <span className="star-bg-layer">{chars}</span>
      <span className="star-fg-layer" style={{ width: `${pct}%` }}>{chars}</span>
    </span>
  );
}

// StatusBadge — colored status tag
function StatusBadge({ status }) {
  const cls = status ? `status-tag status-${status}` : "status-tag status-none";
  return <span className={cls}>{status || "unrated"}</span>;
}

// DealBadge — current price / discount from IsThereAnyDeal, if tracked.
// Renders nothing if there's no price data yet (game not resolved to an
// ITAD id, or sync-deals hasn't run).
function DealBadge({ game }) {
  if (game?.deal_price == null) return null;
  const onSale = game.deal_cut > 0;
  const badge = (
    <span className={`deal-badge ${onSale ? "deal-badge-sale" : ""}`}>
      {onSale && <span className="deal-cut">-{game.deal_cut}%</span>}
      <span className="deal-price">${Number(game.deal_price).toFixed(2)}</span>
      {onSale && game.deal_regular != null && (
        <span className="deal-regular">${Number(game.deal_regular).toFixed(2)}</span>
      )}
    </span>
  );
  return game.deal_url ? (
    <a href={game.deal_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {badge}
    </a>
  ) : badge;
}

// RateModal — full rating UI in a modal overlay
// Supports precision toggle (¼ star / ½ star) for fine-grained ratings.
function RateModal({ game, currentRating, onClose, onSaved }) {
  const [score, setScore] = useState(currentRating?.score || 0);
  const [status, setStatus] = useState(currentRating?.status || "");
  const [precision, setPrecision] = useState(0.25); // default quarter-star
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("ratings")
      .upsert({
        game_id: game.id,
        user_id: "me",
        score: score || 0,
        status: status || "backlog",
        logged_at: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      }, { onConflict: "game_id,user_id" });
    setSaving(false);
    if (!error) {
      onSaved?.();
      onClose?.();
    }
  }

  async function remove() {
    setSaving(true);
    await supabase.from("ratings").delete().eq("game_id", game.id).eq("user_id", "me");
    setSaving(false);
    onSaved?.();
    onClose?.();
  }

  return (
    <div className="rate-modal-overlay" onClick={onClose}>
      <div className="rate-modal fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3 mb-4">
          <GameImg src={game.cover_url} steamAppid={game.steam_appid} className="w-16 h-20 rounded object-cover flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-display font-bold text-sm truncate" style={{color:'var(--text)'}}>{game.title}</div>
            {game.released && <div className="text-[11px] font-mono-tech">{new Date(game.released).getFullYear()}</div>}
            <div className="flex flex-wrap gap-1 mt-1">
              {(game.genres || []).slice(0, 3).map((g) => (
                <span key={g} className="genre-tag">{g}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-mono-tech uppercase tracking-wider" style={{color:'var(--text-muted)'}}>// Rating</div>
            {/* precision toggle */}
            <div className="flex gap-1">
              <button
                onClick={() => setPrecision(0.25)}
                className={`text-[10px] font-mono-tech px-2 py-0.5 rounded border transition ${
                  precision === 0.25 ? "" : "opacity-40 hover:opacity-70"}`}
                style={precision === 0.25 ? {borderColor:'var(--accent-border)', color:'var(--accent)', background:'var(--accent-dim)'} : {borderColor:'var(--border)'}}
              >¼★</button>
              <button
                onClick={() => setPrecision(0.5)}
                className={`text-[10px] font-mono-tech px-2 py-0.5 rounded border transition ${
                  precision === 0.5 ? "" : "opacity-40 hover:opacity-70"}`}
                style={precision === 0.5 ? {borderColor:'var(--accent-border)', color:'var(--accent)', background:'var(--accent-dim)'} : {borderColor:'var(--border)'}}
              >½★</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StarRating score={score} onRate={setScore} size={26} precision={precision} />
            <span className="text-sm font-mono-tech">
              {score > 0 ? `${fmtScore(score)} / 5.0` : "not rated"}
            </span>
          </div>
        </div>

        <div className="mb-5">
          <div className="text-[11px] font-mono-tech mb-2 uppercase tracking-wider" style={{color:'var(--text-muted)'}}>// Status</div>
          <div className="status-selector">
            {STATUSES.map((s) => (
              <span
                key={s}
                className={`status-tag status-${s} ${status === s ? "selected" : ""}`}
                onClick={() => setStatus(s)}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="cyber-btn flex-1 px-4 py-2.5 rounded text-sm">
            {saving ? "SAVING…" : "SAVE"}
          </button>
          {currentRating && (
            <button onClick={remove} disabled={saving}
              className="px-4 py-2.5 rounded text-sm border transition font-display font-bold uppercase tracking-wider"
              style={{borderColor:'rgba(239,68,68,0.2)', color:'var(--danger)'}}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
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
        .select("playtime_forever,last_played,game:games(id,title,cover_url,rawg_rating,genres,released,steam_appid,deal_price,deal_regular,deal_cut,deal_shop,deal_url,rating:ratings(score,status))")
        .order("playtime_forever", { ascending: false });
      const norm = (data || []).map((r) => ({
        ...r,
        // PostgREST returns nested relations as arrays — unwrap to single object
        rating: Array.isArray(r.game?.rating) ? (r.game.rating[0] || null) : (r.game?.rating ?? null),
        game: r.game ? { ...r.game, rating: undefined } : r.game,
      }));
      setRows(norm);
      setLoading(false);
    })();
  }, [version]);
  return { rows, setRows, loading };
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

// Wishlist — games with status='wishlist' (from Steam sync or manual add)
function useWishlist(version) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ratings")
        .select("score,status,game:games(id,rawg_id,title,cover_url,rawg_rating,genres,released,steam_appid,deal_price,deal_regular,deal_cut,deal_shop,deal_url)")
        .eq("status", "wishlist")
        .eq("user_id", "me")
        .order("updated_at", { ascending: false });
      setRows((data || []).map((r) => ({ ...r, game: Array.isArray(r.game) ? r.game[0] : r.game })));
    })();
  }, [version]);
  return rows;
}

// Add a game to wishlist. Pass { fromUpcoming: true } for upcoming releases
// so we skip the game.id check (it's an upcoming_releases row ID, not a games.id).
// For recommended games, game.game_id or game.id should be the real games.id.
// For upcoming/discovery games, a games row is created via rawg_id upsert.
async function addToWishlist(game, fromUpcoming = false) {
  let gameId = fromUpcoming ? null : (game.game_id || game.id);
  // Validate: if gameId looks like it's from upcoming_releases (not a games row),
  // fall through to the create-by-rawg_id path.
  if (!gameId) {
    // Check if a games row already exists for this rawg_id
    if (game.rawg_id) {
      const { data: existing } = await supabase
        .from("games").select("id").eq("rawg_id", game.rawg_id).limit(1);
      if (existing?.length) gameId = existing[0].id;
    }
    if (!gameId) {
      // Create a games row first (upsert by rawg_id)
      const { data, error } = await supabase.from("games").upsert({
        title: game.title,
        rawg_id: game.rawg_id,
        cover_url: game.cover_url,
        released: game.released,
        genres: game.genres,
        platforms: game.platforms,
        rawg_rating: game.rawg_rating,
        updated_at: new Date().toISOString(),
      }, { onConflict: "rawg_id" }).select();
      if (error || !data?.length) return false;
      gameId = data[0].id;
    }
  }
  const { error: e2 } = await supabase.from("ratings").upsert({
    game_id: gameId, user_id: "me", score: 0, status: "wishlist",
    updated_at: new Date().toISOString(),
  }, { onConflict: "game_id,user_id" });
  return !e2;
}

// ----------------------------------------------------------- nav icons
const NavIcon = ({ name }) => {
  const icons = {
    home: <path d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10" />,
    backlog: <path d="M4 6h16M4 12h16M4 18h7" />,
    recommend: <path d="M12 2l2.5 7H22l-6 4.5L18.5 21 12 16.5 5.5 21 8 13.5 2 9h7.5z" />,
    upcoming: <path d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    wishlist: <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />,
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
    const wlInfo = data.wishlistSynced != null ? ` · ${data.wishlistSynced} wishlist` : "";
    const wlErr = data.wishlistStatus === "error" || data.wishlistStatus === "empty"
      ? ` [WL: ${data.wishlistError || data.wishlistStatus}]` : "";
    setMsg(`${data.steamGames ?? 0} games · ${data.enriched ?? 0} enriched${wlInfo} · ${((data.ms ?? 0) / 1000).toFixed(1)}s${wlErr}`);
    onDone?.();
  }

  const label = state === "running" ? "Syncing…" : state === "done" ? "Synced ✓" : "Sync";
  const cls = `cyber-btn flex items-center gap-1.5 px-3 py-2 rounded text-xs ${
    state === "running" ? "pulse-glow" : ""} ${
    state === "error" ? "" : ""} ${
    state === "done" ? "" : ""}`;

  return (
    <div className="flex items-center gap-2">
      {!compact && msg && (
        <span className="text-[11px] font-mono-tech hidden sm:inline"
          style={{color: state === "error" ? 'var(--danger)' : 'var(--text-muted)'}}>{msg}</span>
      )}
      <button onClick={run} disabled={state === "running"} className={cls}
        style={state === "error" ? {borderColor:'rgba(239,68,68,0.3)', color:'var(--danger)'} : state === "done" ? {borderColor:'rgba(34,197,94,0.3)', color:'var(--success)'} : {}}>
        <NavIcon name="sync" />
        <span className="uppercase tracking-wider">{label}</span>
      </button>
    </div>
  );
}

// ----------------------------------------------------------- sync deals button
// Separate from SyncButton (which runs sync-games) since deal data has its
// own cadence and its own API quota — no need to hit ITAD on every library sync.
function SyncDealsButton() {
  const [state, setState] = useState("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("running");
    setMsg("Checking prices…");
    const { data, error } = await supabase.functions.invoke("sync-deals", { method: "POST" });
    if (error || data?.error) {
      setState("error");
      setMsg(data?.error || error?.message || "Deal sync failed.");
      return;
    }
    setState("done");
    setMsg(`${data.pricesUpdated ?? 0} prices · ${data.idsResolved ?? 0} newly matched · ${((data.ms ?? 0) / 1000).toFixed(1)}s`);
  }

  const label = state === "running" ? "Checking…" : state === "done" ? "Prices ✓" : "Prices";
  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className="text-[11px] font-mono-tech hidden sm:inline"
          style={{color: state === "error" ? 'var(--danger)' : 'var(--text-muted)'}}>{msg}</span>
      )}
      <button onClick={run} disabled={state === "running"} className={`cyber-btn flex items-center gap-1.5 px-3 py-2 rounded text-xs ${state === "running" ? "pulse-glow" : ""}`}
        style={state === "error" ? {borderColor:'rgba(239,68,68,0.3)', color:'var(--danger)'} : state === "done" ? {borderColor:'rgba(34,197,94,0.3)', color:'var(--success)'} : {}}>
        <span className="uppercase tracking-wider">{label}</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- shell
function TopNav({ onSyncDone }) {
  const link = ({ isActive }) =>
    `px-3 py-2 rounded text-sm font-display font-bold uppercase tracking-wider transition ${
      isActive ? "cyber-nav-active" : "hover:opacity-70"}`;
  return (
    <nav className="hidden md:flex items-center gap-1 px-6 py-3 border-b backdrop-blur-md sticky top-0 z-30" style={{borderColor:'var(--border)', background:'rgba(10,10,11,0.9)'}}>
      <Link to="/" className="mr-4 text-lg font-display font-black tracking-widest" style={{color:'var(--accent)'}}>
        ◈ BACKLOG<span style={{color:'var(--text-muted)'}}>.EXE</span>
      </Link>
      <NavLink to="/" end className={link}>Home</NavLink>
      <NavLink to="/backlog" className={link}>Backlog</NavLink>
      <NavLink to="/recommend" className={link}>Recommend</NavLink>
      <NavLink to="/wishlist" className={link}>Wishlist</NavLink>
      <NavLink to="/upcoming" className={link}>Upcoming</NavLink>
      <div className="ml-auto flex items-center gap-2">
        <SyncDealsButton />
        <SyncButton onDone={onSyncDone} />
      </div>
    </nav>
  );
}

function BottomNav({ onSyncDone }) {
  const link = ({ isActive }) => isActive ? "active" : "";
  return (
    <>
      {/* mobile top bar — logo + sync only */}
      <div className="md:hidden flex items-center justify-between px-4 py-2.5 border-b backdrop-blur-md sticky top-0 z-30" style={{borderColor:'var(--border)', background:'rgba(10,10,11,0.9)'}}>
        <Link to="/" className="text-base font-display font-black tracking-widest" style={{color:'var(--accent)'}}>
          ◈ BACKLOG<span style={{color:'var(--text-muted)'}}>.EXE</span>
        </Link>
        <SyncButton onDone={onSyncDone} compact />
      </div>
      {/* mobile bottom nav */}
      <nav className="bottom-nav md:hidden">
        <NavLink to="/" end className={link}><NavIcon name="home" /><span>Home</span></NavLink>
        <NavLink to="/backlog" className={link}><NavIcon name="backlog" /><span>Backlog</span></NavLink>
        <NavLink to="/recommend" className={link}><NavIcon name="recommend" /><span>Recs</span></NavLink>
        <NavLink to="/wishlist" className={link}><NavIcon name="wishlist" /><span>Wish</span></NavLink>
        <NavLink to="/upcoming" className={link}><NavIcon name="upcoming" /><span>Soon</span></NavLink>
      </nav>
    </>
  );
}

function Layout({ onSyncDone, children }) {
  return (
    <div className="min-h-screen font-body relative">
      <div className="cyber-bg" />
      <div className="relative z-10">
        <TopNav onSyncDone={onSyncDone} />
        <BottomNav onSyncDone={onSyncDone} />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">{children}</main>
        <footer className="hidden md:block text-center text-[11px] font-mono-tech py-6" style={{color:'var(--text-dim)'}}>
          // LIVE_DATA :: SUPABASE :: EDGE_FUNCTION :: sync-games //
        </footer>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Home
function MostPlayedGrid({ rows }) {
  const top = rows.slice(0, 5).filter((r) => r.game);
  if (!top.length) return null;
  return (
    <div className="mb-6">
      <h2 className="font-display font-bold text-sm uppercase tracking-wider mb-3" style={{color:'var(--text-muted)'}}>Most Played</h2>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4">
        {top.map((r, i) => (
          <div key={r.game.id} className="mp-card">
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

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="hud-card rounded-lg p-4 sm:p-5">
      <div className="hud-value text-2xl sm:text-3xl lg:text-4xl">{value}</div>
      <div className="text-xs sm:text-sm mt-1 font-display font-bold uppercase tracking-wider" style={{color:'var(--text-muted)'}}>{label}</div>
      {sub && <div className="text-[10px] sm:text-xs mt-0.5 font-mono-tech" style={{color:'var(--text-dim)'}}>{sub}</div>}
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

  if (loading) return <Layout onSyncDone={onSyncDone}><p className="font-mono-tech text-sm" style={{color:'var(--text-muted)'}}>Loading…</p></Layout>;

  const COLORS = ["#f97316", "#a78bfa", "#22c55e", "#eab308", "#ef4444", "#60a5fa", "#e4e4e7", "#71717a"];

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-display font-black mb-1" style={{color:'var(--text)'}}>YOUR BACKLOG</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>system status: online</p>
        <div className="scan-bar mb-6" />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard label="Games Owned" value={stats.total} />
          <StatCard label="Played" value={stats.played} />
          <StatCard label="Hours" value={stats.hours} sub="total" />
          <StatCard label="Avg Rating" value={stats.avg} sub="your ratings" />
        </div>

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
    </Layout>
  );
}

// --------------------------------------------------------------- Backlog
function Backlog({ version, onSyncDone }) {
  const { rows, setRows, loading } = useLibrary(version);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("All");
  const [status, setStatus] = useState("All");
  const [sort, setSort] = useState("playtime");
  const [rateGame, setRateGame] = useState(null);

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

  // Refetch library data after a rating is saved/cleared
  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from("library_entries")
      .select("playtime_forever,last_played,game:games(id,title,cover_url,rawg_rating,genres,released,steam_appid,deal_price,deal_regular,deal_cut,deal_shop,deal_url,rating:ratings(score,status))")
      .order("playtime_forever", { ascending: false });
    const norm = (data || []).map((r) => ({
      ...r,
      // PostgREST returns nested relations as arrays — unwrap to single object
      rating: Array.isArray(r.game?.rating) ? (r.game.rating[0] || null) : (r.game?.rating ?? null),
      game: r.game ? { ...r.game, rating: undefined } : r.game,
    }));
    setRows(norm);
  }, [setRows]);

  const onRatingSaved = useCallback(() => {
    setRateGame(null);
    refetch();
  }, [refetch]);

  // Quick inline star rating (click stars on card) — quarter-star precision
  async function quickRate(gameId, newScore) {
    setRows((prev) => prev.map((r) =>
      r.game?.id === gameId
        ? { ...r, rating: { ...(r.rating || {}), score: newScore, status: r.rating?.status || "played" } }
        : r
    ));
    await supabase.from("ratings").upsert({
      game_id: gameId, user_id: "me", score: newScore,
      status: "played", logged_at: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }, { onConflict: "game_id,user_id" });
  }

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl font-display font-black mb-1" style={{color:'var(--text)'}}>BACKLOG</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>{filtered.length} entries · click to rate</p>
        <div className="scan-bar mb-5" />

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

        {loading ? <p className="font-mono-tech text-sm" style={{color:'var(--text-muted)'}}>Loading…</p> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map((r) => (
              <div key={r.game.id} className="game-card rounded-lg overflow-hidden cursor-pointer"
                   onClick={() => setRateGame({ game: r.game, rating: r.rating })}>
                <div className="card-img-wrap">
                  <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} className="w-full h-28 sm:h-36 object-cover" />
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
                  <div className="mt-1.5"><DealBadge game={r.game} /></div>
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
          onClose={() => setRateGame(null)}
          onSaved={onRatingSaved}
        />
      )}
    </Layout>
  );
}

// ------------------------------------------------------ Recommendations
function MatchBar({ score, max = 10, label = "MATCH" }) {
  const pct = Math.min(100, (Number(score) / max) * 100);
  return (
    <div className="mt-1.5">
      <div className="flex justify-between items-center mb-0.5">
        <span className="text-[10px] font-mono-tech" style={{color:'var(--text-dim)'}}>{label}</span>
        <span className="text-[10px] font-mono-tech" style={{color:'var(--accent)'}}>{Number(score).toFixed(2)}</span>
      </div>
      <div className="match-bar"><div className="match-bar-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Recommend({ version, onSyncDone }) {
  const playNext = useRpc("recommend_play_next", 12, version);
  const discover = useRpc("recommend_discover", 12, version);
  const [tab, setTab] = useState("play");
  const [added, setAdded] = useState({});
  const [wlVersion, setWlVersion] = useState(0);
  const wishlist = useWishlist(wlVersion);
  const wishlistedIds = useMemo(() => {
    const s = new Set();
    wishlist.forEach((w) => {
      if (w.game?.id) s.add(String(w.game.id));
      if (w.game?.rawg_id) s.add(String(w.game.rawg_id));
    });
    return s;
  }, [wishlist]);
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
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>
          genre affinity engine · scores 0–10 based on genre overlap with your rated games
        </p>
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
              const matchPct = r.score ? Math.min(100, (Number(r.score) / 10) * 100) : 0;
              return (
                <div key={tab === "play" ? r.game_id : i} className="game-card rounded-lg overflow-hidden">
                  <div className="card-img-wrap">
                    <GameImg src={r.cover_url} className="w-full h-28 sm:h-36 object-cover" />
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
                    <MatchBar score={r.score} label={tab === "play" ? "REPLAY VALUE" : "GENRE MATCH"} />
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

// ------------------------------------------------------------- Upcoming
function Upcoming({ version, onSyncDone }) {
  const rows = useUpcoming(version);
  const [added, setAdded] = useState({});
  const [wlVersion, setWlVersion] = useState(0);
  const wishlist = useWishlist(wlVersion);

  const wishlistedIds = useMemo(() => {
    const s = new Set();
    wishlist.forEach((w) => {
      if (w.game?.id) s.add(String(w.game.id));
      if (w.game?.rawg_id) s.add(String(w.game.rawg_id));
    });
    return s;
  }, [wishlist]);

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
                    <GameImg src={r.cover_url} className="w-full h-28 sm:h-36 object-cover" />
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
                      {r.rawg_rating && (
                        <div className="text-xs font-mono-tech" style={{color:'var(--success)'}}>★ {r.rawg_rating}</div>
                      )}
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

// ------------------------------------------------------------- Wishlist
// AddGameSearch — searches RAWG directly for any released game (not just
// ones already in Upcoming/Discover) and adds it to the wishlist via the
// existing addToWishlist() helper. Debounced so it doesn't fire on every
// keystroke. Uses import.meta.env.VITE_RAWG_API_KEY, which must be set as
// a GitHub Actions build variable (see deploy.yml) — this key ends up in
// the public JS bundle, same as VITE_SUPABASE_ANON_KEY already does.
function AddGameSearch({ onAdded }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState({});

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const key = import.meta.env.VITE_RAWG_API_KEY;
    if (!key) { console.warn("VITE_RAWG_API_KEY is not set — game search is disabled."); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(query)}&page_size=8`;
        const r = await fetch(url);
        const j = await r.json();
        setResults(j.results || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  async function handleAdd(g) {
    setAdded((p) => ({ ...p, [g.id]: true }));
    await addToWishlist({
      id: null,
      rawg_id: g.id,
      title: g.name,
      cover_url: g.background_image,
      released: g.released,
      genres: (g.genres || []).map((x) => x.name),
      platforms: (g.platforms || []).map((x) => x.platform.name),
      rawg_rating: g.rating,
    });
    onAdded?.();
  }

  return (
    <div className="cyber-panel rounded-lg p-3 sm:p-4 mb-5">
      <div className="text-[11px] font-mono-tech uppercase tracking-wider mb-2" style={{color:'var(--text-muted)'}}>
        Add a game to your wishlist
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any released game…" className="cyber-input w-full" />
      {searching && <p className="text-[11px] font-mono-tech mt-2" style={{color:'var(--text-muted)'}}>Searching…</p>}
      {results.length > 0 && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {results.map((g) => (
            <div key={g.id} className="game-card rounded-lg overflow-hidden">
              <div className="card-img-wrap">
                <img src={g.background_image || FALLBACK} alt="" className="w-full h-20 object-cover" loading="lazy" />
              </div>
              <div className="p-2">
                <div className="text-[11px] font-display font-bold truncate">{g.name}</div>
                <div className="text-[10px] font-mono-tech mt-0.5" style={{color:'var(--text-muted)'}}>
                  {g.released ? new Date(g.released).getFullYear() : ''}
                </div>
                <button
                  onClick={() => handleAdd(g)}
                  className={`wishlist-add-btn mt-1.5 ${added[g.id] ? 'added' : ''}`}
                >
                  {added[g.id] ? '✓ Wishlisted' : '+ Wishlist'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Wishlist({ version, onSyncDone }) {
  const [wlVersion, setWlVersion] = useState(0);
  const rows = useWishlist(`${version}:${wlVersion}`);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    let r = rows.filter((x) => x.game);
    if (q) r = r.filter((x) => x.game.title.toLowerCase().includes(q.toLowerCase()));
    return r;
  }, [rows, q]);

  async function removeWishlist(gameId) {
    await supabase.from("ratings").delete().eq("game_id", gameId).eq("user_id", "me");
  }

  return (
    <Layout onSyncDone={onSyncDone}>
      <div className="fade-in">
        <h1 className="text-xl sm:text-2xl font-display font-black mb-1" style={{color:'var(--text)'}}>WISHLIST</h1>
        <p className="font-mono-tech text-[11px] sm:text-xs mb-5" style={{color:'var(--text-muted)'}}>
          {filtered.length} games · synced from Steam + manually added
        </p>
        <div className="scan-bar mb-5" />

        <AddGameSearch onAdded={() => setWlVersion((v) => v + 1)} />

        <div className="flex gap-2 mb-5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="cyber-input" />
        </div>

        {filtered.length === 0 ? (
          <p className="font-mono-tech text-sm" style={{color:'var(--text-muted)'}}>
            {rows.length === 0 ? "No wishlisted games — run sync or add from Upcoming/Discover" : "No matches"}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map((r) => (
              <div key={r.game.id} className="game-card rounded-lg overflow-hidden">
                <div className="card-img-wrap">
                  <GameImg src={r.game.cover_url} steamAppid={r.game.steam_appid} className="w-full h-28 sm:h-36 object-cover" />
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
                  {r.game.rawg_rating && (
                    <div className="text-xs font-mono-tech mt-1" style={{color:'var(--success)'}}>★ {r.game.rawg_rating}</div>
                  )}
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
        <Route path="/wishlist" element={<Wishlist version={version} onSyncDone={bump} />} />
        <Route path="/upcoming" element={<Upcoming version={version} onSyncDone={bump} />} />
      </Routes>
    </HashRouter>
  );
}