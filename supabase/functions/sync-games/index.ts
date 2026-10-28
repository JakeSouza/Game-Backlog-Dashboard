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
//
// ENRICHMENT STRATEGY (Steam = source of truth):
//   1. For any game with a steam_appid, call Steam appdetails first.
//      Steam provides: name, cover (header_image), release_date,
//      genres, short_description, metacritic score.
//   2. RAWG fills in anything Steam doesn't have well: community
//      rating, platform list, and cover for non-Steam games.
//   3. For Backloggd-only / non-Steam games, RAWG is the sole enricher.
//   4. RAWG search now requests 5 results and picks the best title match
//      instead of blindly taking the first result.
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
// Tries multiple approaches since Steam's wishlist APIs are finicky:
//   1. IWishlistService/GetWishlist WITHOUT key (public endpoint, steamid only)
//   2. IWishlistService/GetWishlist WITH key
//   3. HTML scraping of the store wishlist page (extracts appids from script tags)
// Then resolves titles via IStoreBrowseService/GetItems (batch) with appdetails fallback.
async function steamWishlist(): Promise<{ items: { appid: number; title: string }[]; status: string; error: string }> {
  const steamId = Deno.env.get("STEAM_ID")!;
  const key = Deno.env.get("STEAM_API_KEY")!;
  let appids: number[] = [];
  let method = "";

  // --- Get the raw appids via multiple strategies ---

  // Strategy 1: IWishlistService/GetWishlist WITHOUT a key
  // The xPaw docs and working gist examples show this works with just steamid.
  // Passing a non-publisher key may cause Steam to return an empty response.
  try {
    const u = new URL("https://api.steampowered.com/IWishlistService/GetWishlist/v1/");
    u.searchParams.set("steamid", steamId);
    const r = await fetch(u);
    console.log(`[wishlist] Strategy 1 (no key): HTTP ${r.status}`);
    if (r.ok) {
      const json = await r.json();
      const items = json?.response?.wishlist || [];
      console.log(`[wishlist] Strategy 1 items: ${items.length}`);
      if (items.length) {
        appids = items.map((i: any) => i.appid).filter(Boolean);
        method = "api-no-key";
      }
    }
  } catch (e) { console.log(`[wishlist] Strategy 1 error: ${e}`); }

  // Strategy 2: IWishlistService/GetWishlist WITH key
  if (!appids.length) {
    try {
      const u = new URL("https://api.steampowered.com/IWishlistService/GetWishlist/v1/");
      u.searchParams.set("key", key);
      u.searchParams.set("steamid", steamId);
      const r = await fetch(u);
      console.log(`[wishlist] Strategy 2 (with key): HTTP ${r.status}`);
      if (r.ok) {
        const json = await r.json();
        const items = json?.response?.wishlist || [];
        console.log(`[wishlist] Strategy 2 items: ${items.length}`);
        if (items.length) {
          appids = items.map((i: any) => i.appid).filter(Boolean);
          method = "api-with-key";
        }
      } else {
        console.log(`[wishlist] Strategy 2 body: ${(await r.text().catch(() => "")).slice(0, 300)}`);
      }
    } catch (e) { console.log(`[wishlist] Strategy 2 error: ${e}`); }
  }

  // Strategy 3: HTML scraping of the store wishlist page
  // The page embeds appids in data attributes and script tags.
  if (!appids.length) {
    try {
      const r = await fetch(
        `https://store.steampowered.com/wishlist/profiles/${steamId}/`,
        { headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Cookie": "birthtime=315532800; mature_content=1",
        } },
      );
      console.log(`[wishlist] Strategy 3 (HTML scrape): HTTP ${r.status}`);
      if (r.ok) {
        const html = await r.text();
        // Pattern 1: data-appid="12345"
        const matches1 = [...html.matchAll(/data-appid="(\d+)"/g)];
        // Pattern 2: "appid":12345 in embedded JSON
        const matches2 = [...html.matchAll(/"appid":(\d+)/g)];
        const found = matches1.length >= matches2.length ? matches1 : matches2;
        console.log(`[wishlist] Strategy 3 matches: ${found.length}`);
        if (found.length) {
          appids = found.map((m) => Number(m[1]));
          method = "html-scrape";
        }
      }
    } catch (e) { console.log(`[wishlist] Strategy 3 error: ${e}`); }
  }

  if (!appids.length) {
    return {
      items: [],
      status: "empty",
      error: "All 3 wishlist strategies returned 0 items. Ensure Steam profile > Privacy > 'Game details' is Public, wait 2 min, retry.",
    };
  }

  console.log(`[wishlist] Got ${appids.length} appids via ${method}, resolving titles...`);

  // --- Resolve appids to titles ---
  // Primary: IStoreBrowseService/GetItems (batch, up to 50 in one call)
  // Fallback: store/appdetails (one at a time, 200ms delay)
  const out: { appid: number; title: string }[] = [];
  const capped = appids.slice(0, 50);

  try {
    const u = new URL("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/");
    u.searchParams.set("key", key);
    const r = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        input_json: JSON.stringify({
          ids: capped.map((a) => ({ appid: a })),
          context: { language: "english", country_code: "US" },
          data_request: { include_app_basic_info: true },
        }),
      }),
    });
    console.log(`[wishlist] GetItems: HTTP ${r.status}`);
    if (r.ok) {
      const json = await r.json();
      const storeItems = json?.response?.store_items || [];
      for (const si of storeItems) {
        if (si?.appid && si?.name) {
          out.push({ appid: si.appid, title: si.name });
        }
      }
      // Fill any missing titles with appdetails fallback
      const resolved = new Set(out.map((o) => o.appid));
      for (const appid of capped) {
        if (!resolved.has(appid)) {
          try {
            await sleep(200);
            const ar = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
            if (ar.ok) {
              const ad = (await ar.json())[String(appid)];
              if (ad?.success && ad?.data?.name) {
                out.push({ appid, title: ad.data.name });
              } else {
                out.push({ appid, title: `Steam App ${appid}` });
              }
            } else {
              out.push({ appid, title: `Steam App ${appid}` });
            }
          } catch {
            out.push({ appid, title: `Steam App ${appid}` });
          }
        }
      }
      return { items: out, status: method + "+GetItems", error: "" };
    }
  } catch (e) {
    console.log(`[wishlist] GetItems error: ${e}`);
  }

  // Fallback: appdetails one-by-one
  for (const appid of capped) {
    let title = `Steam App ${appid}`;
    try {
      await sleep(200);
      const ar = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
      if (ar.ok) {
        const ad = (await ar.json())[String(appid)];
        if (ad?.success && ad?.data?.name) title = ad.data.name;
      }
    } catch { /* keep placeholder */ }
    out.push({ appid, title });
  }
  return { items: out, status: method + "+appdetails", error: "" };
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

