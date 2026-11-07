# CLAUDE.md — OpenCourt (PickUp's successor)

**v1.3.5 — THE AUDIT: PRODUCTION IS LIVE, BUT ITS EMAIL, ITS PAUSE AND ITS SIGNALS HAVE NO OWNER; THE RECORD
CATCHES UP.** Owner (2026-11-07): "Run an Audit on pickup", and mid-pass "Do we still have a domain".
- **Domain:** no purchased domain has ever existed (no `CNAME`; SETUP §c's `opencourt.la` is an example). The
  site is GitHub's free `https://shwinster101.github.io/PickUp/`: the last deploy (run #10, 2026-10-19 23:24 UTC,
  v1.3.4) succeeded and GitHub reported that URL. `opencourt.pages.dev` could not be checked from here.
- **Found, for the owner** (`working/2026-11-07-audit.md`): the account ladder cannot work as configured (no
  custom SMTP anywhere, and Supabase's default mailer delivers only to the project's team; the 2026-10-18 run
  set Site URL and redirects to `/OpenCourt/`, now 404); the Free plan pauses after about a week of low
  activity and nothing watches it; every shared signal is free to fake (throwaway-database probes: 10
  anonymous sessions turned 18 of 18 public courts Full, one session put 50 pickups on a court, a stranger
  notified every profile, three sock puppets farmed 10 wins + 10 MVPs in 31 ms); a user who ever organised a
  pickup cannot be deleted (`pickups_organiser_id_fkey`); no usage is measured, though FOUNDATION §8's one
  usage gate needs it; no CI runs the gate before Pages deploys.
- **Fixed in place:** the pickups section said "not configured" when the backend was configured but
  unreachable; the Maps banner stayed over a map that loaded after 5 s and told visitors to replace a
  placeholder key; `check-offline.cjs` had read production since `a04ce05` (it now routes an empty config);
  the badge (v1.3.1 → v1.3.5), the SRS and FOUNDATION status lines and this file's brief, which still said the
  backend did not exist; NFR-04 to ✅ on the recorded evidence; a caution on running the proof against
  production; a correction in the repo-rename note (a provisioner re-run would not fix `site_url`).
- **Verified here:** gate + backend 182 assertions; offline check 20 pins with no Maps dialog on
  `localhost:8000` (it appeared there on 2026-10-17, so billing looks fixed); fake-backend check (errors are
  this sandbox's blocked hosts only); stand-in smoke 44/44; two-browser proof 8/8 twice (supabase-js served from
  the npm tarball, jsDelivr is blocked here); provisioner mock 40/40; both page patches in a browser.
  **Not verified:** production itself (`github.io`, `supabase.co`, `pages.dev` are outside this session's network).

**v1.3.4 — THE LIST ABOVE THE FOLD ON PHONES.** Owner (2026-10-19): "Run item 1, the list above the fold,
since finding a court is the first thing a visitor does." Below 880px the sidebar hero is its title and the
data-source line (the subtitle is hidden), the sport chips stay on the face and tier + status fold behind one
"More filters ▾" toggle (desktop unchanged: all three rows, no toggle), the three counts become one slim strip,
and the season hint moves to the end of the list on every size. Measured: first court row at y 611 of 844 on a
390×844 phone (4 rows visible) and 540 of 667 on a 375×667 (2 rows); before, no row was visible without
scrolling. Desktop first row unchanged in meaning. Offline check 20 pins; fake-backend check errors [].
Working note: `working/2026-10-18-ux-pass-phone-sheet.md` (part two appended).

**v1.3.3 — THE COURT PANEL IS A BOTTOM SHEET ON PHONES.** Owner (2026-10-18, phone screenshot): "Do a Ux
pass. I'm unable to close out of this or even see it properly. Map is good but some user wants and usage
is clunky." Root cause: below 880px the court panel was an absolutely positioned card *inside the 40vh map
box* with `max-height: 80vh`, so its header and ✕ sat above the visible region and the page scrolled it
away. Now it is `position: fixed` over the whole viewport (86dvh max), with a grip, a larger ✕ that is the
element under the finger, a dimmed backdrop that closes it on tap, Escape as the last layer after the sheet
and the inbox, and a body scroll lock while open; one `openDetail()`/`closeDetail()` pair. Desktop unchanged.
Verified at 390×844: panel top 166 → bottom 844, ✕ hit-tested, close/Escape/backdrop all close; offline check
20 pins; fake-backend check errors []. Working note: `working/2026-10-18-ux-pass-phone-sheet.md`.

**v1.3.2 — THE REPOSITORY AND THE LINK ARE PICKUP TOO.** Owner (2026-10-18): "Can we change the repo and link
to be PickUp?", then renamed the repository themselves: it is `shwinster101/PickUp` and the site is
**https://shwinster101.github.io/PickUp/** (the old `/OpenCourt/` address answers 404; GitHub redirects the
repository URL and git remotes, not the Pages site). This release repoints every reference in code and docs
(the provisioner's `PAGES_URL`, its mock test, the e2e README, README, FOUNDATION, MIGRATION, the staged legacy
pointers). **Owner's console, still:** add `https://shwinster101.github.io/PickUp/` (and `/**`) to Supabase →
Authentication → URL Configuration so magic-link and keep-account redirects work (the Maps key needs nothing:
its `https://shwinster101.github.io/*` referrer already covers the new path). "OpenCourt" remains the name of
the codebase's structure and the LA catalogue inside the page; dated working notes keep the old URL as history.

