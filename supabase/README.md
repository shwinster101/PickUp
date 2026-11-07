# The shared backend (Supabase Postgres)

This folder is the whole backend: six SQL migrations and a seed. There is no server code to
deploy. The frontend talks to the database through PostgREST and the RPC functions the
migrations create; every rule lives in SQL under `auth.uid()` and row-level security
(`docs/MIGRATION.md` §3–5). The same files run against a plain PostgreSQL in
`test/backend/run.sh`, which is how they are tested here.

| File | Step | What it creates |
|---|---|---|
| `migrations/0001_courts_and_reports.sql` | M1 | `courts`, `court_reports`, the `courts_live` view, `submit_report()` with the 15-minute rate limit |
| `migrations/0002_identity_and_pickups.sql` | M2 | `profiles`, `pickups`, `pickup_attendees`, `notifications`, `event_log`; `upsert_profile`, `create_pickup`, `join_pickup`, `leave_pickup`, `cancel_pickup`, invitations, `start_due_pickups`, `mark_notifications_read`; views `open_pickups`, `my_pickups`, `my_notifications`; `pickup_by_token`, `pickup_roster` |
| `migrations/0003_friends_results_mvp.sql` | M3 | `friendships` and its functions, `search_players`, `pickup_teams`, `record_result`, `mvp_votes`, `vote_mvp`, `finalize_due_mvp_votes`, `expire_stale_pickups`, the `player_standing` view |
| `migrations/0004_schedules.sql` | — | the three `pg_cron` jobs (prints a notice where pg_cron is absent) |
| `migrations/0005_realtime.sql` | M4 | adds `pickups`, `pickup_attendees` and `notifications` to the `supabase_realtime` publication where it exists (reports stay polled: author-only RLS) |
| `migrations/0006_limits_standing_usage.sql` | v1.4.0 | per-player limits (reports, pickups, friend requests; invitations to friends only), deletable players, standing that resists farming, `anon` off `player_standing`, the owner-only `metrics` schema (`usage_weekly`, `phase5_gate`, `exclusions`) |
| `seed.sql` | — | the 20 curated courts, generated from `assets/data/courts.json` by `scripts/export-courts-seed.mjs` |

## One command

`scripts/provision-supabase.sh` does steps 1–6 of the checklist below through the Supabase
Management API (bash + curl + python3, nothing else). It is idempotent: a project named `pickup`
is reused, migrations the project's history already records are skipped, the seed is an upsert.

```bash
export SUPABASE_ACCESS_TOKEN=…          # Dashboard → Account → Access Tokens; environment only, never a file
scripts/provision-supabase.sh --dry-run # the plan and the exact calls; reads only
scripts/provision-supabase.sh           # org → project → wait → auth → pg_cron → migrations + seed → anon key → verify → config.js
scripts/provision-supabase.sh --check   # project healthy · config.js holds the project's key · courts_live = 20 · anonymous sign-ins on
```

- **Printed once, kept nowhere:** the generated database password (store it). **Never printed or
  stored:** the token, the service-role key, any secret key. Only the anon/publishable key reaches
  `assets/js/config.js`; `GOOGLE_MAP_ID` and `METRO` there are preserved.
- **Knobs** (`--help` lists them all): `SUPABASE_ORG_SLUG` (only when the account has several),
  `SUPABASE_PROJECT_NAME`, `SUPABASE_REGION` (default `us-west-1`, validated against the regions
  the organisation may use), `SUPABASE_DB_PASSWORD`, `SUPABASE_KEY_KIND=publishable` (default:
  the legacy `anon` JWT, which the pinned supabase-js 2.45.4 was built against), `CONFIG_OUT`.
- **A run stopped partway** (as the first real run did on 2026-10-18, at pg_cron)? Just re-run: the
  project is reused, recorded migrations are skipped, and the pg_cron step is now best-effort. If it
  reports pg_cron "NOT usable", 0004 lands with a notice instead of the jobs; enable pg_cron in the
  dashboard (Database → Extensions) and run `scripts/provision-supabase.sh --schedule` once.
- **Schema already applied by hand** (steps 4–5 below)? The history is empty, so the script stops
  before re-running `0001`; `SUPABASE_ASSUME_APPLIED=1` records the migration files as applied without
  running them.
- **Tested against a mock of the API, not a project:** `bash test/provision/run.sh` (41 assertions:
  order, idempotency, key hygiene, `--check`, `--dry-run`, the failure path). No run against
  supabase.com has happened from this repository; the first real run is the owner's, and step 7
  below (two browsers, one report) remains the proof.

