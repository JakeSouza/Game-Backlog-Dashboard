// SyncDealsButton — runs the sync-deals edge function (IsThereAnyDeal
// prices). Separate from SyncButton (which runs sync-games) since deal data
// has its own cadence and its own API quota — no need to hit ITAD on every
// library sync.
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function SyncDealsButton() {
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