**v1.3.1 — THE NAME ON THE DOOR IS PICKUP.** Owner (2026-10-18), on the merged v1.3.0 and the question "Name
still open court or shall we change to pickup": "yes after that do the pickup name change", taking the
recommendation "PickUp as the wordmark, using the 2021 logo already in assets/img/, with OpenCourt LA kept as a
small sub-line or the court-finder section label".
- **The header** leads with the 2021 wordmark (`assets/img/pickup-logo.png`, byte-identical, on a white tile so
  its colours read on the dark bar) and keeps "OpenCourt LA" beside it as the catalogue's name; the tagline is
  unchanged. Page title, description and Open Graph title read PickUp · OpenCourt LA; the 1024px icon is the
  Apple touch icon. Below 560px the logo is 28px and the sub-line smaller; the v1.3.0 header fit holds.
- **Unchanged:** the repository, the codebase and the LA court catalogue are OpenCourt; every id, class, file
  and document name; the no-build rule. Closes the open item in FOUNDATION §3 and the v1.1.0 ruling.
- Working note: `working/2026-10-18-pickup-rename.md`.

**v1.3.0 — THE PEOPLE FLOW REACHES THE PAGE: FRIENDS, RESULTS, MVP AND STANDING; REALTIME ONLY WHERE IT IS
HONEST; AN ACCOUNT YOU CAN KEEP; PROVISIONING AS ONE COMMAND; TWO BROWSERS, ONE PROOF, RUN HERE.** Owner
(2026-10-17): "You do as much as you can look up instructions if needed. provision Supabase and fill config.js,
then open two browsers and confirm a report on one appears on the other", with the long-term line "M3 screens
plus M4 realtime and email upgrade, so friends, results and MVP reach the page and polling goes away"; and,
the same evening, "open the PR for the marker fix (let's go with the OverlayView path so we don't need a Map ID)".
- **M3 on the page:** three header buttons beside the inbox, shown only with a backend and a profile. **Mine**
  lists my pickups with the one action each state allows (Enter result · Vote MVP · ⭐ name · + Invite / 🔗 /
  Cancel · Leave · Accept/Decline). **Enter result** assigns the roster to two teams by tap, reads set scores
  as "6-4 3-6 10-7", names the winner; the row reads closed. **Vote MVP** is one tap. **Friends** searches
  players, sends/accepts/declines/cancels requests, removes, and invites a friend to my pickup from Mine or
  the court panel. **You** shows name, username, skill and standing tiles (games · wins · ⭐ MVP · score;
  the provisional formula behind ⓘ). Every destructive tap is two-tap armed ("Sure?"); no native dialogs.
  No new SQL was needed: every screen reads the v1.2.0 views and functions.
