// ============================================================
// src/lib/supabaseClient.js — single shared Supabase client.
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// ============================================================
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
