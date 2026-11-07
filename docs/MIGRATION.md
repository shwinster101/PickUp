# PickUp backend flow → OpenCourt structure and working APIs

**Version 1.1.0 · 2026-10-17 · Status: plan of record (owner ruling 2026-10-17); nothing below is built yet.**

Scope: move the people flow that `PickUpBois/PickUpHasura` implemented in 2021 (friends, pickups,
invitations, results, MVP, notifications; see [`LEGACY_PICKUP_BACKEND.md`](./LEGACY_PICKUP_BACKEND.md))
onto the backend OpenCourt already chose for Phase 2 ([`REQUIREMENTS.md`](./REQUIREMENTS.md) §7:
Supabase Postgres + auto REST + RLS), without giving up the no-build-step frontend. The product
keeps the PickUp name and logo ([`FOUNDATION.md`](./FOUNDATION.md) §3).

---

## 1. Principles

1. **Port the model, not the plumbing.** Tables, enums, the friend-edge model, the pickup lifecycle
   and the pytest flows are worth keeping. Hasura, the Express action tier, the in-process
   scheduler and Firebase are not.
2. **Identity from the database, never from the client.** `auth.uid()` replaces the
   `X-Hasura-User-Id` header everywhere; every business rule that 2021 skipped (owner-only,
   invitee-only, capacity, one vote, not self) is enforced in SQL under row-level security.
3. **One request per intent.** 2021 split a state change and its domain event across two
   requests and relayed the event through a webhook that always answered 500. Here a state change,
   its log row and its notifications happen in one transaction (RPC function or trigger).
4. **No process to keep alive.** Starting a pickup at its time, expiring reports and picking an
   MVP after a deadline are scheduled in the database (`pg_cron`) or derived at read time.
5. **Frontend stays static.** `supabase-js` from a pinned CDN URL; the publishable anon key in
   source is a client credential by design (RLS does the gating), the service-role key never is.
6. **Add, don't rename.** Every migration file is additive; a drop or rename is preceded by a
   deprecation note in `working/`.

**Stack decision record.** The SRS chose Supabase over Cloudflare KV/D1, Firestore and a self-hosted
Node server (2026-09-15). That ruling stands for this plan. The owner also operates a Cloudflare
Pages + KV + Workers stack elsewhere; if that familiarity is judged to outweigh Postgres (RLS,
`pg_cron`, PostGIS, PostgREST for free), the entity model in §2 ports to D1 unchanged and the RPC
layer becomes Worker routes. Revisit only before M1 starts, not after.

---

## 2. Entity map (2021 → OpenCourt)

| 2021 (`PickUpHasura`) | OpenCourt | Change | Why |
|---|---|---|---|
| `users` (`user_id` = Firebase UID text, `first_name`, `last_name`, `username`, `college`, `photourl`, `goat_score`, `tokens`) | `profiles` (`id uuid` = `auth.users.id`, `username` unique, `display_name`, `photo_url`, `metro`, `skill`, `search tsvector` generated) | identity key becomes the auth id; `college` → optional `home_court_id`/`metro`; `goat_score` becomes a view | FR-61, FR-64, FR-92 |
| `locations` (PostGIS point + address; never used) | **`courts`** (exists in `assets/data/courts.json`: `id`, `metro`, `name`, `neighborhood`, `lat`, `lng`, `sports[]`, `tier`, `court_count`, `demand_tier`, `notes`) | the 2021 table is dropped; a pickup references a court | DR-10, FR-80 |
| — | `court_reports` (`court_id`, `status open|mixed|full`, `device_id`, `created_at`) | new; replaces `localStorage` | FR-34–36 |
| `events` (`name`, `info`, `start_date`, `end_date`, `capacity`, `type`, `status open|ip|closed`, `deleted`, `winner_id`, `mvp_id`, `location_id`) | `pickups` (`court_id`, `organiser_id`, `sport`, `starts_at`, `ends_at`, `capacity`, `note`, `status open|in_progress|closed|cancelled`, `winning_team_id`, `mvp_id`) | `deleted` flag → `cancelled` state; explicit `organiser_id`; `name` folds into `note` (the court names the place) | FR-80, FR-84, FR-85 |
| `event_attendees` (PK `(event_id, attendee_id)`, `status owner|invited|ok|conflict`, `invited_by`, `vote_count`, `voted`, `team_id`) | `pickup_attendees` (PK `(pickup_id, player_id)`, `status owner|invited|joined`, `invited_by`, `team_id`) | `ok` → `joined`; `conflict` dropped (never written); votes move to their own table | FR-82, FR-91 |
| `event_teams` (`set_scores` jsonb; `members` never populated) | `pickup_teams` (`pickup_id`, `team_no`, `set_scores int[]`) + `pickup_attendees.team_id` **populated** by `record_result` | the remote-schema unpacking trick is unnecessary | FR-90 |
| `relationships` (PK `(user_id, friend_id)`, directed; one edge = pending, two = friends) | `friendships` (same model) + view `friends_of(player)` and `friend_status(a, b)` | the broken computed field becomes a view | FR-71, FR-72 |
| `notifications` (`user_id`, `actor_id`, `event_id`, `type`, `status`) | `notifications` (`recipient_id`, `actor_id`, `pickup_id`, `kind`, `read_at`) | written by triggers; `status` → `read_at` timestamp | FR-100, FR-101 |
| `device_tokens` (FCM) | `push_subscriptions` (web push endpoint + keys, per `profile_id`) | iOS FCM → web push; sending happens in an edge function with server secrets | FR-102 |
| `domain_events` (outbox + Hasura event trigger + Node emitter) | `event_log` (append-only; triggers write it; nothing relays it) | audit trail stays, relay goes | DR-12 |
| `event_files`, `info_notifications`, `search_users2`, schema `hdb` | — | dead in 2021 | — |
| Hasura enum tables | Postgres `enum` types or `check` constraints | — | — |