- **M4, part one.** `supabase/migrations/0005_realtime.sql` adds `pickups`, `pickup_attendees` and
  `notifications` to the `supabase_realtime` publication where it exists; `court_reports` stays on the
  5-minute poll (its RLS is author-only, so nobody else would receive an event). The page opens one channel;
  "· live" appears on the data-source line only while it is SUBSCRIBED, and any other status falls back to the
  v1.2.0 polling without a word. **The account:** an anonymous player can *Keep this account* (email
  confirmation keeps the same id, so reports and games follow), a returning player signs in by magic link
  (no new accounts are minted by a typo), Sign out is hidden for anonymous sessions because it would lose
  the profile; `onAuthStateChange` reloads profile, inbox, Mine, the open court and the channel, and the hash
  router ignores the auth hashes supabase-js consumes. Not built yet: push, share cards, "I'm here, need a 4th".
- **Provisioning is one command.** `scripts/provision-supabase.sh` drives the Supabase Management API from
  its OpenAPI document: organisation → create-or-reuse the project → wait healthy → anonymous sign-ins and
  redirect URLs → `pg_cron` → the migrations and seed, each recorded in the project's migration history →
  the anon key only → verify `courts_live` from outside → write `config.js`, preserving `GOOGLE_MAP_ID` and
  `METRO`. The token never reaches argv, disk or output; the database password is printed once. `--dry-run`
  and `--check` exist. Proven against a mock of the API (`test/provision/run.sh`, 40 assertions); **never run
  for real from here, because this environment holds no token** (the owner stores `SUPABASE_ACCESS_TOKEN` as
  an environment secret, or runs it locally).
- **The owner's acceptance test, run here before a project exists.** `test/e2e/local-backend.py` is a
  stand-in for Supabase: a mini PostgREST + GoTrue over the real migrations on a throwaway PostgreSQL, every
  request under the real role with `auth.uid()` and RLS (psql per request; HS256 test tokens). `local-stack.sh`
  starts it with the page; `smoke-local-backend.sh` runs 44 curl checks; **`two-browsers.cjs`** (Playwright,
  the real pinned supabase-js) opens two fresh browsers: A reports Open and B sees it live; A starts a pickup,
  B joins it, A's inbox names B; Mine; the share link. 8 of 8 steps, three runs in a row. The same command
  runs against the real project the minute `config.js` is filled.
- **Fixed on the way:** the share-link highlight was applied once and lost to the next re-render (now
  re-applied on every render of that court, dropped when another court opens; the proof's step 8 went from
  intermittent to 3/3); the v1.2.0 working note's own prose tripped the secret scan at `daa9ea0` (reworded);
  the realtime migration was numbered 0006 with no 0005 (renumbered; the provisioner test derives its
  expected list from the folder).
- **Reviewed adversarially before merge** (three lenses, two refuters per serious finding, one fixer, an
  independent re-run): a real regression was caught — the phone-width header fix clipped the inbox
  dropdown, so a signed-in player saw the badge but never the list (the inbox is now fixed-positioned);
  the stand-in's SQL-error status mapping now mirrors PostgREST case for case; twelve small findings
  fixed (the court panel's Cancel is two-tap armed and no native dialog remains; the bell closes an
  open sheet; badge counts reach screen readers; Sign out is this device only; a dead share link says
  so; an unassigned roster player is named before a result is saved). Recorded, not changed: the share
  token travels in the realtime stream and is a convenience, not a secret (ruling in the conventions).
