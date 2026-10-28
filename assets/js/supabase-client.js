let clientPromise;

export function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch("/api/v1/config/public", {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Account services are currently unavailable.");
      const configuration = await response.json();
      if (!configuration.supabase_configured) return null;

      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.57.0");
      return createClient(configuration.supabase_url, configuration.supabase_anon_key, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true
        }
      });
    })();
  }
  return clientPromise;
}
