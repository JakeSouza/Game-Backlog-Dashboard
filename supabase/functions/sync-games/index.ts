// ============================================================
// supabase/functions/sync-games/index.ts
// Deploy:  supabase functions deploy sync-games --no-verify-jwt
//
// Sources:
//   • Steam  — owned games + playtime  (STEAM_API_KEY, STEAM_ID)
//   • RAWG   — cover/rating/genres/upcoming metadata  (RAWG_API_KEY)
//   • Backloggd — your collection: ratings + status  (BACKLOGGD_USERNAME)
//
// Backloggd has no API and blocks naive bots. We bypass it the same way
// the working unofficial scraper does: a browser User-Agent + Referer
// header on a plain fetch. NO local script, NO paid scraping service.
//
// GET  → debug: shows which secrets are set. Add ?dump=backloggd to
//        receive the raw HTML of backloggd games page 1 (first ~8k chars)
//        so the status selector can be confirmed/finalized.
// POST → full sync (Steam → RAWG enrich → RAWG upcoming → Backloggd).
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

// ---- Backloggd request headers (mimic a real browser) ------------
const BL_USER = (Deno.env.get("BACKLOGGD_USERNAME") || "").trim();
const BL_BASE = "https://www.backloggd.com";
const BL_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BL_BASE + "/",
  "Turbolinks-Referrer": BL_BASE + "/",
};

