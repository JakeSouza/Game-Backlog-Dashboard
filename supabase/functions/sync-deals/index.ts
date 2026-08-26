// ============================================================
// supabase/functions/sync-deals/index.ts  (Deno / Edge Function)
// Populates price/discount data from IsThereAnyDeal for games
// currently on your WISHLIST only (ratings.status = 'wishlist')
// — no point pricing games you already own.
//
// Two phases:
//   1. Resolve wishlisted games -> itad_id.
//      - If the game has a steam_appid: POST /lookup/id/shop/61/v1
//      - Otherwise (e.g. added via the RAWG search box): fall back to
//        POST /lookup/id/title/v1, matching on title.
//   2. Fetch current price + historical low for all wishlisted games
//      with an itad_id via POST /games/overview/v2, and write it back.
//
//   GET  /functions/v1/sync-deals  -> debug: shows which secrets are set
//   POST /functions/v1/sync-deals  -> run the sync, return a summary
//
// Secrets (in addition to the ones sync-games already uses):
//   supabase secrets set ITAD_API_KEY=...
//
// Deploy:
//   supabase functions deploy sync-deals --no-verify-jwt
// ============================================================

const REST = (path: string) => `${Deno.env.get("SUPABASE_URL")}/rest/v1/${path}`;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ITAD_KEY = Deno.env.get("ITAD_API_KEY")!;
const h = (extra: Record<string, string> = {}) => ({
  apikey: SRK,
  Authorization: `Bearer ${SRK}`,
  "Content-Type": "application/json",
  ...extra,
});
const now = () => new Date().toISOString();

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ------------------------------------------------------------ ITAD lookup
// Resolve Steam appids -> ITAD game IDs (shop 61 = Steam).
async function resolveByAppid(games: { id: string; steam_appid: number }[]) {
  const resolved: { id: string; itad_id: string }[] = [];
  for (const batch of chunk(games, 200)) {
    const shopIds = batch.map((g) => `app/${g.steam_appid}`);
    const r = await fetch(`https://api.isthereanydeal.com/lookup/id/shop/61/v1?key=${ITAD_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shopIds),
    });
    if (!r.ok) { console.log(`[deals] shop lookup HTTP ${r.status}: ${await r.text().catch(() => "")}`); continue; }
    const map = await r.json(); // { "app/220": "018d...", "app/730": null, ... }
    for (const g of batch) {
      const itadId = map[`app/${g.steam_appid}`];
      if (itadId) resolved.push({ id: g.id, itad_id: itadId });
    }
  }
  return resolved;
}

// Fallback for wishlist games with no steam_appid (e.g. added via the RAWG
// search box) — match by exact title instead. Less reliable than appid
// matching (typos/variations won't match), but better than nothing.
async function resolveByTitle(games: { id: string; title: string }[]) {
  const resolved: { id: string; itad_id: string }[] = [];
  for (const batch of chunk(games, 200)) {
    const titles = batch.map((g) => g.title);
    const r = await fetch(`https://api.isthereanydeal.com/lookup/id/title/v1?key=${ITAD_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(titles),
    });
    if (!r.ok) { console.log(`[deals] title lookup HTTP ${r.status}: ${await r.text().catch(() => "")}`); continue; }
    const map = await r.json(); // { "Baldurs Gate 3": "018d...", "Unknown game": null }
    for (const g of batch) {
      const itadId = map[g.title];
      if (itadId) resolved.push({ id: g.id, itad_id: itadId });
    }
  }
  return resolved;
}

// ------------------------------------------------------------- ITAD prices
async function fetchOverview(itadIds: string[]) {
  const out: any[] = [];
  for (const batch of chunk(itadIds, 200)) {
    const r = await fetch(`https://api.isthereanydeal.com/games/overview/v2?key=${ITAD_KEY}&country=US`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!r.ok) { console.log(`[deals] overview HTTP ${r.status}: ${await r.text().catch(() => "")}`); continue; }
    const j = await r.json();
    out.push(...(j.prices || []));
  }
  return out;
}

// ------------------------------------------------------------------- main
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET") {
    const check = (k: string) => (Deno.env.get(k) ? `set (${Deno.env.get(k)!.length} chars)` : "MISSING");
    return json({
      debug: true,
      secrets: {
        ITAD_API_KEY: check("ITAD_API_KEY"),
        SUPABASE_URL: check("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: check("SUPABASE_SERVICE_ROLE_KEY"),
      },
    });
  }

  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const t0 = Date.now();
  try {
    if (!ITAD_KEY) throw new Error("Missing env ITAD_API_KEY");

    // Phase 1: resolve itad_id for wishlisted games that don't have one yet.
    // ratings!inner(...) restricts the join to games that actually have a
    // wishlist rating row — this is what scopes the whole sync to Wishlist.
    const needsLookup = await fetch(
      REST("games?select=id,title,steam_appid,ratings!inner(status)&ratings.status=eq.wishlist&itad_id=is.null"),
      { headers: h() },
    ).then((r) => r.json());

    const withAppid = (needsLookup || []).filter((g: any) => g.steam_appid != null);
    const withoutAppid = (needsLookup || []).filter((g: any) => g.steam_appid == null);

    const resolved = [
      ...(withAppid.length ? await resolveByAppid(withAppid) : []),
      ...(withoutAppid.length ? await resolveByTitle(withoutAppid) : []),
    ];
    let idsResolved = 0;
    for (const g of resolved) {
      await fetch(REST(`games?id=eq.${g.id}`), {
        method: "PATCH", headers: h({ Prefer: "return=minimal" }),
        body: JSON.stringify({ itad_id: g.itad_id, updated_at: now() }),
      });
      idsResolved++;
    }

    // Phase 2: fetch current price + historical low for wishlisted games
    // that now have an itad_id.
    const withItad = await fetch(
      REST("games?select=id,itad_id,ratings!inner(status)&ratings.status=eq.wishlist&itad_id=not.is.null"),
      { headers: h() },
    ).then((r) => r.json());

    let pricesUpdated = 0;
    if (withItad.length) {
      const idToGame = new Map(withItad.map((g: any) => [g.itad_id, g.id]));
      const overview = await fetchOverview(withItad.map((g: any) => g.itad_id));
      for (const entry of overview) {
        const gameId = idToGame.get(entry.id);
        if (!gameId || !entry.current) continue;
        await fetch(REST(`games?id=eq.${gameId}`), {
          method: "PATCH", headers: h({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            deal_price: entry.current.price?.amount ?? null,
            deal_regular: entry.current.regular?.amount ?? null,
            deal_cut: entry.current.cut ?? 0,
            deal_shop: entry.current.shop?.name ?? null,
            deal_url: entry.current.url ?? null,
            deal_historical_low: entry.lowest?.price?.amount ?? null,
            deal_updated_at: now(),
          }),
        });
        pricesUpdated++;
      }
    }

    return json({
      ok: true,
      ms: Date.now() - t0,
      idsResolved,
      pricesUpdated,
      totalWishlistTracked: withItad.length,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message || e) }, 500);
  }
});