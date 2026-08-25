// ============================================================
// supabase/functions/sync-games/index.ts  (Deno / Edge Function)
// THE SYNC. Called directly by the site's "Sync now" button (anon key).
// Fetches Steam + RAWG + backloggd and writes straight to Postgres.
//
//   GET  /functions/v1/sync-games  → debug: shows which secrets are set (no values)
//   POST /functions/v1/sync-games  → run the sync, return a summary
//   OPTIONS                        → CORS preflight (browser needs this)
//
// Supabase auto-injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// You only set these function secrets:
//   supabase secrets set STEAM_API_KEY=... STEAM_ID=... RAWG_API_KEY=... BACKLOGGD_USERNAME=...
//
// Deploy:
//   supabase functions deploy sync-games --no-verify-jwt
// ============================================================

const REST = (path: string) => `${Deno.env.get("SUPABASE_URL")}/rest/v1/${path}`;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const h = (extra: Record<string, string> = {}) => ({
  apikey: SRK,
  Authorization: `Bearer ${SRK}`,
  "Content-Type": "application/json",
  ...extra,
});
const UPSERT = { Prefer: "resolution=merge-duplicates,return=representation" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

// --------------------------------------------------------------- CORS
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ----------------------------------------------------------------- Steam
// Returns { items, status, error } so the caller can surface diagnostics.
async function steamWishlist(): Promise<{ items: { appid: number; title: string }[]; status: string; error: string }> {
  const steamId = Deno.env.get("STEAM_ID")!;
  const key = Deno.env.get("STEAM_API_KEY")!;
  const out: { appid: number; title: string }[] = [];

  // Approach 1: legacy wishlistdata (rich JSON in one call)
  // DEPRECATED Nov 2024 — now redirects to store HTML. We still try it
  // in case it comes back or works from certain IPs.
  try {
    const r = await fetch(
      `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=0`,
      { redirect: "manual", headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json,text/html",
        "Accept-Language": "en-US,en;q=0.9",
      } },
    );
    // 200 + JSON body = success; 3xx = redirect (deprecated); anything else = fail
    if (r.ok) {
      const text = await r.text();
      if (text.trim().startsWith("{")) {
        const data = JSON.parse(text);
        for (const [appid, g] of Object.entries(data)) {
          if ((g as any).subs?.length > 0) out.push({ appid: Number(appid), title: (g as any).name });
        }
        if (out.length) return { items: out, status: "wishlistdata", error: "" };
      }
    }
  } catch { /* fall through to approach 2 */ }

  // Approach 2: IWishlistService/GetWishlist (official API, returns appids only)
  // Then call store/appdetails for each title (capped, with delay).
  try {
    const u = new URL("https://api.steampowered.com/IWishlistService/GetWishlist/v1/");
    u.searchParams.set("key", key);
    u.searchParams.set("steamid", steamId);
    const r = await fetch(u);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { items: [], status: "error", error: `IWishlistService HTTP ${r.status}: ${body.slice(0, 200)}` };
    }
    const json = await r.json();
    const items = json?.response?.wishlist || [];
    if (!items.length) {
      return { items: [], status: "empty", error: "IWishlistService returned 0 items (wishlist may be private or empty)" };
    }
    for (const item of items.slice(0, 50)) {
      if (!item.appid) continue;
      let title = `Steam App ${item.appid}`;
      try {
        await sleep(200);
        const ar = await fetch(`https://store.steampowered.com/api/appdetails?appids=${item.appid}&l=english`);
        if (ar.ok) {
          const ad = (await ar.json())[String(item.appid)];
          if (ad?.success && ad?.data?.name) title = ad.data.name;
        }
      } catch { /* keep placeholder title */ }
      out.push({ appid: item.appid, title });
    }
    return { items: out, status: "IWishlistService", error: "" };
  } catch (e) {
    return { items: [], status: "error", error: `steamWishlist exception: ${String(e?.message || e)}` };
  }
}

