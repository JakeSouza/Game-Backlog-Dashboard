// Image-proxy helpers.
//
// RAWG's CDN blocks hotlinking from GitHub Pages. Route all cover images
// through wsrv.nl (a free image proxy) which fetches server-side, resizes,
// and caches — bypassing referrer checks entirely.
export const FALLBACK =
  "https://wsrv.nl/?url=" + encodeURIComponent("https://images.unsplash.com/photo-1542751371-adc38448a05d?w=320&fit=crop") + "&w=420&h=420&fit=cover&q=80";

export function proxied(u) {
  if (!u) return FALLBACK;
  return `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=420&h=300&fit=cover&a=attention&q=80`;
}
