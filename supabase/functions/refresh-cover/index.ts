// ============================================================
// supabase/functions/refresh-cover/index.ts  (Deno / Edge Function)
// Manual per-game cover art refresh. Called by the ↻ button on game
// cards in Backlog/Wishlist (anon key) — no full sync needed.
//
//   POST /functions/v1/refresh-cover   body: { game_id: "..." }
//   OPTIONS                            → CORS preflight
//
// Resolution order (mirrors sync-games enrichment, one game only):
//   1. Known steam_appid → Steam appdetails header_image
//   2. RAWG (by rawg_id, or title search if unknown) → try to
//      discover a Steam appid from the store URL, then Steam again
//   3. RAWG background_image as a last resort
// PATCHes the games row and returns the fresh values so the card can
// repaint immediately.
//
// Deploy:
//   supabase functions deploy refresh-cover --no-verify-jwt
// ============================================================

const REST = (path: string) => `${Deno.env.get("SUPABASE_URL")}/rest/v1/${path}`;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const h = (extra: Record<string, string> = {}) => ({
  apikey: SRK,
  Authorization: `Bearer ${SRK}`,
  "Content-Type": "application/json",
  ...extra,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

// --------------------------------------------------------------- CORS
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ----------------------------------------------------------------- Steam
// Same helper sync-games uses: header_image is present on virtually every
// app. Portrait library_600x900 art is tried first client-side via GameImg,
// so storing header.jpg as cover_url matches the sync's behaviour.
async function steamCover(appid: number): Promise<string | null> {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
    );
    if (!r.ok) return null;
    const data = (await r.json())[String(appid)];
    if (!data?.success || !data?.data) return null;
    return data.data.header_image || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ RAWG
// RAWG game detail: gives background_image plus the store list, from which
// a Steam appid can be recovered for games that are missing one.
async function rawgDetail(id: number): Promise<{ background_image: string | null; appid: number | null } | null> {
  try {
    const u = new URL(`https://api.rawg.io/api/games/${id}`);
    u.searchParams.set("key", Deno.env.get("RAWG_API_KEY")!);
    const r = await fetch(u);
    if (!r.ok) return null;
    const g = await r.json();
    const steamStore = (g.stores || []).find(
      (s: any) => s?.store?.id === 1 || /store\.steampowered\.com/.test(s?.url || ""),
    );
    const m = (steamStore?.url || "").match(/\/app\/(\d+)/);
    return { background_image: g.background_image || null, appid: m ? Number(m[1]) : null };
  } catch {
    return null;
  }
}

// Best-match title search (same scoring as sync-games) — used to find a
// rawg_id for games that never got one (e.g. manual/backloggd-only adds).
const normTitle = (s = "") =>
  s.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function titleScore(query: string, candidate: string): number {
  const q = normTitle(query);
  const c = normTitle(candidate);
  if (q === c) return 3;
  if (c.startsWith(q) || q.startsWith(c)) return 2;
  if (c.includes(q) || q.includes(c)) return 1;
  return 0;
}

async function rawgSearchId(title: string): Promise<number | null> {
  try {
    const u = new URL("https://api.rawg.io/api/games");
    u.searchParams.set("key", Deno.env.get("RAWG_API_KEY")!);
    u.searchParams.set("search", title);
    u.searchParams.set("page_size", "5");
    const r = await fetch(u);
    if (!r.ok) return null;
    const results: any[] = (await r.json()).results || [];
    if (!results.length) return null;
    let best = results[0];
    let bestScore = titleScore(title, best.name);
    for (let i = 1; i < results.length; i++) {
      const s = titleScore(title, results[i].name);
      if (s > bestScore) { best = results[i]; bestScore = s; }
    }
    return best.id ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ main
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "POST required — body: { game_id }" }, 405);
  }

  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const gameId = body?.game_id;
    if (!gameId) return json({ error: "game_id required" }, 400);

    // Load the current game row
    const r = await fetch(
      REST(`games?id=eq.${gameId}&select=id,title,rawg_id,steam_appid`),
      { headers: h() },
    );
    if (!r.ok) return json({ error: `Game lookup failed (${r.status})` }, 500);
    const rows = await r.json();
    const game = rows?.[0];
    if (!game) return json({ error: "Game not found" }, 404);

    const patch: Record<string, unknown> = { updated_at: now() };
    let cover: string | null = null;
    let source = "";

    // --- 1. Steam via known appid ---
    if (game.steam_appid) {
      await sleep(200);
      cover = await steamCover(game.steam_appid);
      if (cover) source = "steam";
    }

    // --- 2. RAWG: discover a Steam appid (and/or a rawg_id) ---
    let rawgId: number | null = game.rawg_id ?? null;
    if (!cover) {
      if (!rawgId) {
        await sleep(250);
        rawgId = await rawgSearchId(game.title);
        if (rawgId) patch.rawg_id = rawgId;
      }
      if (rawgId) {
        await sleep(250);
        const detail = await rawgDetail(rawgId);s
        if (detail?.appid && detail.appid !== game.steam_appid) {
          patch.steam_appid = detail.appid;
          await sleep(200);
          const steamCoverUrl = await steamCover(detail.appid);
          if (steamCoverUrl) { cover = steamCoverUrl; source = "steam"; }
        }
        // --- 3. RAWG background_image as a last resort ---
        if (!cover && detail?.background_image) {
          cover = detail.background_image;
          source = "rawg";
        }
      }
    }

    if (!cover) {
      return json({ ok: false, error: "No cover art found via Steam or RAWG" }, 404);
    }

    patch.cover_url = cover;
    const pr = await fetch(REST(`games?id=eq.${gameId}`), {
      method: "PATCH",
      headers: h({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    if (!pr.ok) return json({ error: `Cover update failed (${pr.status})` }, 500);

    return json({
      ok: true,
      cover_url: cover,
      steam_appid: patch.steam_appid ?? game.steam_appid ?? null,
      rawg_id: patch.rawg_id ?? game.rawg_id ?? null,
      source,
      ms: Date.now() - t0,
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});