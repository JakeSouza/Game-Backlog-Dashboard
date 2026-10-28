// GameImg — cascading image source with automatic fallback.
//
// Fallback chain (tried in order, moves to next on error or blank 200):
//   1. Steam library_600x900.jpg  — portrait art, great for cards, not on all titles
//   2. Steam header.jpg           — landscape, present on virtually every Steam app
//   3. cover_url (via wsrv proxy) — RAWG background_image or Steam header stored in DB
//   4. Generic FALLBACK photo
//
// Why this order: portrait art looks best in the card grid; header.jpg is the
// safe Steam fallback before touching the external RAWG CDN; RAWG's
// background_image (stored as cover_url) comes last among real sources.
import { useEffect, useRef, useState } from "react";
import { FALLBACK, proxied } from "../lib/images";

export default function GameImg({ src, steamAppid, alt = "", className, refreshKey = 0 }) {
  // Manual image refresh: refreshKey (a timestamp) is appended to every
  // real-source URL as a cache-busting query param so the browser AND the
  // wsrv.nl proxy actually re-fetch instead of serving the cached image.
  const bust = refreshKey ? `?v=${refreshKey}` : "";
  const stages = [
    steamAppid ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppid}/library_600x900.jpg${bust}` : null,
    steamAppid ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppid}/header.jpg${bust}` : null,
    refreshKey ? `${proxied(src)}&v=${refreshKey}` : proxied(src),
    FALLBACK,
  ].filter(Boolean);
  const [idx, setIdx] = useState(0);

  // When a manual refresh lands, restart the fallback chain from the top —
  // a stage that failed before may work now that the URL has changed.
  const prevKey = useRef(refreshKey);
  useEffect(() => {
    if (prevKey.current !== refreshKey) {
      prevKey.current = refreshKey;
      setIdx(0);
    }
  }, [refreshKey]);

  // Reset to stage 0 when the underlying game changes, so a stage that
  // failed for one game isn't carried over to the next game rendered in
  // the same slot.
  useEffect(() => {
    setIdx(0);
  }, [src, steamAppid]);

  const advance = () => setIdx((i) => Math.min(i + 1, stages.length - 1));
  return (
    <img src={stages[idx]} alt={alt} className={className}
      loading="lazy"
      onError={advance}
      onLoad={(e) => {
        // Some Steam CDN paths serve a "successful" 200 response that's actually
        // a tiny blank placeholder rather than real art — no error fires for that,
        // so treat a suspiciously small image as a failure too.
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalWidth < 40) advance();
      }} />
  );
}