- **Gate:** `sh scripts/check.sh --backend` → GATE PASSED, **182 assertions** (t_040 realtime adds 15).
  Browser checks run on `http://localhost:8000`, the only local origin the Maps key's referrer list allows.
- **The Maps key (owner's console, 2026-10-17 screenshots):** referrers and the API restriction are right.
  The live dialog persists, fires no auth failure, and appears on `localhost:8000` too, so the remaining cause
  is billing on the Cloud project. **PR #1** (pins via OverlayView, no Map ID) was merged 2026-10-18.
- **Not done:** no Supabase project; realtime delivery and the email round trips are provable only on one;
  M4 part two; the visible rename; which of GitHub Pages and Cloudflare Pages (`opencourt.pages.dev`, which
  builds every branch) is production is the owner's call. Working note:
  `working/2026-10-17-m3-m4-and-provisioning.md`.

**v1.2.0 — THE SHARED BACKEND, BUILT AND PROVEN BEFORE IT HAS A HOME: COURTS AND REPORTS, IDENTITY AND
PICKUPS, FRIENDS, RESULTS AND MVP, AS SQL UNDER ROW-LEVEL SECURITY; THE PAGE WIRES TO IT AND STAYS HONEST
WITHOUT IT.** Owner (2026-10-17): "Run the long term solution build. I'll work on the cloud console key."
- **The backend is four migrations and a seed** (`supabase/`), no server code. M1 `courts`,
  `court_reports`, the `courts_live` view, `submit_report()` with the 15-minute rate limit. M2
  `profiles`, `pickups`, `pickup_attendees`, `notifications`, `event_log`; `upsert_profile`,
  `create_pickup`, `join_pickup`, `leave_pickup`, `cancel_pickup`, `invite_to_pickup`,
  `cancel_invitation`, `respond_to_invitation`, `start_due_pickups`, `mark_notifications_read`; views
  `open_pickups`, `my_pickups`, `my_notifications`; `pickup_by_token`, `pickup_roster`. M3 `friendships`
  and its six functions, `search_players` (parameterised; 2021 interpolated SQL), `pickup_teams`,
  `record_result` (team membership recorded; 2021 dropped it), `mvp_votes`, `vote_mvp` (one vote, not
  self, ties broken among the leaders), `finalize_due_mvp_votes`, `expire_stale_pickups`, the
  `player_standing` view (2 per win, 3 per MVP, provisional). `0004` schedules the three clock
  functions with `pg_cron` where it exists.
- **Every rule 2021 skipped is in SQL under `auth.uid()`:** organiser-only cancel/invite/result,
  invitee-only respond, capacity under a row lock, start by the database clock, owner-only inbox.
  Clients cannot insert into any table directly; `anon` reads courts, the board and a shared link.
- **Proven:** `test/backend/run.sh` starts a throwaway PostgreSQL, applies a Supabase shim (roles,
  `auth.uid()`, Supabase's default grants), all migrations and the seed, then `t_010`–`t_030`: the 2021
  pytest flows ported and extended, the cross-user refusal matrix, decay, capacity, the clock, the MVP
  tie-break and deadline. **167 assertions pass** here on PostgreSQL 16. `sh scripts/check.sh --backend`
  runs it; the plain gate also checks that `supabase/seed.sql` matches `courts.json`.
- **The page** (`assets/js/app.js`, `backend.js`, `config.js`; pinned `supabase-js@2.45.4` UMD): with
  a URL and anon key in `config.js` it reads `courts_live`, writes reports through `submit_report`,
  lists and starts pickups on each public court (name prompt on first action, anonymous session),
  joins/leaves/cancels/accepts, copies a share link (`#pickup=<token>`), opens one from a link, and
  shows an inbox. Without them it serves `courts.json`, keeps reports on the device, and the sidebar
  says so ("Offline data · reports stay on this device"); nothing claims to be shared. Court fields
  are escaped before they reach `innerHTML`.
- **Pins are back:** markers draw through the page's own OverlayView unless a `GOOGLE_MAP_ID` is
  configured (then Advanced Markers). Verified in headless Chromium: 20 pins, no script errors, in
  both offline mode and against a fake supabase-js that mirrors the views' shapes.
- **Decisions recorded** in `docs/project-conventions.md`: a profile (anonymous session allowed) is
  enough to run a pickup, tightenable in one function; one 90-minute report window on both sides;
  M2 before M3 in the UI (M3 ships in SQL only this release).
- **Not done:** no Supabase project exists yet (owner steps in `supabase/README.md`); the friends,
  results and MVP screens; realtime and push (M4); the visible rename. Working note:
  `working/2026-10-17-shared-backend-build.md`.

**v1.1.0 — PICKUP COMES HOME: THE NAME AND LOGO STAY, THE 2021 BACKEND FLOW MIGRATES INTO OPENCOURT'S
STRUCTURE.** Owner (2026-10-17): "Run a thorough review of each repo, and especially read commits run
by Arian. I want pickup's issue and goal stated, vision, mission statement, and requirements/user
stories and workflow as our fundamental requirements and agent md. Opencourt is the modern successor
— though keeping the pickup namesake and logo will be the path forward: migration of pickup backend
flow to the opencourt structure and working apis."
- **The foundation:** `docs/FOUNDATION.md` states the issue (two frictions, WHERE and WHO, and the
  loop nobody closed), the goal, the vision, the mission (OpenCourt's line kept, an extension
  proposed), six personas, 40 user stories in eight epics with their 2021 and current status, the
  core loop and state machines, and the fundamental requirements FR-60–102, DR-10–14, NFR-10–15,
  continuing the SRS numbering. The SRS (`docs/REQUIREMENTS.md`, 1.0.1 → 1.1.0) stays the
  court-finder spec; FOUNDATION adds the people half.
- **The record of what migrates:** `docs/LEGACY_PICKUP_BACKEND.md` — the 2021 Hasura + Express +
  Firebase flow as built, from source: 12 tables, 19 actions, the domain-event outbox and its
  listeners, the auth model (a client-set header, no permissions), the intended-vs-delivered table.
  Sources `PickUpBois/PickUpHasura` (9 commits, all Arian Rahbar) and `PickUpBois/PickUp` (80
  commits: Arian 47, David Reynolds 30, Ashwin 3), both frozen at 2021-11-06; the Heroku host answers
  404.
- **The path:** `docs/MIGRATION.md` — principles, the entity map (`users→profiles`,
  `locations→courts`, `events→pickups` …), identity and RLS, a schema sketch, the API surface (every
  2021 action as a PostgREST write or an RPC function with the rule 2021 skipped), what is not
  ported, steps M0–M5 with acceptance, risks and the owner calls still open.
- **Brand ruling:** the product is **PickUp**; **OpenCourt** names the codebase, the repository and
  the LA court catalogue. `assets/img/pickup-logo.png` (the 2021 wordmark, 581×197) and
  `assets/img/pickup-icon-1024.png` are carried byte-identically. The page header still reads
  "OpenCourt LA": the visible rename waits on the owner's wording (FOUNDATION §3).
- **Not ported, by ruling of the review:** header-trusted identity, Hasura-admin access for every
  client, the Express action tier, in-process timers, Firebase. The Google service account committed
  to the public PickUpHasura repository is compromised and must be disabled in Google Cloud.
- **The gate:** `scripts/check.sh` (JSON parses, JS parses, no secret-shaped strings). No test suite
  exists yet; the SRS §8 checklist is the manual acceptance until M1 adds tests.
- **Found, not fixed (owner's call, first item of M0.5):** in headless Chromium the **live page**
  (`shwinster101.github.io/PickUp`, v1.0.1) renders its map and list but **no court pins** —
  Advanced Markers are created on a map without a Map ID (20 console errors) — **and shows Google's
  "This page can't load Google Maps correctly" dialog** to every visitor: the committed key is
  referrer-restricted (an unlisted origin is refused), but its restriction, API scope or billing does
  not match the production URL; the cause is only readable in the owner's Cloud Console. The SRS still
  records the key as an open blocker. Fourteen further OpenCourt findings, eighteen backend findings
  and the MacroDash doc-rot list are in the working note.
- **Code and deploy unchanged** in this release: `index.html`, `assets/js/app.js`, `styles.css`,
  `courts.json` and the Pages workflow are as at v1.0.1. The legacy repos' `CLAUDE.md` and
  `AGENTS.md` pointers (and PickUpHasura's README) were written and committed on their branches, but
  the push was refused (the Claude GitHub App is not installed on `PickUpBois`); staged copies sit in
  `docs/legacy-repo-docs/` until they land, then that folder goes.
- Working note: `working/2026-10-17-pickup-opencourt-review.md` (the four-repo review, the
  Arian commit narrative, findings with their verification status, outcomes).

**v1.0.1 — 2026-09-16.** Referrer-restricted Google Maps browser key wired into `index.html`; Pages
workflow enables the site on first run. (Recorded retrospectively from the git log; the SRS header
carried 1.0.1 from 2026-09-15.)

**v1.0.0 — 2026-05 (pushed 2026-09-15).** OpenCourt LA Phase 1: 20 curated LA County court sites,
Google Map with auto-fit bounds, three-tier access filtering, heuristic availability, three-button
localStorage reports, seasonal Grand Slam theming, consolidated SRS. See `docs/ROADMAP.md`.

## Current brief

PickUp, rebuilt on the OpenCourt structure: a **no-build-step HTML/CSS/JS** web app deployed to
GitHub Pages on push to `main` (`.github/workflows/pages.yml`; a Cloudflare Pages project also builds
the repository). It is a court finder for recreational tennis and pickleball in Los Angeles County
(`index.html`, `assets/js/app.js`, `assets/js/backend.js`, `assets/js/config.js`,
`assets/css/styles.css`, seed data in `assets/data/courts.json` and `grand-slams.json`) with the PickUp
people flow on the page — profiles, pickups on courts, invitations, the inbox, friends, results, MVP,
standing, an account you can keep — on a **Supabase Postgres backend defined entirely by
`supabase/migrations/`** (PostgREST + RPC + RLS + one realtime publication; no server code). The page
runs with or without the backend and says which. **The backend is live:** `scripts/provision-supabase.sh`
created the project `pickup` (us-west-1, Free plan) on 2026-10-18, `config.js` has held its URL and anon key
since `a04ce05`, and Pages has served it since PR #2. `test/e2e/` proves the shared flow in two browsers
against a local stand-in (and ran 8/8 against the real project on 2026-10-18). There is no package manager and no framework; the only runtime dependency is the pinned
`supabase-js` UMD script. The version is the headline of this file; `index.html`'s badge and
`docs/REQUIREMENTS.md` carry the same number.

## Required reading

- `docs/project-conventions.md` — the locked decisions and the per-pass working rhythm. Read
  before changes.
- `docs/FOUNDATION.md` — why PickUp exists and what it must do. Read before any product change.
- `docs/MIGRATION.md` — the plan of record for the backend; read before touching data or APIs.
- `docs/LEGACY_PICKUP_BACKEND.md` — what the 2021 code did, with its defects named; the source of
  truth when a 2021 behaviour is in question. The legacy repositories themselves are read-only.
- `docs/REQUIREMENTS.md` (SRS), `docs/ROADMAP.md`, `docs/PROJECT_BRIEF.md`, `docs/SETUP.md`.
- `working/` — dated notes; the newest is the latest state of any open work.

## Invariants

- **Honest signals.** A heuristic is labelled a heuristic, a live report says how old it is, demo or
  fallback data is labelled as such. Never relabel stale, cached or illustrative data as live.
- **Identity from the database, never from the client.** A row's owner is `auth.uid()` or the
  server-minted anonymous id; no header, body field or query parameter names the actor. Every
  organiser-only, invitee-only, capacity and one-vote rule lives in SQL under row-level security.
- **No build step until a build step is necessary.** Plain HTML/CSS/JS, deployable as-is; a client
  library is a pinned CDN script.
- **Forward-compatible schema.** Every record carries `metro`; migrations add, never rename or drop
  without a deprecation note in `working/`.
- **Secrets never enter this repository.** The referrer-restricted Google Maps browser key and a
  Supabase publishable anon key are client credentials and may appear in source; service-role keys,
  service accounts and tokens never do. `scripts/check.sh` refuses secret-shaped strings.
- **The PickUp name and logo stay.** Rename decisions are the owner's; the assets are not redrawn.
- **Preserve dates and provenance.** A court's `last_updated`, a report's timestamp, a result's
  recorded time and a note's source date are facts, never restamped because a routine ran.
- **Findings live on the branch.** Any survey, audit or review gets a dated `working/` note that is
  updated when the work lands (an Outcomes section with commit SHAs, what shipped, what the plan
  got wrong, corrections kept beside the original text).

## Working rhythm (per pass)

The protocol is in `docs/project-conventions.md`; in short: state what materially changed, define
the issue and its root cause, record interpretations as assumptions for the owner to correct, quote
the owner's ruling with its date in the entry that lands it (what changed, what did not, what remains
open), prefer the smallest change that closes the issue, run the gate before every push, and end
with the missing assumptions, the highest-leverage short-term fix and the highest-leverage long-term
solution.

## Verification

```bash
sh scripts/check.sh              # the gate: data parses, scripts parse, no secret-shaped strings, seed current
sh scripts/check.sh --backend    # + migrations, RLS matrix, the ported 2021 flows and the realtime publication
                                 #   on a throwaway PostgreSQL (182 assertions)
python3 -m http.server 8000      # the only local origin the Maps key allows; then, with Playwright on NODE_PATH:
PORT=8000 node test/browser/check-offline.cjs /tmp/offline.png                               # 20 pins, no errors
PORT=8000 node test/browser/check-backend.cjs test/browser/fake-supabase.js /tmp/backend.png  # every screen, errors []
sh test/e2e/local-stack.sh start && sh test/e2e/smoke-local-backend.sh                        # the stand-in, 44 checks
OC_SUPABASE_URL=http://127.0.0.1:54400 OC_SUPABASE_ANON_KEY=local-anon node test/e2e/two-browsers.cjs  # 8 steps
sh test/e2e/local-stack.sh stop
bash test/provision/run.sh       # the provisioner against a mock of the Management API (40 assertions)
```

The backend leg and the stand-in need the PostgreSQL server binaries (the leg skips with a message
otherwise; set `REQUIRE_BACKEND=1` to fail instead). Pushes to `main` deploy Pages automatically, and
since `a04ce05` a deploy talks to the live Supabase project (`config.js`): nothing gates a push to `main`
but this list. The offline check routes an empty config, so it never reads production; the two-browser
proof writes real, visible reports and pickups when pointed at production (`test/e2e/README.md`).

## Legacy repositories (frozen, read-only)

| Repository | What it holds | Status |
|---|---|---|
| `PickUpBois/PickUp` | SwiftUI iOS app (111 views, Apollo codegen, Firebase Auth/Storage/Messaging), the wordmark and icon | frozen at `496b914e` 2021-11-06; `CLAUDE.md` there points here |
| `PickUpBois/PickUpHasura` | Hasura v2.0.4 metadata + 51 migrations, Express/TypeScript action handlers, pytest flows, docker-compose | frozen at `4244d6d` 2021-11-06; public; contains committed credentials (see its `CLAUDE.md`) |
| `shwinster101/MacroDash` | an unrelated project of the same owner; the exemplar for this document's conventions | not part of PickUp |
