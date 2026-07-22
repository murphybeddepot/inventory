// Stacking Recipe editor — client config (v10.1324, 2026-07-22)
//
// This file is committed to the public inventory repo. Both values
// are public by Supabase's design: the anon key is intended to ship
// in client-side code, and the URL is the project's public endpoint.
// Neither alone gates anything — the security layer is the
// device_secret verified by every SECURITY DEFINER RPC in Supabase.
//
// JWT payload decoded to verify anon role before commit:
//   {"iss":"supabase","ref":"inspzlvyjuatgelotguo","role":"anon",...}
//
// Rotation: overwrite these values, commit, redeploy.

window.STACKING_CONFIG = {
  supabase_url: 'https://inspzlvyjuatgelotguo.supabase.co',
  anon_key:     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imluc3B6bHZ5anVhdGdlbG90Z3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDg0OTcsImV4cCI6MjA5MzkyNDQ5N30.KTV8m6VDbEv9qu_0-mi3-PqkrhLJ5_UnHrf1RFONHZ4',
};