---

## 3. Identity and authorization

| Concern | 2021 | OpenCourt |
|---|---|---|
| Who is calling | a header the client sets | the JWT Supabase issues; `auth.uid()` in SQL |
| Anonymous use (court reports) | n/a | Supabase anonymous sign-in on first visit → an `auth.users` row flagged anonymous; `court_reports.device_id = auth.uid()` |
| Upgrade to an account | n/a | `updateUser({email})` / magic link on the same session; the uid is unchanged, so reports and games follow the player (FR-61) |
| Table access | admin for everyone | RLS on every table (deny by default), policies below |
| Business rules | partly in Express, partly nowhere | in `security definer` functions that re-check `auth.uid()`, and in constraints/triggers |

Policies, as the first migration will state them:

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `courts` | everyone | owner role only (curation) | owner role | owner role |
| `court_reports` | everyone (aggregated view); raw rows: own | `device_id = auth.uid()` and the rate-limit trigger passes | — | — |
| `profiles` | authenticated, non-anonymous | own row, once | own row | — |
| `friendships` | rows where I am either side | `requester_id = auth.uid()` | — | own edge, or the edge pointing at me (reject) |
| `pickups` | everyone, `metro`-scoped | via `create_pickup()` only | via functions (organiser) | never (cancel is a state) |
| `pickup_attendees` | members of the pickup and everyone for open pickups' counts | via `join_pickup()` / `invite_to_pickup()` only | via functions | via functions |
| `pickup_teams`, `mvp_votes` | members of the pickup | via functions | — | — |
| `notifications` | `recipient_id = auth.uid()` | triggers only | own rows (`read_at`) | own rows |
| `push_subscriptions` | own | own | own | own |
| `event_log` | owner role | triggers only | — | — |

