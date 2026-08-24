// ============================================================
// sync.mjs  — runs in GitHub Actions (Node 20+, native fetch).
// Pulls data from Steam, RAWG, and backloggd, then upserts into
// Supabase using the SERVICE ROLE key (bypasses RLS).
//
// Secrets (repo Settings > Secrets and variables > Actions):
//   STEAM_API_KEY, STEAM_ID, RAWG_API_KEY,
//   BACKLOGGD_USERNAME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const {
  STEAM_API_KEY, STEAM_ID, RAWG_API_KEY, BACKLOGGD_USERNAME,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const today = new Date().toISOString().slice(0, 10);
const nextYear = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Steam
async function fetchSteamLibrary() {
  const url = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
  url.searchParams.set("key", STEAM_API_KEY);
  url.searchParams.set("steamid", STEAM_ID);
  url.searchParams.set("include_appinfo", "1");
  url.searchParams.set("format", "json");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Steam GetOwnedGames ${r.status}`);
  const j = await r.json();
  return j.response.games || [];
}

// ----------------------------------------------------------------- RAWG
// Search RAWG by game title; returns the best match's enrichment fields.
async function rawgSearch(title) {
  const url = new URL("https://api.rawg.io/api/games");
  url.searchParams.set("key", RAWG_API_KEY);
  url.searchParams.set("search", title);
  url.searchParams.set("page_size", "1");
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const g = j.results?.[0];
  if (!g) return null;
  return {
    rawg_id: g.id,
    cover_url: g.background_image || null,
    rawg_rating: g.rating ?? null,
    released: g.released || null,
    genres: (g.genres || []).map((x) => x.name),
    platforms: (g.platforms || []).map((x) => x.platform.name),
  };
}

async function fetchUpcoming() {
  const url = new URL("https://api.rawg.io/api/games");
  url.searchParams.set("key", RAWG_API_KEY);
  url.searchParams.set("dates", `${today},${nextYear}`);
  url.searchParams.set("ordering", "released");
  url.searchParams.set("page_size", "40");
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || []).map((g) => ({
    rawg_id: g.id,
    title: g.name,
    cover_url: g.background_image || null,
    released: g.released,
    genres: (g.genres || []).map((x) => x.name),
    platforms: (g.platforms || []).map((x) => x.platform.name),
    rawg_rating: g.rating ?? null,
  }));
}

// ------------------------------------------------------------- backloggd
// Best-effort scrape of a user's status lists + star ratings.
// backloggd markup can change; tweak selectors here if it breaks.
const STATUS_PATHS = {
  played:   "played",
  playing:  "playing",
  backlog:  "backlog",
  wishlist: "wishlist",
  dropped:  "dropped",
};
const STATUS_RATING = { played: null, playing: null, backlog: null, wishlist: null, dropped: null };

async function scrapeBackloggd() {
  const out = []; // { title, status, score }
  for (const [status, path] of Object.entries(STATUS_PATHS)) {
    let page = 1;
    while (page <= 10) { // cap pages per status to stay polite
      const url = `https://www.backloggd.com/u/${BACKLOGGD_USERNAME}/games/${path}/page/${page}/`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 backloggd-sync" } });
      if (r.status === 404) break;
      if (!r.ok) break;
      const html = await r.text();
      const $ = cheerio.load(html);
      // each card links to /games/<slug>/ ; rating shown as filled star icons
      const cards = $("a[href^='/games/']").toArray();
      if (cards.length === 0) break;
      for (const a of cards) {
        const $a = $(a);
        const href = $a.attr("href") || "";
        const m = href.match(/^\/games\/([^/]+)\//);
        if (!m) continue;
        const title = decodeURIComponent(m[1]).replace(/-/g, " ");
        // count filled stars within the closest card block
        const card = $a.closest("[class*='card'], .game-row, div");
        const stars = card.find(".bi-star-fill, .star-fill, [class*='star']").length || 0;
        const score = stars > 0 ? Math.min(5, Math.max(0.5, stars)) : null;
        out.push({ title, status, score });
      }
      // stop if fewer than a full page returned
      if (cards.length < 18) break;
      page++;
      await sleep(400);
    }
  }
  // dedupe: prefer a status with a rating
  const map = new Map();
  for (const e of out) {
    const prev = map.get(e.title.toLowerCase());
    if (!prev || (e.score && !prev.score)) map.set(e.title.toLowerCase(), e);
  }
  return [...map.values()];
}