async function steamLibrary() {
  const u = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
  u.searchParams.set("key", Deno.env.get("STEAM_API_KEY")!);
  u.searchParams.set("steamid", Deno.env.get("STEAM_ID")!);
  u.searchParams.set("include_appinfo", "1");
  u.searchParams.set("include_played_free_games", "1");
  u.searchParams.set("format", "json");
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Steam ${r.status}`);
  return (await r.json()).response.games || [];
}

// ------------------------------------------------------------------ RAWG
async function rawgSearch(title: string) {
  const u = new URL("https://api.rawg.io/api/games");
  u.searchParams.set("key", Deno.env.get("RAWG_API_KEY")!);
  u.searchParams.set("search", title);
  u.searchParams.set("page_size", "1");
  const r = await fetch(u);
  if (!r.ok) return null;
  const g = (await r.json()).results?.[0];
  if (!g) return null;
  return {
    rawg_id: g.id, cover_url: g.background_image || null,
    rawg_rating: g.rating ?? null, released: g.released || null,
    genres: (g.genres || []).map((x: any) => x.name),
    platforms: (g.platforms || []).map((x: any) => x.platform.name),
  };
}

async function rawgUpcoming() {
  const today = new Date().toISOString().slice(0, 10);
  const yr = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const u = new URL("https://api.rawg.io/api/games");
  u.searchParams.set("key", Deno.env.get("RAWG_API_KEY")!);
  u.searchParams.set("dates", `${today},${yr}`);
  u.searchParams.set("ordering", "released");
  u.searchParams.set("page_size", "40");
  const r = await fetch(u);
  if (!r.ok) return [];
  return ((await r.json()).results || []).map((g: any) => ({
    rawg_id: g.id, title: g.name, cover_url: g.background_image || null,
    released: g.released, genres: (g.genres || []).map((x: any) => x.name),
    platforms: (g.platforms || []).map((x: any) => x.platform.name),
    rawg_rating: g.rating ?? null, updated_at: now(),
  }));
}

// ------------------------------------------------------------- backloggd
async function backloggdRatings() {
  const user = Deno.env.get("BACKLOGGD_USERNAME");
  if (!user) return [];
  const paths: Record<string, string> = {
    played: "played", playing: "playing", backlog: "backlog",
    wishlist: "wishlist", dropped: "dropped",
  };
  const out: { title: string; status: string; score: number | null }[] = [];
  for (const [status, p] of Object.entries(paths)) {
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(`https://www.backloggd.com/u/${user}/games/${p}/page/${page}/`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      if (r.status === 404 || !r.ok) break;
      const html = await r.text();
      const cards = [...html.matchAll(/href="\/games\/([^/]+)\/"/g)];
      if (!cards.length) break;
      for (const m of cards) {
        const title = decodeURIComponent(m[1]).replace(/-/g, " ");
        const idx = html.indexOf(m[0]);
        const window = html.slice(idx, idx + 600);
        const stars = (window.match(/bi-star-fill|star-fill|class="[^"]*star[^"]*"/g) || []).length;
        out.push({ title, status, score: stars > 0 ? Math.min(5, Math.max(0.5, stars)) : null });
      }
      if (cards.length < 18) break;
      await sleep(300);
    }
  }
  const map = new Map<string, typeof out[number]>();
  for (const e of out) {
    const k = e.title.toLowerCase();
    const prev = map.get(k);
    if (!prev || (e.score && !prev.score)) map.set(k, e);
  }
  return [...map.values()];
}

// --------------------------------------------------------- title matching
const norm = (s = "") => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
const matchRating = (rs: any[], t: string) =>
  rs.find((r) => norm(r.title) === norm(t)) ||
  rs.find((r) => norm(t).includes(norm(r.title)));

