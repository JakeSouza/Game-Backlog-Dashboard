// RateModal — full rating UI in a modal overlay.
// Supports precision toggle (¼ star / ½ star) for fine-grained ratings.
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { STATUSES, fmtScore } from "../lib/format";
import GameImg from "./GameImg";
import StarRating from "./StarRating";

export default function RateModal({ game, currentRating, currentPlaytime, onClose, onSaved }) {
  const [score, setScore] = useState(currentRating?.score || 0);
  const [status, setStatus] = useState(currentRating?.status || "");
  const [precision, setPrecision] = useState(0.25); // default quarter-star
  const [hours, setHours] = useState(currentPlaytime != null ? String(+(currentPlaytime / 60).toFixed(1)) : "");
  const [favoriteRank, setFavoriteRank] = useState(currentRating?.favorite_rank || null);
  const [steamId, setSteamId] = useState(game.steam_appid ? String(game.steam_appid) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);

    // Steam ID correction — only writes if it actually changed, so this
    // never accidentally clears a value sync-games already set correctly.
    const newSteamId = steamId.trim() ? parseInt(steamId.trim(), 10) : null;
    if (newSteamId !== (game.steam_appid || null)) {
      await supabase.from("games")
        .update({ steam_appid: newSteamId, updated_at: new Date().toISOString() })
        .eq("id", game.id);
    }

    // If assigning a favorite rank, clear it from whoever currently holds it
    // first — avoids the unique constraint conflict, and means picking a
    // rank someone else has just bumps them out rather than erroring.
    if (favoriteRank) {
      await supabase.from("ratings")
        .update({ favorite_rank: null })
        .eq("user_id", "me")
        .eq("favorite_rank", favoriteRank)
        .neq("game_id", game.id);
    }
    const { error } = await supabase
      .from("ratings")
      .upsert({
        game_id: game.id,
        user_id: "me",
        score: score || 0,
        status: status || "backlog",
        favorite_rank: favoriteRank || null,
        logged_at: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      }, { onConflict: "game_id,user_id" });

    // Hours field is optional and separate from rating — only touch
    // library_entries if the user actually typed something. Mainly for
    // manually-added (non-Steam) games, but works to correct any game's
    // hours if needed.
    let hoursError = null;
    if (hours.trim() !== "") {
      const h = parseFloat(hours);
      if (Number.isFinite(h) && h >= 0) {
        const { error: hErr } = await supabase
          .from("library_entries")
          .upsert({ game_id: game.id, playtime_forever: Math.round(h * 60) }, { onConflict: "game_id" });
        hoursError = hErr;
      }
    }

    setSaving(false);
    if (!error && !hoursError) {
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

        <div className="mb-5">
          <div className="text-[11px] font-mono-tech mb-2 uppercase tracking-wider" style={{color:'var(--text-muted)'}}>// Hours played</div>
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="e.g. 12.5"
            inputMode="decimal"
            className="cyber-input w-full"
          />
        </div>

        <div className="mb-5">
          <div className="text-[11px] font-mono-tech mb-2 uppercase tracking-wider" style={{color:'var(--text-muted)'}}>// Steam ID</div>
          <input
            value={steamId}
            onChange={(e) => setSteamId(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Fixes wrong/missing cover art"
            inputMode="numeric"
            className="cyber-input w-full"
          />
        </div>

        <div className="mb-5">
          <div className="text-[11px] font-mono-tech mb-2 uppercase tracking-wider" style={{color:'var(--text-muted)'}}>// All-time favorite</div>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setFavoriteRank(favoriteRank === n ? null : n)}
                className="status-tag"
                style={favoriteRank === n
                  ? { borderColor: 'var(--accent-2)', color: 'var(--accent-2)', background: 'var(--accent-2-dim)', opacity: 1, fontSize: '13px', padding: '6px 12px' }
                  : { fontSize: '13px', padding: '6px 12px' }}
              >
                {favoriteRank === n ? `♥ ${n}` : n}
              </button>
            ))}
          </div>
          {favoriteRank && (
            <p className="text-[10px] font-mono-tech mt-1.5" style={{color:'var(--text-muted)'}}>
              Assigning #{favoriteRank} will bump whatever game currently holds that spot.
            </p>
          )}
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