## Provisioning (one time, ~15 minutes)

1. **Create a Supabase project** (free tier is fine; note NFR-06 — free projects pause after a
   week idle, so plan a weekly read or the paid tier before real users arrive). Region: a US-West
   one for LA.
2. **Enable anonymous sign-ins**: Authentication → Providers → Anonymous sign-ins → on. (Court
   reports and lightweight player identities depend on it; FOUNDATION FR-60.) Keep email
   (magic link) enabled for the later account upgrade (FR-61).
3. **Enable `pg_cron`**: Database → Extensions → search `pg_cron` → enable (schema `pg_catalog`
   or `cron`, either is fine).
4. **Run the migrations in order** in the SQL editor (paste each file whole), or with the CLI:
   `supabase link --project-ref <ref>` then `supabase db push`. Expected: no errors; 0004 prints
   "pg_cron jobs scheduled"; 0005 prints one "added to supabase_realtime" notice per table.
5. **Run `seed.sql`**. Expected: 20 rows in `courts`; `select count(*) from courts_live` → 20.
6. **Put the URL and anon key into `assets/js/config.js`** (Project Settings → API). The anon key
   is a public, publishable credential; the service-role key must never leave the dashboard.
7. **Open the page**: the sidebar reads "Shared data"; a report on one browser shows on another
   within 5 minutes (or on reload); "Pickups here" appears on each public court.

## After v1.4.0: apply 0006, then the measure, the bot check and deletions (owner)

1. **Apply `0006`** to the live project: re-run `scripts/provision-supabase.sh` (recorded migrations
   are skipped, so only `0006` runs), or paste the file whole into the SQL editor. The page works before
   and after it; nothing on the page waits for it.
2. **Leave yourself out of the measure:** in the SQL editor,
   `insert into metrics.exclusions (player_id, reason) select id, 'owner' from public.profiles where username = '<your username>';`
   (repeat for any device you tested on). Players of the two-browser proof are left out on their own
   (their pickup's note starts `two-browsers `).
3. **Read real use, weekly:** `select * from metrics.usage_weekly;` (Los Angeles weeks, newest first;
   `real_games` is the number: pickups that started that week, not cancelled, with 2 or more players who
   are not you or a test) and `select * from metrics.phase5_gate;` (met when each of the last 4 complete
   weeks had a real game: FOUNDATION §8). Sock puppets would count too; read it as an upper bound.
4. **Turn on the bot check when you want it** (optional; the limits work without it). In this order:
   a. Cloudflare dashboard → Turnstile → add a site for `shwinster101.github.io` (widget mode *Managed*
      or *Invisible*); copy the site key and the secret.
   b. Put the **site key** (public) in `assets/js/config.js` as `CAPTCHA_SITE_KEY` and deploy it.
   c. Supabase → Authentication → Attack Protection (Bot and Abuse Protection) → enable CAPTCHA,
      provider Turnstile, paste the **secret** there (never in this repository).
   The other order (c before b) refuses every sign-in until the page sends tokens.
5. **Deleting a player now works** (Authentication → Users → delete): their finished games stay in
   everyone else's record with an empty organiser; their open pickups are cancelled and the players told.

## Keeping it honest

- Never grant `anon`/`authenticated` anything beyond what the migrations grant; if you add a
  table, enable RLS before anything else (Supabase's default privileges make a new table readable
  and writable otherwise).
- Add columns and functions with a new numbered migration; never edit a migration that has run.
- After any change, run `sh scripts/check.sh --backend` locally: it applies every migration to a
  throwaway PostgreSQL and runs the 2021 flows and the cross-user refusal matrix
  (`test/backend/t_*.sql`).
- Secrets: nothing in this folder is secret. `config.js` holds public values only.

## Upgrading an anonymous visitor to an account (M2, FR-61)

`Backend.linkEmail(email)` calls `auth.updateUser({ email })` on the anonymous session: the user
id does not change, so reports, profile and pickups follow the player. Supabase sends a
confirmation email; once confirmed the user is no longer anonymous and `profiles.is_anonymous`
is refreshed on the next `upsert_profile`. On the page this is the profile sheet's **Keep this
account** row (tap your name in the header; v1.3.0); **Played before? Sign in** beside it is the
magic link for a returning player, which never creates an account.
