# Project conventions and locked decisions — OpenCourt (PickUp)

One `###` per ruling, newest first, each headed with its date. A ruling says what it supersedes and
what it leaves unchanged. `CLAUDE.md` carries the release record; this file carries the decisions
and the working rhythm. Read before changes.

## Working rhythm (per pass)

- **Before every pass**, state in one bullet what has materially changed since the previous
  response, then define the issue and its root cause before proposing a move (owner preference,
  2026-10-17).
- **Interpretations are recorded as assumptions for the owner to correct**, in the working note,
  before the build.
- **Findings live on the branch, not in the chat.** Any survey, audit or review gets a dated
  `working/<YYYY-MM-DD>-<slug>.md`, committed, and **updated when the work lands** with an
  **Outcomes** section (commit SHAs, what shipped, what was deliberately left, and every place the
  original survey turned out to be wrong, kept beside the original text as a correction).
- **`working/` is notes, never a product surface.** Nothing the page serves may depend on it.
- **End every pass with**, in this order: the two most important missing assumptions or facts;
  the highest-leverage short-term fix; the highest-leverage long-term solution (owner preference,
  2026-10-17). Say plainly what was not run or not verified.
- **Relabel at merge.** If another change claims a version first, the later one takes the next
  number and says so in its entry and its note.

## Locked decisions

### Signals cost something; one number for real use; every clock is the metro's (build rulings 2026-11-07, v1.4.0)

**Owner (2026-11-07):** "A decision on how much abuse to block … A usage measure. Decide which number shows
real use before building more features. · Next tier: the CDN script has no integrity hash, all times use the
visitor's device clock instead of LA time, the stale push-to-github.sh is a hazard, and organisers can't be
deleted. · Email later". The interpretations below were recorded before the build
(`working/2026-11-07-limits-usage-next-tier.md`); the owner may change any number in one place, `0006`.

- **Abuse posture: slow and visible, not impossible.** Identity is free, so SQL limits make each fake cost
  sessions and time: reports from one session cover ≤ 3 courts an hour (the 15-minute rule per court
  stays); ≤ 5 open pickups and ≤ 10 created per 24 h per organiser; invitations to mutual friends only;
  friend requests ≤ 10 an hour, ≤ 20 unanswered, none for 7 days after a decline. **No location check:**
  the server cannot verify a browser's position, so the live note says "by a player", not "on the ground".
- **The bot check is ready and off.** `CAPTCHA_SITE_KEY` in `config.js` turns on Cloudflare Turnstile for
  every sign-in; the secret lives only in Supabase. Page first, dashboard second (the reverse refuses
  every sign-in). The provisioner keeps the key across runs.
