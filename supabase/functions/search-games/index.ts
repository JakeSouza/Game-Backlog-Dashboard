// ============================================================
// supabase/functions/search-games/index.ts  (Deno / Edge Function)
// Proxies RAWG's game search server-side. RAWG's API does not send
// CORS headers permitting direct browser calls, so this exists purely
// to sidestep that — it's a thin passthrough, not a data transform.
// Reuses the same RAWG_API_KEY secret sync-games already uses.
//
//   POST /functions/v1/search-games   body: { q: "search text" }
//
// Deploy:
//   supabase functions deploy search-games --no-verify-jwt
// ============================================================

const RAWG_KEY = Deno.env.get("RAWG_API_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    if (!RAWG_KEY) throw new Error("Missing env RAWG_API_KEY");
    const { q } = await req.json().catch(() => ({ q: "" }));
    if (!q || String(q).trim().length < 2) return json({ results: [] });

    const url = `https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(q)}&page_size=8`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return json({ error: `RAWG returned ${r.status}: ${body.slice(0, 200)}` }, 502);
    }
    const j = await r.json();
    return json({ results: j.results || [] });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});