// ---- tiny HTML helpers (no external deps) -------------------------
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ").trim();
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Parse one backloggd /games page HTML → [{title, score, cover, status}]
// Cards are wrapped in class="rating-hover". Inside each card:
//   title  → class="game-text-centered" (or img alt)
//   rating → div class="stars-top" style="width: X%"  (X/100*5)
//   cover  → img src inside the card
// status is read best-effort from a per-card indicator if present; if the
// status subpath views are reachable we override it later in the sync.
function parseBackloggdPage(html: string) {
  const games: { title: string; score: number | null; cover: string | null }[] = [];
  const cards = html.split('class="rating-hover');
  for (let i = 1; i < cards.length; i++) {
    const chunk = cards[i].split('class="rating-hover')[0].slice(0, 4000);

    let title: string | null = null;
    const tm = chunk.match(/game-text-centered[^>]*>([\s\S]*?)<\//);
    if (tm) title = decode(tm[1]);
    if (!title) {
      const am = chunk.match(/<img[^>]*alt="([^"]+)"/);
      if (am) title = decode(am[1]);
    }
    if (!title) continue;

    let score: number | null = null;
    const sm = chunk.match(/stars-top"[^>]*style="[^"]*width:\s*([0-9.]+)%/);
    if (sm) score = Math.round((parseFloat(sm[1]) / 100) * 5 * 10) / 10;

    let cover: string | null = null;
    const cm = chunk.match(/<img[^>]*src="([^"]+)"/);
    if (cm) cover = cm[1];

    games.push({ title, score, cover });
  }
  return games;
}

// Detect backloggd's "Access Denied" bot-block page
function isBlocked(html: string): boolean {
  return /Access Denied/i.test(html) || /Oh noes/i.test(html) && html.length < 400;
}

async function fetchBackloggdPage(page: number): Promise<string | null> {
  const url = `${BL_BASE}/u/${BL_USER}/games?page=${page}`;
  const r = await fetch(url, { headers: BL_HEADERS });
  if (!r.ok) return null;
  const html = await r.text();
  return isBlocked(html) ? null : html;
}

// ============================================================
// MAIN
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ---- secrets debug (GET) ----
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("dump") === "backloggd") {
      if (!BL_USER) return json({ error: "BACKLOGGD_USERNAME not set" });
      const html = await fetchBackloggdPage(1);
      if (!html) return json({ error: "Backloggd blocked the request (try again / use fallback)" });
      return json({ username: BL_USER, length: html.length, sample: html.slice(0, 8000) });
    }
    const s = (k: string) => {
      const v = Deno.env.get(k);
      return v ? `set (${v.length} chars)` : "MISSING";
    };
    return json({
      debug: true,
      secrets: {
        STEAM_API_KEY: s("STEAM_API_KEY"),
        STEAM_ID: s("STEAM_ID"),
        RAWG_API_KEY: s("RAWG_API_KEY"),
        BACKLOGGD_USERNAME: s("BACKLOGGD_USERNAME"),
        SUPABASE_URL: s("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: s("SUPABASE_SERVICE_ROLE_KEY"),
      },
      hint: "If any show MISSING, run: supabase secrets set <NAME>=<value> then redeploy. Try ?dump=backloggd to see raw HTML.",
    });
  }

  if (req.method !== "POST") return json({ error: "POST required" });

  const t0 = Date.now();
  const SB_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const STEAM_KEY = Deno.env.get("STEAM_API_KEY") || "";
  const STEAM_ID = Deno.env.get("STEAM_ID") || "";
  const RAWG_KEY = Deno.env.get("RAWG_API_KEY") || "";

  const sb = (path: string, init: RequestInit = {}) =>
    fetch(`${SB_URL}${path}`, {
      ...init,
      headers: {
        "apikey": SB_KEY,
        "Authorization": `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        "Prefer": init.method === "PATCH" ? "return=representation" : "return=representation",
        ...(init.headers || {}),
      },
    });

  const summary: Record<string, unknown> = {};

  try {
    // ============================================================
    // 1) STEAM — owned games + playtime
    // ============================================================
    const steamUrl =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}` +
      `&steamid=${STEAM_ID}&include_appinfo=1&include_played_free_games=1&format=json`;
    const steamRes = await fetch(steamUrl);
    if (!steamRes.ok) return json({ ok: false, error: `Steam ${steamRes.status}` }, 500);
    const steamData: any = await steamRes.json();
    const steamGames: any[] = steamData?.response?.games || [];
    summary.steamGames = steamGames.length;

    // upsert games (by steam_appid) + library_entries
    if (steamGames.length) {
      const gameRows = steamGames.map((g) => ({
        steam_appid: g.appid,
        title: g.name,
      }));
      const gUp = await sb("/rest/v1/games?on_conflict=steam_appid", {
        method: "POST",
        body: JSON.stringify(gameRows),
      });
      // fetch the games back so we have ids for library_entries
    }

    // get all games (with ids) for mapping
    const allGamesRes = await sb("/rest/v1/games?select=id,steam_appid,rawg_id,title,cover_url");
    const allGames: any[] = await allGamesRes.json();

    const byAppid = new Map<number, any>();
    allGames.forEach((g) => { if (g.steam_appid) byAppid.set(g.steam_appid, g); });

    const libRows = steamGames.map((g) => {
      const game = byAppid.get(g.appid);
      return {
        game_id: game?.id,
        user_id: "me",
        source: "steam",
        playtime_forever: g.playtime_forever || 0,
        playtime_last2weeks: g.playtime_2weeks || 0,
        last_played: g.last_played ? new Date(g.last_played * 1000).toISOString() : null,
      };
    }).filter((r) => r.game_id);

    if (libRows.length) {
      await sb("/rest/v1/library_entries?on_conflict=game_id,user_id,source", {
        method: "POST",
        body: JSON.stringify(libRows),
      });
    }
    summary.gamesUpserted = allGames.length;

    // ============================================================
    // 2) RAWG — enrich games missing metadata (capped per run)
    // ============================================================
    const needEnrich = allGames.filter((g) => !g.rawg_id && g.steam_appid).slice(0, 8);
    let enriched = 0;
    for (const g of needEnrich) {
      try {
        const sUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(g.title)}&page_size=1`;
        const sRes = await fetch(sUrl);
        if (!sRes.ok) continue;
        const sData: any = await sRes.json();
        const hit = sData?.results?.[0];
        if (!hit) continue;
        await sb(`/rest/v1/games?steam_appid=eq.${g.steam_appid}`, {
          method: "PATCH",
          body: JSON.stringify({
            rawg_id: hit.id,
            cover_url: hit.background_image || null,
            rawg_rating: hit.rating ?? null,
            released: hit.released || null,
            genres: (hit.genres || []).map((x: any) => x.name),
            platforms: (hit.platforms || []).map((x: any) => x.platform?.name).filter(Boolean),
            description: hit.description_raw || null,
            updated_at: new Date().toISOString(),
          }),
        });
        enriched++;
      } catch { /* skip individual failures */ }
    }
    summary.enriched = enriched;
    summary.enrichRemaining = needEnrich.length === 8
      ? "capped — run sync again to finish enrichment" : "complete";

    // ============================================================
    // 3) RAWG — upcoming releases
    // ============================================================
    try {
      const today = new Date().toISOString().slice(0, 10);
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
      const uUrl = `https://api.rawg.io/api/games?key=${RAWG_KEY}&dates=${today},${future}&ordering=-added&page_size=40`;
      const uRes = await fetch(uUrl);
      if (uRes.ok) {
        const uData: any = await uRes.json();
        const rows = (uData?.results || []).map((r: any) => ({
          rawg_id: r.id,
          title: r.name,
          cover_url: r.background_image || null,
          released: r.released,
          genres: (r.genres || []).map((x: any) => x.name),
          platforms: (r.platforms || []).map((x: any) => x.platform?.name).filter(Boolean),
          rawg_rating: r.rating ?? null,
          description: null,
        })).filter((r: any) => r.released);
        if (rows.length) {
          await sb("/rest/v1/upcoming_releases?on_conflict=rawg_id", {
            method: "POST",
            body: JSON.stringify(rows),
          });
        }
        summary.upcoming = rows.length;
      }
    } catch { /* non-fatal */ }

    // ============================================================
    // 4) BACKLOGGD — collection: ratings + status (+ library entries)
    // ============================================================
    let backloggdEntries = 0;
    let backloggdBlocked = false;
    if (BL_USER) {
      try {
        // 4a) try the per-status views (played/playing/backlog/wishlist)
        //     If reachable, they give exact status sets.
        const statusSets: Record<string, Set<string>> = {
          played: new Set(), playing: new Set(), backlog: new Set(), wishlist: new Set(),
        };
        let usedStatusViews = false;
        for (const st of Object.keys(statusSets)) {
          const r = await fetch(`${BL_BASE}/u/${BL_USER}/games/${st}`, { headers: BL_HEADERS });
          const html = r.ok ? await r.text() : "";
          if (html && !isBlocked(html)) {
            usedStatusViews = true;
            parseBackloggdPage(html).forEach((g) => statusSets[st].add(norm(g.title)));
          }
        }

        // 4b) paginate the full games list (title + rating) — the source of truth
        const allBl: { title: string; score: number | null; cover: string | null }[] = [];
        let page = 1;
        let guard = 0;
        while (guard++ < 40) {
          const html = await fetchBackloggdPage(page);
          if (!html) { if (page === 1) backloggdBlocked = true; break; }
          const parsed = parseBackloggdPage(html);
          if (!parsed.length) break;
          // backloggd repeats the last page when out of range; stop on repeat
          const sig = parsed.map((p) => norm(p.title)).join("|");
          const prev = (allBl.slice(-(parsed.length)).map((p) => norm(p.title)).join("|"));
          if (sig === prev && page > 1) { allBl.splice(allBl.length - parsed.length, parsed.length); break; }
          allBl.push(...parsed);
          if (parsed.length < 20) break; // last partial page
          page++;
        }

        // refresh games list (may have new rows after enrich) + build title map
        const freshRes = await sb("/rest/v1/games?select=id,title,steam_appid,rawg_id,cover_url");
        const freshGames: any[] = await freshRes.json();
        const titleMap = new Map<string, any>();
        freshGames.forEach((g) => { if (g.title) titleMap.set(norm(g.title), g); });

        // upsert backloggd games + ratings + ensure a library_entry exists
        const newGameRows: any[] = [];
        const ratingRows: any[] = [];
        const blLibRows: any[] = [];

        for (const g of allBl) {
          let game = titleMap.get(norm(g.title));
          if (!game) {
            // create a new games row for a backloggd-only (non-Steam) game
            const created = await sb("/rest/v1/games", {
              method: "POST",
              body: JSON.stringify({ title: g.title, cover_url: g.cover }),
            });
            const cr: any[] = await created.json();
            game = cr[0];
            if (game) titleMap.set(norm(g.title), game);
          }
          if (!game) continue;
          if (!game.cover_url && g.cover) {
            await sb(`/rest/v1/games?id=eq.${game.id}`, {
              method: "PATCH", body: JSON.stringify({ cover_url: g.cover }),
            });
          }

          // status: exact set if status views worked, else infer from rating
          let status = "";
          if (usedStatusViews) {
            const n = norm(g.title);
            if (statusSets.playing.has(n)) status = "playing";
            else if (statusSets.wishlist.has(n)) status = "wishlist";
            else if (statusSets.backlog.has(n)) status = "backlog";
            else if (statusSets.played.has(n)) status = "played";
          }
          if (!status) status = g.score != null ? "played" : "backlog";

          ratingRows.push({
            game_id: game.id,
            user_id: "me",
            score: g.score ?? 0,
            status,
            logged_at: null,
            updated_at: new Date().toISOString(),
          });

          // ensure a library entry exists so the game shows in the Backlog tab;
          // only add a 'backloggd' entry if no steam entry exists (avoid dupes)
          const hasSteam = freshGames.some((x) => x.id === game.id && x.steam_appid);
          if (!hasSteam) {
            blLibRows.push({
              game_id: game.id, user_id: "me", source: "backloggd",
              playtime_forever: 0, playtime_last2weeks: 0, last_played: null,
            });
          }
          backloggdEntries++;
        }

        if (ratingRows.length) {
          await sb("/rest/v1/ratings?on_conflict=game_id,user_id", {
            method: "POST", body: JSON.stringify(ratingRows),
          });
        }
        // insert backloggd library entries, ignoring duplicates
        if (blLibRows.length) {
          await sb("/rest/v1/library_entries?on_conflict=game_id,user_id,source", {
            method: "POST", body: JSON.stringify(blLibRows),
          });
        }
      } catch (e) {
        summary.backloggdError = String(e);
      }
    }
    summary.backloggdEntries = backloggdEntries;
    summary.backloggdBlocked = backloggdBlocked;

    summary.ok = true;
    summary.ms = Date.now() - t0;
    return json(summary);
  } catch (e) {
    return json({ ok: false, error: String(e), ms: Date.now() - t0 }, 500);
  }
});