- **Standing resists farming:** a game counts when its result came ≥ 20 minutes after its start; ≤ 3
  counted games per player per Los Angeles day; an MVP counts only on a counted game. Still provisional.
  `player_standing` is for signed-in players only (`anon` had it through Supabase's default grants).
- **A player can be deleted:** finished games stay for everyone else with an empty organiser; open or
  running pickups are cancelled and their players told. Organiser checks compare with `is distinct from`.
- **Real use is one number: real games per week** (a pickup that started that LA week, not cancelled, with
  ≥ 2 players who are neither in `metrics.exclusions` nor proof accounts). **Phase 5's gate** (FOUNDATION §8)
  is met when each of the last 4 complete weeks had one. Owner-only, in the SQL editor (`metrics` schema,
  not exposed by the API); read as an upper bound, since sock puppets count too.
- **Every clock is the metro's** (`METRO` → `America/Los_Angeles`): the heuristic, pickup times, the new
  pickup form, the header clock, the theme date. A device elsewhere sees PST/PDT beside each time.
- **The CDN script carries its integrity hash**, computed from the npm tarball (the file jsDelivr serves).
  A refused or missing client reads "Backend unreachable", never "Offline data". To bump supabase-js: `npm
  pack` the new version, hash `dist/umd/supabase.js` (`openssl dgst -sha384 -binary | openssl base64 -A`),
  update the tag, run `test/browser/check-hardening.cjs`.
- **`push-to-github.sh` is gone** (it renamed the current branch to `main` and pushed un-gated).
- **Unchanged:** the no-build rule; RLS as the boundary; email deferred by the owner (the account ladder
  still needs SMTP and the `/PickUp/` redirect URLs).

### The people flow on the page; realtime only where honest; provisioning and the proof as scripts (build rulings 2026-10-17/18, v1.3.0)

**Owner (2026-10-17):** "provision Supabase and fill config.js, then open two browsers and confirm a report
on one appears on the other" · "M3 screens plus M4 realtime and email upgrade, so friends, results and MVP
reach the page and polling goes away" · "open the PR for the marker fix (let's go with the OverlayView path
so we don't need a Map ID)".

- **Pins draw through OverlayView.** `GOOGLE_MAP_ID` stays empty; Advanced Markers are an opt-in the
  owner may never take. PR #1 carries this to `main`.
- **Realtime carries only what every subscriber may read:** `pickups`, `pickup_attendees` and
  `notifications` (own rows). `court_reports` stays polled every 5 minutes because its RLS is author-only.
  "· live" shows only while the channel is SUBSCRIBED; any other status is the v1.2.0 polling, silently.
- **The account ladder:** anonymous first (unchanged); *Keep this account* adds an email to the same id;
  *Played before? Sign in* is a magic link that never creates an account; Sign out is hidden for anonymous
  sessions because it would lose the profile.
- **Destructive taps are two-tap armed** (Cancel, Leave, Remove, Sign out): the first tap says "Sure?" and
  sends nothing. No native confirm dialogs.
- **The share token is a convenience, not a secret.** `pickups.share_token` opens a court panel with
  that pickup highlighted and grants nothing else (joining still needs a session, a profile and a free
  spot). The 2021-style `anon` select on `pickups` (0002) and the realtime publication (0005) therefore
  carry it; a column-level grant can hide it later without changing the page (review finding, 2026-10-18).
- **Standing is readable by any signed-in player** (`player_standing` is granted to `authenticated` with no
  row filter), which a leaderboard will want; the owner may tighten it in one grant.
- **Provisioning is a script, not a checklist:** `scripts/provision-supabase.sh`, written from the
  Management API's OpenAPI document. The token is an environment secret (`SUPABASE_ACCESS_TOKEN`), never a
  file or a chat message; the database password is printed once and stored by the owner. The manual steps
  stay in `supabase/README.md` as the fallback.
- **The acceptance test is a script:** `test/e2e/two-browsers.cjs`. Until a project exists it runs against
  the local stand-in (`test/e2e/local-backend.py`), which is a test tool only: any divergence from Supabase
  is a bug in the stand-in, never a feature of the page.
- **Browser checks run on `localhost:8000`**, the one local origin the Maps key allows; a check on another
  port reports zero pins for that reason alone.
- **Migrations stay contiguous** (`0001`–`0005`; `0006` since v1.4.0); the provisioner test derives its
  expectations from the folder, so a new file never needs a hand edit there.
- **Unchanged:** every v1.2.0 ruling below; the no-build rule; the seed from `courts.json`; the SRS's
  Supabase choice; the Maps key and billing are the owner's console work.

### The backend is SQL under row-level security; a profile is enough to play (build rulings 2026-10-17, v1.2.0)

**Owner:** "Run the long term solution build. I'll work on the cloud console key."

- **Everything server-side is a migration** in `supabase/migrations/`: tables, views, functions,
  policies, grants, schedules. No Express tier, no edge function until push notifications need a
  secret (M4). Clients never insert into a table directly; every write with a rule is an RPC that
  reads `auth.uid()`.
- **A profile (name + username, skill optional) on an anonymous Supabase session is enough to
  create or join a pickup.** MIGRATION §3 had said "pickups require a non-anonymous account"; the
  build relaxed it to match the SRS's "lightweight identity (nickname + skill tag)" and keep the
  first visit free. Tighten it in one place, `require_profile()`, if abuse appears.
- **One report window: 90 minutes**, in `REPORT_TTL_MINUTES` and in the `courts_live` view;
  the SRS's "~2 h" (FR-25) is superseded. One rate limit: one report per court per session per
  15 minutes, enforced in `submit_report()`.
- **Capacity counts the organiser.** `capacity = 4` is a doubles game including the person who
  set it up (the 2021 hint read "e.g. 4 (doubles)").
- **The clock is the database's.** `start_due_pickups()`, `finalize_due_mvp_votes()` and
  `expire_stale_pickups()` run from `pg_cron`; no process holds timers. A vote closes 24 h after
  the result with whatever votes exist; a game nobody closed expires after 24 h and never counts.
- **Standing formula is provisional:** 2 points per win, 3 per MVP, in the `player_standing`
  view only. Change it there; never store it.
- **The page never lies about its data.** `#data-source` reads "Shared data" only when the
  backend answered; otherwise "Offline data · reports stay on this device" (or "Backend
  unreachable …"), and report feedback says "saved on this device" rather than "shared".
- **Markers draw through the page's own OverlayView** unless `GOOGLE_MAP_ID` is set; the JSON map
  style stays. **Unchanged:** the committed Maps key and its restriction are the owner's console
  work.
- **M3 (friends, results, MVP) ships in SQL first**, tested, with its screens to follow; M2's
  screens (pickups, inbox) ship now. **Unchanged:** the SRS's Supabase choice; the no-build rule;
  the seed stays in `courts.json` and `supabase/seed.sql` is generated from it.

### OpenCourt is PickUp's successor; the name and logo stay; the 2021 backend flow migrates here (owner ruling 2026-10-17, v1.1.0)

**"Opencourt is the modern successor — though keeping the pickup namesake and logo will be the path
forward: migration of pickup backend flow to the opencourt structure and working apis."** And, in the
same message: **"I want pickup's issue and goal stated, vision, mission statement, and
requirements/user stories and workflow as our fundamental requirements and agent md."**

- The product is **PickUp**; **OpenCourt** names the codebase, this repository and the LA court
  catalogue. The 2021 wordmark and icon are carried byte-identically (`assets/img/`).
- `docs/FOUNDATION.md` is the fundamental requirements document; `docs/MIGRATION.md` is the plan
  of record for the backend; `docs/LEGACY_PICKUP_BACKEND.md` is the source of truth for what 2021
  did. `PickUpBois/PickUp` and `PickUpBois/PickUpHasura` are frozen, read-only references.
- **Supersedes** nothing in the SRS; it extends it (FR-60 onward). The SRS's Phase 3 rows
  (FR-50–53) are restated in FOUNDATION Epic E/F.
- **Unchanged:** the court finder's code, data, deploy and the no-build-step rule; the SRS's
  Supabase choice (§7) stands as the plan of record (see the stack decision record in
  MIGRATION §1).
- **Open, for the owner:** ~~the visible wording of the rename on the page~~ (ruled 2026-10-18, v1.3.1:
  the PickUp wordmark leads, "OpenCourt LA" is the sub-line); the extension of the mission line; disabling
  the 2021 Google service account.

### Identity comes from the database, never from the client (review ruling 2026-10-17, v1.1.0)

The 2021 backend identified the caller by a header the client set (`X-Hasura-User-Id`), had no
permission rules and no admin secret, and so let any client act as any user and read or write any
table. **That design is not ported.** Every row's actor is `auth.uid()` (or the server-minted
anonymous id); every owner-only, invitee-only, capacity and one-vote rule is enforced in SQL under
row-level security; the migration's gate includes a cross-user refusal matrix. **Unchanged:** the
Maps browser key and a publishable anon key may appear in source; service keys never do.

### No build step until a build step is necessary (SRS NFR-01, re-affirmed 2026-10-17)

Plain HTML/CSS/JS deployable to GitHub Pages as-is. A backend client is a pinned CDN script. The
`scripts/check.sh` gate (data parses, scripts parse, no secret-shaped strings) is the floor every
push clears; it grows a backend test leg from M1.