// ---------------------------------------------------------------- Steam appdetails
// Fetches the full Store page data for a single appid.
// Returns the fields we care about, or null on failure.
// Used as primary enrichment source for Steam games.
// Rate-limit: Steam allows ~200 req/5min; we sleep 300ms between calls.
async function steamAppDetails(appid: number): Promise<{
  cover_url: string | null;
  released: string | null;
  genres: string[];
  description: string | null;
  metacritic: number | null;
} | null> {
  try {
    const r = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
    );
    if (!r.ok) return null;
    const data = (await r.json())[String(appid)];
    if (!data?.success || !data?.data) return null;
    const d = data.data;
    // Steam's header image is always landscape (460×215) but is present for
    // virtually every app. library_600x900.jpg is portrait and better for
    // cards but only exists for newer/popular titles — the frontend already
    // tries that first via GameImg, so we store header_image as cover_url here
    // and let the UI use library_600x900 when available.
    const cover_url = d.header_image || null;
    // released: Steam gives { coming_soon, date } — "date" is a string like
    // "18 Sep, 2015" or "Q4 2025". Parse to ISO when it looks like a real date.
    let released: string | null = null;
    if (d.release_date?.date && !d.release_date?.coming_soon) {
      const parsed = new Date(d.release_date.date);
      if (!isNaN(parsed.getTime())) {
        released = parsed.toISOString().slice(0, 10);
      }
    }
    const genres = (d.genres || []).map((g: any) => g.description as string);
    const description = (d.short_description as string) || null;
    const metacritic = d.metacritic?.score ?? null;
    return { cover_url, released, genres, description, metacritic };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ RAWG
// Searches RAWG for a game by title.
// Requests 5 results and picks the best title match rather than blindly
// taking the first. Falls back to the first result if no title closely
// matches (so behaviour is no worse than before for unusual names).
const normTitle = (s = "") =>
  s.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function titleScore(query: string, candidate: string): number {
  const q = normTitle(query);
  const c = normTitle(candidate);
  if (q === c) return 3;                          // exact match
  if (c.startsWith(q) || q.startsWith(c)) return 2; // prefix match
  if (c.includes(q) || q.includes(c)) return 1;  // substring match
  return 0;
}

async function rawgSearch(title: string) {
  const u = new URL("https://api.rawg.io/api/games");
  u.searchParams.set("key", Deno.env.get("RAWG_API_KEY")!);
  u.searchParams.set("search", title);
  u.searchParams.set("page_size", "5"); // fetch a few so we can pick the best match
  const r = await fetch(u);
  if (!r.ok) return null;
  const results: any[] = (await r.json()).results || [];
  if (!results.length) return null;

  // Pick the result whose title best matches the query; break ties by index
  // (RAWG already orders by relevance, so lower index wins on equal score).
  let best = results[0];
  let bestScore = titleScore(title, best.name);
  for (let i = 1; i < results.length; i++) {
    const s = titleScore(title, results[i].name);
    if (s > bestScore) { best = results[i]; bestScore = s; }
  }

  return {
    rawg_id: best.id,
    cover_url: best.background_image || null,
    rawg_rating: best.rating ?? null,
    released: best.released || null,
    genres: (best.genres || []).map((x: any) => x.name),
    platforms: (best.platforms || []).map((x: any) => x.platform.name),
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
      // `title` is required below: the backloggd-only pass dedupes against
      // these rows by normalized title, so it must be selected here.
      const r = await fetch(REST(`games?steam_appid=in.(${batch})&select=id,steam_appid,rawg_id,cover_url,title`), { headers: h() });
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

      // Enrich games that don't yet have a rawg_id OR are missing a cover.
      // Steam is tried first (cheaper, no quota, better art); RAWG fills gaps.
      if ((!k?.rawg_id || !k?.cover_url) && enrichBudget > 0) {
        enrichBudget--;
        await sleep(300);

        // --- Step 1: Steam appdetails (primary) ---
        const steamMeta = await steamAppDetails(s.appid);

        // --- Step 2: RAWG (fills rawg_id, rawg_rating, platforms; better
        //     cover for non-Steam-CDN games, not used if Steam already has one)
        let rawgMeta: Awaited<ReturnType<typeof rawgSearch>> = null;
        if (!k?.rawg_id) {
          await sleep(250);
          rawgMeta = await rawgSearch(s.name);
        }

        // Merge: Steam wins on cover, release date, genres, description.
        // RAWG wins on rawg_id, rawg_rating, platforms.
        // If Steam has no cover we fall back to RAWG's background_image.
        const patch: Record<string, unknown> = { updated_at: now() };
        if (steamMeta) {
          if (steamMeta.cover_url) patch.cover_url = steamMeta.cover_url;
          if (steamMeta.released) patch.released = steamMeta.released;
          if (steamMeta.genres?.length) patch.genres = steamMeta.genres;
          if (steamMeta.description) patch.description = steamMeta.description;
          if (steamMeta.metacritic != null) patch.metacritic = steamMeta.metacritic;
        }
        if (rawgMeta) {
          patch.rawg_id = rawgMeta.rawg_id;
          if (rawgMeta.rawg_rating != null) patch.rawg_rating = rawgMeta.rawg_rating;
          if (rawgMeta.platforms?.length) patch.platforms = rawgMeta.platforms;
          // Only use RAWG cover if Steam didn't provide one
          if (!patch.cover_url && rawgMeta.cover_url) patch.cover_url = rawgMeta.cover_url;
          // Only use RAWG release date/genres as fallback
          if (!patch.released && rawgMeta.released) patch.released = rawgMeta.released;
          if (!(patch.genres as string[])?.length && rawgMeta.genres?.length) patch.genres = rawgMeta.genres;
        }

        if (Object.keys(patch).length > 1) { // more than just updated_at
          await fetch(REST(`games?id=eq.${id}`), {
            method: "PATCH", headers: h({ Prefer: "return=minimal" }),
            body: JSON.stringify(patch),
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

    // Backloggd-only games (not in Steam library): use RAWG as the sole
    // enricher since we have no steam_appid to look up.
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
        // Enrich backloggd-only game via RAWG (no Steam appid to use)
        if (enrichBudget > 0) {
          enrichBudget--;
          await sleep(250);
          const rawgMeta = await rawgSearch(r.title);
          if (rawgMeta) {
            await fetch(REST(`games?id=eq.${gid}`), {
              method: "PATCH", headers: h({ Prefer: "return=minimal" }),
              body: JSON.stringify({ ...rawgMeta, updated_at: now() }),
            });
          }
        }
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
        // Single upsert-by-steam_appid creates the games row if it's missing
        // and returns the id either way — one HTTP call instead of the old
        // select-then-insert pair (halves the requests for a big wishlist).
        const cr = await fetch(REST("games?on_conflict=steam_appid"), {
          method: "POST", headers: h(UPSERT),
          body: JSON.stringify({ steam_appid: w.appid, title: w.title, updated_at: now() }),
        });
        const gid = cr.ok ? (await cr.json())[0]?.id : undefined;
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