RLS tests are part of the gate for M1 onward: a second test user must be refused on every
cross-user write the 2021 backend allowed (mark another's notification read, invite to another's
pickup, cancel another's invitation, vote twice, vote for self, join a full pickup).

---

## 4. Schema sketch (Postgres)

```sql
create type sport as enum ('tennis','pickleball','basketball');          -- FR-81, extend by migration
create type pickup_status as enum ('open','in_progress','closed','cancelled');
create type attendee_status as enum ('owner','invited','joined');
create type report_status as enum ('open','mixed','full');
create type notification_kind as enum ('friend_request','friend_accepted','friend_rejected',
  'invitation','joined','left','cancelled','enter_result','vote_mvp','you_are_mvp');

create table courts (                      -- columns = courts.json fields, verbatim
  id text primary key, metro text not null, name text not null, neighborhood text,
  lat double precision not null, lng double precision not null, sports sport[] not null,
  tier text not null check (tier in ('free','low-cost','private')),
  court_count int, demand_tier text, notes text, updated_at timestamptz default now());

create table court_reports (
  id bigserial primary key, court_id text references courts, status report_status not null,
  device_id uuid not null default auth.uid(), created_at timestamptz not null default now());
-- view court_availability: recency-weighted status per court, null after 120 min (FR-25)
-- trigger: refuse a second report for (court_id, device_id) within 15 min (FR-36)

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username citext unique not null, display_name text not null, photo_url text,
  metro text, skill smallint check (skill between 1 and 5),
  search tsvector generated always as (to_tsvector('simple', coalesce(display_name,'')||' '||username)) stored,
  created_at timestamptz default now());

create table friendships (                 -- one edge = pending, both edges = friends
  requester_id uuid references profiles on delete cascade,
  addressee_id uuid references profiles on delete cascade,
  created_at timestamptz default now(), primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id));

create table pickups (
  id bigserial primary key, court_id text not null references courts,
  organiser_id uuid not null references profiles, sport sport not null,
  starts_at timestamptz not null, ends_at timestamptz, capacity int not null check (capacity between 2 and 30),
  note text, status pickup_status not null default 'open',
  winning_team_id bigint, mvp_id uuid references profiles, created_at timestamptz default now());

create table pickup_attendees (
  pickup_id bigint references pickups on delete cascade, player_id uuid references profiles,
  status attendee_status not null, invited_by uuid references profiles, team_id bigint,
  joined_at timestamptz, primary key (pickup_id, player_id));

create table pickup_teams (id bigserial primary key, pickup_id bigint references pickups on delete cascade,
  team_no smallint not null, set_scores int[] not null, unique (pickup_id, team_no));
alter table pickup_attendees add foreign key (team_id) references pickup_teams;
alter table pickups add foreign key (winning_team_id) references pickup_teams;

create table mvp_votes (pickup_id bigint references pickups on delete cascade,
  voter_id uuid references profiles, votee_id uuid references profiles,
  created_at timestamptz default now(), primary key (pickup_id, voter_id),
  check (voter_id <> votee_id));

create table notifications (id bigserial primary key, recipient_id uuid not null references profiles on delete cascade,
  actor_id uuid references profiles, pickup_id bigint references pickups on delete cascade,
  kind notification_kind not null, created_at timestamptz default now(), read_at timestamptz);

create table push_subscriptions (profile_id uuid references profiles on delete cascade,
  endpoint text, p256dh text, auth text, created_at timestamptz default now(), primary key (profile_id, endpoint));

create table event_log (id bigserial primary key, at timestamptz default now(), actor_id uuid,
  kind text not null, pickup_id bigint, payload jsonb);
```

Read models (views): `court_availability`, `friends_of(uuid)`, `friend_status(uuid, uuid)`,
`open_pickups` (court, sport, starts_at, spots left, organiser), `my_pickups(status)`,
`player_standing` (wins, MVPs, games → the 2021 "GOAT score", FR-92), `my_notifications`.

---

## 5. The API surface

PostgREST exposes tables and views under RLS; intents that change more than one row, or that
need a rule, are **RPC functions** (`security definer`, `set search_path = public`, re-checking
`auth.uid()`). This is the 2021 action list, one to one, with the rules 2021 skipped.

| 2021 action | OpenCourt call | Rule enforced in SQL | Writes (one transaction) |
|---|---|---|---|
| `createUser` | insert `profiles` (RLS: own row) | username unique, non-anonymous | profile |
| `updateUser` | update `profiles` (RLS: own row) | — (a null clears a field; 2021 could not clear one) | profile |
| `sendFriendRequest` | insert `friendships` | not self; not already friends; no reverse pending (then accept instead) | edge; notification `friend_request`; log |
| `acceptFriendRequest` | `accept_friend(requester)` | a pending edge toward me exists | reverse edge; notification `friend_accepted` |
| `rejectFriendRequest` | delete the edge toward me (RLS) | — | notification `friend_rejected` |
| `removeFriend` | `remove_friend(other)` | both edges exist | both edges deleted |
| `createEvent` | `create_pickup(court_id, sport, starts_at, capacity, note)` | sport ∈ court.sports; starts_at ≥ now − 15 min; capacity bounds | pickup; owner attendee; log |
| `deleteEvent` | `cancel_pickup(pickup_id)` | organiser only; not closed | status `cancelled`; notification `cancelled` to every attendee |
| `joinEvent` | `join_pickup(pickup_id)` | status `open`; not organiser; `count(joined) < capacity` under `for update` | attendee `joined`; notification `joined` to organiser |
| `leaveEvent` | `leave_pickup(pickup_id)` | my row is `joined` | row deleted; notification `left` |
| `inviteUserToEvent` | `invite_to_pickup(pickup_id, player)` | **organiser only**; player not already an attendee; not blocked | attendee `invited`; notification `invitation` (actor = inviter) |
| `cancelEventInvitation` | `cancel_invitation(pickup_id, player)` | **organiser only**; row is `invited` | row deleted |
| `acceptEventInvitation` / `declineEventInvitation` | `respond_to_invitation(pickup_id, accept bool)` | my row is `invited`; on accept, capacity | `joined` or deleted; notification `joined` on accept |
| *(timer)* | `pg_cron` every minute: `update pickups set status='in_progress' where status='open' and starts_at <= now()` | — | notification `enter_result` to the organiser (trigger on the status change) |
| `endEvent` | `record_result(pickup_id, team_members uuid[][], set_scores int[][], winning_team smallint)` | organiser only; status `in_progress`; every member is a `joined`/`owner` attendee; each attendee in at most one team | teams; `pickup_attendees.team_id`; status `closed`; `invited` rows dropped; notification `vote_mvp` to each attendee |
| `voteForMvp` | `vote_mvp(pickup_id, votee)` | status `closed`; voter and votee are attendees; voter ≠ votee; one vote (PK) | vote; when all attendees have voted, or by cron 24 h after close: `mvp_id` = top vote, ties broken at random **among the leaders**; notification `you_are_mvp` |
| `markNotificationAsRead` | update `notifications.read_at` (RLS: own) | own rows only | — |
| `putDeviceToken` / `removeDeviceToken` | insert/delete `push_subscriptions` (RLS: own) | — | — |
| `search_users` | `search_players(q text)` → `websearch_to_tsquery` / prefix match on `profiles.search` | parameterised; excludes blocked | — |
| `getEventTeam` (remote schema) | not needed: `pickup_teams.set_scores int[]` is selected directly | — | — |
| *(OpenCourt, new)* | insert `court_reports` (RLS + rate-limit trigger); read `court_availability` | one per court per device per 15 min | report; aggregate updates on read |

Frontend wiring (no build step): `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.x.y/dist/umd/supabase.js">`
pinned to an exact version; `fetchCourts()` reads the `courts_live` view instead of
`assets/data/courts.json` (the JSON file stays as the seed and the labelled offline fallback). The
swap is not literally "one URL": PostgREST returns a bare array (the `.courts` unwrap goes), and
`live_reports` / `last_reported_availability` are not columns of `courts`, so the view computes them
and must return `[]`, never `null`, for `live_reports` (the renderer reads its `.length`).
`submitReport()` becomes an `rpc('submit_report')` call with an error branch for `rate_limited`;
`hydrateReportsIntoCourts()` merges server rows with the device's own last tap. **One decay window:**
90 minutes on both sides (`REPORT_TTL_MINUTES` and the view), superseding FR-25's "~2 h"; the
recency-weighted aggregate can replace "latest wins" later without changing a field name. Before
the first backend read, add a six-line `esc()` helper: every court and, later, player field is
interpolated into `innerHTML` unescaped today. The people screens are new pages under the same shell.
Realtime subscription on `my_notifications` gives live delivery (FR-102) before any push exists.

---

## 6. What is deliberately not ported

- Header-trusted identity; admin-for-everyone Hasura; the Express action tier; the webhook that
  answered 500; in-process `node-schedule` timers; Firebase Auth, Storage and Messaging; the
  service account committed to the public repo (rotate it regardless).
- `locations` (OpenCourt's `courts` is the place), `event_files`, `info_notifications`, the
  `conflict` attendee status, `events.result_info`, the `getEventTeam` remote schema, the
  `friend_status` computed field, string-built `search_users`.
- The iOS client. The PickUp app is retired; the web app is the product. A native wrapper is a
  later question, after Phase 3 is used.
- The 2021 feed, posts, likes, comments and chat screens (Phase 5 at the earliest).

---

## 7. Steps and acceptance

| Step | Deliverable | Acceptance (the gate for the step) |
|---|---|---|
| **M0 — Name and record** (this release) | FOUNDATION, LEGACY, MIGRATION docs; logo assets; CLAUDE.md/AGENTS.md; legacy repos marked frozen; the service-account rotation requested | docs reviewed by the owner; `sh scripts/check.sh` passes; owner rules on the visible rename wording |
| **M0.5 — Baseline hygiene** (before any backend) | **Make the live map work:** the review's headless-browser run of the production page shows Google's "can't load Google Maps correctly" dialog and 0 markers — (a) in the Cloud Console, match the key's referrer pattern to `https://shwinster101.github.io/PickUp/*` (the docs' placeholder path is `opencourt-la`), confirm the Maps JavaScript API is allowed and billing is on; (b) Advanced Markers are created on a map without a `mapId` (20 console errors) — either add a Map ID and move the editorial style to a cloud style, or force the existing `OverlayView` branch in `createMarker` (keeps the style; two lines); reword the report feedback that promises a shared signal ("for anyone using OpenCourt") until M1 delivers one; fix the README/SETUP placeholder repo URLs; make the Pages workflow upload a `_site/` of `index.html` + `assets/` instead of the whole checkout | 20 pins visible on first frame on the live page (SRS §8); the honesty wording matches FR-23; the deployed artifact contains no `docs/`, `working/` or scripts |
| **M1 — Shared courts and reports** (SRS Phase 2) | Supabase project; `courts`, `court_reports`, `courts_live`; anonymous sign-in; rate-limit function; `fetchCourts`/`submitReport` swapped behind a `BACKEND_URL` constant with the JSON fallback; `esc()` helper | two devices see each other's reports; a 2nd report within 15 min is refused; a report older than 90 min no longer colours the court; page still loads with the backend down (fallback labelled "offline data"); the gate passes |
| **M2 — Identity and pickups** | `profiles` with account upgrade from anonymous; `pickups`, `pickup_attendees`, `event_log`, `notifications` for `joined` / `left` / `cancelled` / `enter_result`; `create_pickup`, `join_pickup`, `leave_pickup`, `cancel_pickup`; the `pg_cron` start job; the shareable link; the court page lists its open pickups and the map marks them | the pytest flows for join/leave/delete/start pass against the new API; join at capacity refused; cancel stops the start; a link opens a pickup without an account; an anonymous reporter upgrades and keeps their reports; the RLS matrix is green |
| **M3 — Friends, invitations, results and standing** | `friendships` + views, `search_players`, `invite_to_pickup`, `cancel_invitation`, `respond_to_invitation`, `pickup_teams`, `mvp_votes`, `record_result`, `vote_mvp`, `player_standing`, the remaining notification kinds | the friend and invitation pytest flows pass; the result records team members; MVP chosen among leaders only; one vote, not self; notifications arrive by trigger; cross-user writes refused |
| **M4 — Delivery** | realtime inbox; "I'm here, need a 4th"; web push via an edge function holding the VAPID secret; share cards | an invitation reaches a second browser without reload; a push arrives with the page closed |
| **M5 — Second metro** | city picker; SF/NYC/SD seed | no schema change needed |

Each step lands with a dated `working/` note carrying its Outcomes section (what shipped, what
the plan got wrong, the commit SHAs), per `CLAUDE.md`.

---

## 7b. Build status (v1.3.0, 2026-10-18; first written at v1.2.0)

| Step | Status | Evidence |
|---|---|---|
| M0.5 | 🔶 pins restored (OverlayView; `GOOGLE_MAP_ID` opt-in) and on PR #1; honesty wording; `esc()`; the share-link highlight now survives re-renders. **Still owner's:** billing on the Maps project (referrers and API restriction verified right on 2026-10-17); README/SETUP placeholder URLs; a Pages `_site/` artifact | `assets/js/app.js`, headless runs in the working notes |
| M1 | ✅ built and tested; ⬜ provisioned | `supabase/migrations/0001`, `test/backend/t_010` (25); `scripts/provision-supabase.sh` ready |
| M2 | ✅ built, tested, on the page (pickups, invitations, inbox, share link); ⬜ provisioned | `0002`, `t_020` (71), `assets/js/backend.js`, `test/browser/check-backend.cjs`, `test/e2e/two-browsers.cjs` 8/8 on the stand-in |
| M3 | ✅ SQL built and tested; ✅ screens (Mine, Enter result, Vote MVP, Friends, Invite, You/standing); ⬜ provisioned | `0003`, `t_030` (71); `check-backend.cjs` M3 steps |
| M4 | 🔶 realtime publication (`0005`, `t_040` 15) and channel with honest fallback; Keep this account · magic-link sign-in · Sign out. ⬜ push, share cards, "I'm here, need a 4th". Delivery and the email round trips are provable only on a real project | `0005_realtime.sql`, `backend.js subscribe()`, `check-backend.cjs` (SUBSCRIBED and CHANNEL_ERROR contexts) |
| M5 | ⬜ | — |
| Provisioning | ✅ scripted and tested against a mock (40 assertions); ⬜ run for real (no token in the build environment) | `scripts/provision-supabase.sh`, `test/provision/` |
| The proof | ✅ two browsers share a report, a pickup, a join, an inbox line and a share link on the local stand-in (3 runs, 8/8); ✅ on the real project 2026-10-18 (8/8 on the second run) | `test/e2e/local-backend.py`, `local-stack.sh`, `smoke-local-backend.sh` (44), `two-browsers.cjs` |
| Limits & measure (v1.4.0) | ✅ `0006` built and tested (`t_050`, 38); ⬜ applied to the live project (owner: `supabase/README.md`, "After v1.4.0") | the audit probes flip: `working/2026-11-07-limits-usage-next-tier.md` |

> **2026-11-07:** the project `pickup` has been live since 2026-10-18 (M1–M4 provisioned, `a04ce05`); the
> ⬜ provisioned marks above are history. Row "Anonymous abuse of pickups" in §8 is superseded twice: by
> the v1.2.0 ruling (a profile on an anonymous session is enough) and by `0006`'s per-player limits.

Deviations from the plan above, each recorded as a ruling in `docs/project-conventions.md`: a
profile on an anonymous session is enough to play; notifications are written inside the RPC
transaction (not by table triggers; same guarantee, no second request); M3 landed as SQL before M2
had its screens finished because the tests made it cheap; at v1.3.0 realtime carries three tables and
not reports (author-only RLS), and the acceptance test and the provisioning are scripts.

## 8. Risks and open decisions

| Risk / decision | Position | Owner call needed |
|---|---|---|
| Visible name on the page | Keep "OpenCourt LA" as the catalogue name under a PickUp wordmark until ruled | yes, before M1 ships |
| Supabase vs the owner's Cloudflare stack | Supabase per the SRS; model ports either way | only if the owner wants to revisit |
| Anonymous abuse of pickups | Pickups require a non-anonymous account; reports do not | no |
| Free-tier pausing (Supabase pauses idle free projects after a week) | a weekly keep-alive read from the Pages workflow, or the paid tier (< $10/mo per NFR-06) | yes, at M1 |
| Sports list | start with `tennis`, `pickleball`, `basketball`; add by migration when a court carries the sport | no |
| PostGIS for "near me" | not needed at 20–50 courts (haversine in SQL or in the browser); add the extension when a metro passes a few hundred courts | no |
| Advanced Markers without a `mapId` | Verified in headless Chromium on 2026-10-17: the map renders, the pins do not (0 markers, 20 "without a valid Map ID" errors). A Map ID disables the JSON `styles` the page uses, so the choice is style-in-cloud + Map ID, or the existing `OverlayView` path | which of the two (M0.5) |
| Pages publishes the whole checkout | `upload-pages-artifact` with `path: '.'` serves `docs/`, `working/`, this plan and the push script at the public URL; harmless today, a habit worth breaking before any `.env` exists | no (M0.5) |
| The 2021 service account | compromised by publication; disable it in the Google Cloud project even though the project is retired | yes (owner has the console) |
| Cascades | 2021's `set_fk_*` migrations made `events.mvp_id`, `status`, `winner_id` and `event_teams.event_id` cascade on delete, so deleting a user deleted the events they were MVP of. The new schema cascades only from `pickups` downward; a deleted profile leaves its games with a null `mvp_id` | no |
| Port the final function bodies only | `end_event` and `search_users` were each rewritten more than ten times by `CREATE OR REPLACE`; the migration chain is forward-only. `record_result` and `search_players` are written fresh from the final intent, not copied | no |