// ------------------------------------------------------------ title match
function norm(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function matchRating(ratings, gameTitle) {
  return ratings.find((r) => norm(r.title) === norm(gameTitle)) ||
         ratings.find((r) => norm(gameTitle).includes(norm(r.title)));
}

// ------------------------------------------------------------------ main
async function main() {
  for (const k of ["STEAM_API_KEY","STEAM_ID","RAWG_API_KEY","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[k]) throw new Error(`Missing env ${k}`);
  }

  console.log("→ Steam library");
  const steam = await fetchSteamLibrary();
  const backloggd = BACKLOGGD_USERNAME ? await scrapeBackloggd() : [];
  console.log(`  ${steam.length} steam games, ${backloggd.length} backloggd entries`);

  const gamesById = [];
  for (const s of steam) {
    // upsert game by steam_appid
    const { data: existing } = await supabase
      .from("games").select("id").eq("steam_appid", s.appid).maybeSingle();
    let gameId = existing?.id;
    if (!gameId) {
      const { data, error } = await supabase.from("games").insert({
        steam_appid: s.appid, title: s.name,
      }).select("id").single();
      if (error) throw new Error(`insert game ${s.name}: ${error.message}`);
      gameId = data.id;
    } else {
      await supabase.from("games").update({ title: s.name, updated_at: now() })
        .eq("id", gameId);
    }

    // library entry
    await supabase.from("library_entries").upsert({
      game_id: gameId, user_id: "me", source: "steam",
      playtime_forever: s.playtime_forever || 0,
      playtime_last2weeks: s.playtime_last_2weeks || 0,
      last_played: s.rtime_last_played ? new Date(s.rtime_last_played * 1000).toISOString() : null,
      updated_at: now(),
    }, { onConflict: "game_id,user_id,source" });

    // RAWG enrichment (rate-limited)
    await sleep(300);
    const meta = await rawgSearch(s.name);
    if (meta) {
      await supabase.from("games").update({
        rawg_id: meta.rawg_id, cover_url: meta.cover_url,
        rawg_rating: meta.rawg_rating, released: meta.released,
        genres: meta.genres, platforms: meta.platforms, updated_at: now(),
      }).eq("id", gameId);

      // backloggd rating match
      const r = matchRating(backloggd, s.name);
      if (r) {
        await supabase.from("ratings").upsert({
          game_id: gameId, user_id: "me",
          score: r.score ?? 0, status: r.status,
          updated_at: now(),
        }, { onConflict: "game_id,user_id" });
      }
    }
    gamesById.push(gameId);
  }
  console.log("→ backloggd-only games (not on Steam) rated/owned");
  for (const r of backloggd) {
    // ensure a game row exists for titles you rated but don't own on Steam
    const { data: g } = await supabase.from("games")
      .select("id").ilike("title", r.title).maybeSingle();
    if (!g) {
      const { data } = await supabase.from("games").insert({
        title: r.title.replace(/\b\w/g, (c) => c.toUpperCase()),
      }).select("id").single();
      if (data) {
        await supabase.from("ratings").upsert({
          game_id: data.id, user_id: "me", score: r.score ?? 0, status: r.status, updated_at: now(),
        }, { onConflict: "game_id,user_id" });
      }
    }
  }

  console.log("→ upcoming releases");
  const upcoming = await fetchUpcoming();
  if (upcoming.length) {
    await supabase.from("upcoming_releases").upsert(upcoming.map((u) => ({ ...u, updated_at: now() })),
      { onConflict: "rawg_id" });
  }
  console.log(`✓ done: ${gamesById.length} games, ${upcoming.length} upcoming`);
}

function now() { return new Date().toISOString(); }

main().catch((e) => { console.error(e); process.exit(1); });