// Stacking Recipe editor — client config (v10.1324, 2026-07-22)
//
// COPY THIS WHOLE FILE to `config.js` in the same directory. Then
// replace the two placeholder strings below with real values, and
// commit config.js. config.js is loaded by index.html at boot.
//
// Both values are safe to commit (anon key is public by design per
// Supabase; SUPABASE_URL is the project endpoint). Neither of these
// alone gates anything — the security layer is the `device_secret`
// verified by every SECURITY DEFINER RPC.
//
// To get SUPABASE_ANON_KEY:
//   Supabase dashboard → Project Settings → API → "Project API keys"
//   → copy the value labeled "anon public" (NOT service_role).
//   Verify: it starts with `eyJ` AND its label says "anon".
//
// To get SUPABASE_URL:
//   Same page, top of it: "Project URL". Format:
//   https://<projectRef>.supabase.co
//
// Rotation: overwrite these values, commit, redeploy.

window.STACKING_CONFIG = {
  supabase_url: 'REPLACE_WITH_SUPABASE_URL',
  anon_key:     'REPLACE_WITH_SUPABASE_ANON_PUBLIC_KEY',
};
