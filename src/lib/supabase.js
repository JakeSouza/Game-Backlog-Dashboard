// Shared Supabase client. Importing this module anywhere reuses the same
// client instance (and its connection pool) instead of creating a new one
// per file.
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
