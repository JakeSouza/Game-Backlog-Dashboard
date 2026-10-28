// MatchBar — the 0–10 genre-affinity score bar used on recommendation cards.
export default function MatchBar({ score, max = 10, label = "MATCH" }) {
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
