// StarRating — 5 stars, quarter-star (0.25) precision by default.
// Overlay technique: gray bg stars + accent fg stars clipped by width.
// Mouse/touch X position snaps to the configured precision.
// Works on desktop (hover preview) and mobile (touch-drag).
import { useCallback, useRef, useState } from "react";

export default function StarRating({ score, onRate, size = 14, precision = 0.25 }) {
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
