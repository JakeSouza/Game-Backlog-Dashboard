// CommandPalette — ⌘K / ctrl-K fuzzy launcher. Jumps to pages and games,
// and runs sync actions inline.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { startViewTransition } from "../lib/transitions";
import GameImg from "./GameImg";

const PALETTE_PAGES = [
  { label: "Home", to: "/", keywords: "home dashboard stats" },
  { label: "Backlog", to: "/backlog", keywords: "backlog owned library games" },
  { label: "Wishlist", to: "/wishlist", keywords: "wishlist want deals prices" },
  { label: "Upcoming", to: "/upcoming", keywords: "upcoming releases coming soon" },
  { label: "Recommend", to: "/recommend", keywords: "recommend play next discover" },
];

export default function CommandPalette({ onSyncDone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [gameResults, setGameResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpenEvent() { setOpen(true); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setGameResults([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setGameResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("games")
        .select("id,title,cover_url,steam_appid,library_entries(playtime_forever),ratings(status,user_id)")
        .ilike("title", `%${q.trim()}%`)
        .limit(10);
      // Defensive against historical duplicate games rows (same title,
      // only one actually linked to library_entries/ratings) — when two
      // results share a title, keep whichever one actually has tracking
      // data rather than trusting result order.
      const byTitle = new Map();
      for (const g of data || []) {
        const key = g.title.toLowerCase();
        const existing = byTitle.get(key);
        const hasData = (g.library_entries?.length || g.ratings?.length) > 0;
        if (!existing || (hasData && !((existing.library_entries?.length || existing.ratings?.length) > 0))) {
          byTitle.set(key, g);
        }
      }
      setGameResults(Array.from(byTitle.values()).slice(0, 6));
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function go(to) {
    setOpen(false);
    startViewTransition(navigate, to);
  }

  async function runSync() {
    setOpen(false);
    await supabase.functions.invoke("sync-games", { method: "POST" });
    onSyncDone?.();
  }
  async function runSyncDeals() {
    setOpen(false);
    await supabase.functions.invoke("sync-deals", { method: "POST" });
    onSyncDone?.();
  }

  const filteredPages = PALETTE_PAGES.filter((p) =>
    !q.trim() || (p.label + " " + p.keywords).toLowerCase().includes(q.trim().toLowerCase())
  );
  const actions = [
    { label: "↻ Sync now (Steam + RAWG)", run: runSync, keywords: "sync steam refresh" },
    { label: "💲 Sync deal prices", run: runSyncDeals, keywords: "sync deals prices itad" },
  ].filter((a) => !q.trim() || (a.label + " " + a.keywords).toLowerCase().includes(q.trim().toLowerCase()));

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a page, a game, or run a sync…"
          className="palette-input"
        />
        <div className="palette-results">
          {gameResults.length > 0 && (
            <div className="palette-section">
              <div className="palette-section-label">Games{searching ? " · searching…" : ""}</div>
              {gameResults.map((g) => {
                const owned = (g.library_entries || []).length > 0;
                const wishlisted = (g.ratings || []).some((r) => r.status === "wishlist");
                const dest = owned ? "/backlog" : wishlisted ? "/wishlist" : "/backlog";
                return (
                  <div key={g.id} className="palette-item" onClick={() => go(`${dest}?q=${encodeURIComponent(g.title)}`)}>
                    <div className="palette-item-cover">
                      <GameImg src={g.cover_url} steamAppid={g.steam_appid} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="palette-item-title">{g.title}</div>
                      <div className="palette-item-sub">{owned ? "In Backlog" : wishlisted ? "In Wishlist" : "Not tracked yet"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {filteredPages.length > 0 && (
            <div className="palette-section">
              <div className="palette-section-label">Pages</div>
              {filteredPages.map((p) => (
                <div key={p.to} className="palette-item palette-item-flat" onClick={() => go(p.to)}>
                  {p.label}
                </div>
              ))}
            </div>
          )}
          {actions.length > 0 && (
            <div className="palette-section">
              <div className="palette-section-label">Actions</div>
              {actions.map((a) => (
                <div key={a.label} className="palette-item palette-item-flat" onClick={a.run}>
                  {a.label}
                </div>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !searching && gameResults.length === 0 && filteredPages.length === 0 && actions.length === 0 && (
            <p className="palette-empty">No matches for "{q}"</p>
          )}
        </div>
        <div className="palette-hint">
          <kbd>esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
