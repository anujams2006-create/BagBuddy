import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function environment() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('BagBuddy is missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
  return { url, key };
}

// Session storage restores a session on refresh without placing credentials in localStorage.
export function supabase(): SupabaseClient {
  if (!client) {
    const { url, key } = environment();
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.sessionStorage,
      },
    });
  }
  return client;
}

export function supabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
}
