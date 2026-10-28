// SyncButton — runs the sync-games edge function (Steam + RAWG +
// backloggd → Postgres). onDone is called after a successful sync so the
// app can bump its data version and every page refetches.
import { useState } from "react";
import { supabase } from "../lib/supabase";
import NavIcon from "./NavIcon";

export default function SyncButton({ onDone, compact }) {
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
  const cls = `cyber-btn flex items-center gap-1.5 px-3 py-2 rounded text-xs ${state === "running" ? "pulse-glow" : ""}`;

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
