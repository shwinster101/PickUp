/* ============================================================
   OPENCOURT — runtime configuration (client-side values only)
   ============================================================
   The Supabase anon key is a public, publishable credential: row-level
   security in the database is the boundary (docs/MIGRATION.md §3).
   Service-role keys never belong here or anywhere in this repository.

   Empty SUPABASE values mean "no backend": the page serves
   assets/data/courts.json, keeps reports on this device, says so in the
   sidebar, and hides the pickups features.

   Written by scripts/provision-supabase.sh; GOOGLE_MAP_ID, METRO and CAPTCHA_SITE_KEY are kept across runs.
   ============================================================ */
window.OPENCOURT_CONFIG = {
  SUPABASE_URL: 'https://sthveiqfuuyfyojrhhmu.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0aHZlaXFmdXV5ZnlvanJoaG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzQ5OTQsImV4cCI6MjEwNzkxMDk5NH0.uVJXSpvLY4jZivLMxQoJNYe2UxFMi0MR4UYvyykXN3Q',   // the project's anon / publishable key
  GOOGLE_MAP_ID: '',       // optional: a Map ID enables Advanced Markers (Google then ignores the JSON map style)
  METRO: 'LA',
  CAPTCHA_SITE_KEY: ''     // optional: a Cloudflare Turnstile site key; set it before enabling CAPTCHA in Supabase (supabase/README.md)
};
