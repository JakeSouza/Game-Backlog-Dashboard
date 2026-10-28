// RefreshCoverBtn — ↻ overlay on card art for a manual per-game image
// refresh. Calls the refresh-cover edge function, which re-fetches art via
// Steam appdetails (RAWG fallback, and it can even discover a missing
// steam_appid) and PATCHes the games row. onDone receives the fresh
// { cover_url, steam_appid } so the page can patch its rows and cache-bust
// the card's GameImg — the new art paints instantly, no full sync needed.
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function RefreshCoverBtn({ gameId, onDone }) {
  const [state, setState] = useState("idle"); // idle | busy | done | error
  async function run(e) {
    e.stopPropagation();
    if (state === "busy") return;
    setState("busy");
    const { data, error } = await supabase.functions.invoke("refresh-cover", { body: { game_id: gameId } });
    if (error || data?.error) {
      setState("error");
      console.error("refresh-cover failed:", data?.error || error?.message);
      setTimeout(() => setState("idle"), 2500);
      return;
    }
    setState("done");
    onDone?.(data);
    setTimeout(() => setState("idle"), 1800);
  }
  return (
    <button
      className={`cover-refresh-btn ${state === "busy" ? "spinning" : state}`}
      title="Refresh cover art (Steam)"
      aria-label="Refresh cover art"
      onClick={run}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  );
}
