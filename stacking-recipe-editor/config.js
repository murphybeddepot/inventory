// Stacking Recipe editor — client config (v10.1324, 2026-07-22)
//
// INTENT: config.template.js is the reference (this file, tracked).
// config.js is the working file the browser actually loads. BOTH
// live in the tracked repo. config.js is NOT gitignored — the anon
// key and SUPABASE_URL are public by Supabase's design, and the
// editor at murphybeddepot.github.io/inventory/stacking-recipe-editor/
// loads config.js at boot via <script src="./config.js">, which only
// works if it's committed to the inventory repo.
//
// To create config.js:
//   1. Copy this whole file to config.js in the same directory.
//   2. Replace the two placeholder strings below with real values.
//   3. git add + commit + push inventory/stacking-recipe-editor/config.js.
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