// ------------------------------------------------------------------ main
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // DEBUG: GET returns which secrets are present (values masked).
  if (req.method === "GET") {
    const check = (k: string) => {
      const v = Deno.env.get(k);
      return v ? `set (${v.length} chars)` : "MISSING";
    };
    return json({
      debug: true,
      secrets: {
        STEAM_API_KEY: check("STEAM_API_KEY"),
        STEAM_ID: check("STEAM_ID"),
        RAWG_API_KEY: check("RAWG_API_KEY"),
        BACKLOGGD_USERNAME: check("BACKLOGGD_USERNAME"),
        SUPABASE_URL: check("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: check("SUPABASE_SERVICE_ROLE_KEY"),
      },
      hint: "If any show MISSING, run: supabase secrets set <NAME>=<value> then redeploy.",
    });
  }

  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const t0 = Date.now();
  try {
    const steam = await steamLibrary();
    const bl = await backloggdRatings();

    const appids = steam.map((s: any) => s.appid);
    const existing: any[] = [];
    for (let i = 0; i < appids.length; i += 50) {
      const batch = appids.slice(i, i + 50).join(",");
      const r = await fetch(REST(`games?steam_appid=in.(${batch})&select=id,steam_appid,rawg_id`), { headers: h() });
      if (r.ok) existing.push(...(await r.json()));
    }
    const known = new Map(existing.map((g) => [String(g.steam_appid), g]));

    let gamesUpserted = 0, enriched = 0, ratingsUpserted = 0;
    const ENRICH_CAP = 40;
    let enrichBudget = ENRICH_CAP;

    for (const s of steam) {
      const k = known.get(String(s.appid));
      let id = k?.id;

      if (!id) {
        const r = await fetch(REST("games?on_conflict=steam_appid"), {
          method: "POST", headers: h(UPSERT),
          body: JSON.stringify({ steam_appid: s.appid, title: s.name, updated_at: now() }),
        });
        if (!r.ok) continue;
        id = (await r.json())[0].id;
        gamesUpserted++;
      }

      await fetch(REST("library_entries?on_conflict=game_id,user_id,source"), {
        method: "POST", headers: h(UPSERT),
        body: JSON.stringify({
          game_id: id, user_id: "me", source: "steam",
          playtime_forever: s.playtime_forever || 0,
          playtime_last2weeks: s.playtime_last2weeks || 0,
          last_played: s.rtime_last_played ? new Date(s.rtime_last_played * 1000).toISOString() : null,
          updated_at: now(),
        }),
      });

      if (!k?.rawg_id && enrichBudget > 0) {
        enrichBudget--;
        await sleep(250);
        const meta = await rawgSearch(s.name);
        if (meta) {
          await fetch(REST(`games?id=eq.${id}`), {
            method: "PATCH", headers: h({ Prefer: "return=minimal" }),
            body: JSON.stringify({ ...meta, updated_at: now() }),
          });
          enriched++;
        }
      }

      const rt = matchRating(bl, s.name);
      if (rt) {
        await fetch(REST("ratings?on_conflict=game_id,user_id"), {
          method: "POST", headers: h(UPSERT),
          body: JSON.stringify({ game_id: id, user_id: "me", score: rt.score ?? 0, status: rt.status, updated_at: now() }),
        });
        ratingsUpserted++;
      }
    }

    let blOnly = 0;
    for (const r of bl) {
      const found = existing.find((g) => norm((g as any).title) === norm(r.title)) ||
        steam.find((s: any) => norm(s.name) === norm(r.title));
      if (found) continue;
      const cr = await fetch(REST("games?on_conflict=steam_appid"), {
        method: "POST", headers: h(UPSERT),
        body: JSON.stringify({ title: r.title.replace(/\b\w/g, (c) => c.toUpperCase()), updated_at: now() }),
      });
      if (cr.ok) {
        const gid = (await cr.json())[0].id;
        await fetch(REST("ratings?on_conflict=game_id,user_id"), {
          method: "POST", headers: h(UPSERT),
          body: JSON.stringify({ game_id: gid, user_id: "me", score: r.score ?? 0, status: r.status, updated_at: now() }),
        });
        blOnly++;
      }
    }

    const upcoming = await rawgUpcoming();
    if (upcoming.length) {
      await fetch(REST("upcoming_releases?on_conflict=rawg_id"), {
        method: "POST", headers: h({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(upcoming),
      });
    }

    // ---- Steam Wishlist ----
    let wishlistSynced = 0;
    let wishlistStatus = "skipped";
    let wishlistError = "";
    try {
      const wlResult = await steamWishlist();
      wishlistStatus = wlResult.status;
      wishlistError = wlResult.error;
      for (const w of wlResult.items) {
        // create games row if not exists (by steam_appid)
        let gid: string | undefined;
        const ex = await fetch(REST(`games?steam_appid=eq.${w.appid}&select=id`), { headers: h() });
        if (ex.ok) {
          const rows = await ex.json();
          if (rows.length) gid = rows[0].id;
        }
        if (!gid) {
          const cr = await fetch(REST("games?on_conflict=steam_appid"), {
            method: "POST", headers: h(UPSERT),
            body: JSON.stringify({ steam_appid: w.appid, title: w.title, updated_at: now() }),
          });
          if (cr.ok) gid = (await cr.json())[0]?.id;
        }
        if (gid) {
          await fetch(REST("ratings?on_conflict=game_id,user_id"), {
            method: "POST", headers: h(UPSERT),
            body: JSON.stringify({ game_id: gid, user_id: "me", score: 0, status: "wishlist", updated_at: now() }),
          });
          wishlistSynced++;
        }
      }
    } catch (e) {
      wishlistStatus = "error";
      wishlistError = String(e?.message || e);
    }

    return json({
      ok: true,
      ms: Date.now() - t0,
      steamGames: steam.length,
      gamesUpserted,
      enriched,
      ratingsUpserted,
      wishlistSynced,
      wishlistStatus,
      wishlistError,
      backloggdEntries: bl.length,
      backloggdOnly: blOnly,
      upcoming: upcoming.length,
      enrichRemaining: enrichBudget === 0 ? "capped — run sync again to finish enrichment" : 0,
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});