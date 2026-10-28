// Game-row creation helpers shared by the wishlist/backlog add flows.
import { supabase } from "./supabase";

// Finds an existing games row by rawg_id, or creates one. Shared by
// addToWishlist and addToBacklog so both stay in sync on how a game
// gets created from search results. If game.steam_appid is provided
// (e.g. typed in manually alongside a search result), it's written
// even onto an already-existing row — Steam CDN art and price
// tracking both depend on that column being populated.
// Returns { id, error } — callers must check error, not just id.
export async function upsertGameByRawgId(game) {
  if (game.rawg_id) {
    const { data: existing, error: selErr } = await supabase
      .from("games").select("id,steam_appid").eq("rawg_id", game.rawg_id).limit(1);
    if (selErr) return { id: null, error: selErr.message };
    if (existing?.length) {
      const gameId = existing[0].id;
      if (game.steam_appid && existing[0].steam_appid !== game.steam_appid) {
        const { error: updErr } = await supabase.from("games")
          .update({ steam_appid: game.steam_appid, updated_at: new Date().toISOString() })
          .eq("id", gameId);
        if (updErr) return { id: gameId, error: updErr.message };
      }
      return { id: gameId, error: null };
    }
  }
  const { data, error } = await supabase.from("games").upsert({
    title: game.title,
    rawg_id: game.rawg_id,
    cover_url: game.cover_url,
    released: game.released,
    genres: game.genres,
    platforms: game.platforms,
    rawg_rating: game.rawg_rating,
    steam_appid: game.steam_appid || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "rawg_id" }).select();
  if (error) return { id: null, error: error.message };
  if (!data?.length) return { id: null, error: "Insert returned no row (unknown cause)" };
  return { id: data[0].id, error: null };
}

// Adds a game to the wishlist. Pass { fromUpcoming: true } for upcoming
// releases so we skip the game.id check (it's an upcoming_releases row ID,
// not a games.id). For recommended games, game.game_id or game.id should
// be the real games.id. For upcoming/discovery games, a games row is
// created via rawg_id upsert.
export async function addToWishlist(game, fromUpcoming = false) {
  let gameId = fromUpcoming ? null : (game.game_id || game.id);
  if (!gameId) {
    const res = await upsertGameByRawgId(game);
    if (res.error) return { ok: false, error: res.error };
    gameId = res.id;
  }
  if (!gameId) return { ok: false, error: "Could not resolve a game row." };
  const { error: e2 } = await supabase.from("ratings").upsert({
    game_id: gameId, user_id: "me", score: 0, status: "wishlist",
    updated_at: new Date().toISOString(),
  }, { onConflict: "game_id,user_id" });
  return e2 ? { ok: false, error: e2.message } : { ok: true };
}

// addToBacklog — for games you own on a platform sync doesn't reach
// (Epic, a handheld, physical media, etc). Creates/finds the games row
// same as addToWishlist, then adds a library_entries row so it shows
// up in Backlog exactly like a Steam-synced game does. Accepts an
// optional playtimeMinutes so hours can be logged at add-time instead
// of needing a separate edit afterward.
export async function addToBacklog(game, playtimeMinutes = 0) {
  const res = await upsertGameByRawgId(game);
  if (res.error) return { ok: false, error: res.error };
  if (!res.id) return { ok: false, error: "Could not resolve a game row." };
  const { error } = await supabase.from("library_entries").upsert({
    game_id: res.id, playtime_forever: playtimeMinutes || 0,
  }, { onConflict: "game_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
