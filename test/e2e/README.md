# test/e2e — two real browsers, one shared state, no Supabase project

The page's backend is Supabase (PostgREST + GoTrue over Postgres under row-level security). Until
the owner provisions a project, nothing here can be *shared* between two browsers — unless a local
stand-in speaks enough of those two APIs over the real migrations. This folder holds that stand-in
and the end-to-end checks that use it.

| File | What it is |
|---|---|
| `local-backend.py` | the stand-in: a PostgREST + GoTrue subset in Python 3 standard library, over a throwaway PostgreSQL that carries `test/backend/shim.sql`, every `supabase/migrations/*.sql` and `supabase/seed.sql` |
| `local-stack.sh` | `start` / `stop` / `status` for the three processes: the cluster, `local-backend.py`, and `python3 -m http.server` for the page |
| `smoke-local-backend.sh` | the curl walk through the page's own flow (44 checks); PASS/FAIL per line, non-zero on any FAIL |
| `.stack/` (gitignored) | pids, logs (`backend.log`: one line per request), `pg.env`, `urls.env` |

## Run it

```sh
sh test/e2e/local-stack.sh start      # ~5 s: cluster on 54410, backend on 54400, page on 8020
sh test/e2e/smoke-local-backend.sh    # 44 PASS lines, "smoke: 44 passed, 0 failed"
sh test/e2e/local-stack.sh status
sh test/e2e/local-stack.sh stop       # kills page, backend, cluster; removes the cluster directory
```

`start` prints the values a browser test routes into the page (the real `assets/js/config.js`
**stays empty**; tests intercept `**/assets/js/config.js` as `test/browser/check-backend.cjs` does):

```
OC_SUPABASE_URL=http://127.0.0.1:54400
OC_SUPABASE_ANON_KEY=local-anon
OC_PAGE_URL=http://127.0.0.1:8020/
```

Ports and paths: `OC_PGPORT` (54410), `OC_BACKEND_PORT` (54400), `OC_PAGE_PORT` (8020), `PGBIN`
(`/usr/lib/postgresql/16/bin` or the newest found). Needs PostgreSQL 16 server binaries, `psql`,
`python3`, `curl`, and `node` for the seed check (`/opt/node22/bin` is added to PATH when present).
As root the cluster runs as the `ubuntu` user under `/tmp/opencourt-pg.*` (the pattern of
`test/backend/run.sh`); `start` refuses to run twice (`stop` first).

The cluster comes from `test/backend/run.sh` with `KEEP=1`: the same shim, migrations and seed as
the backend test leg, then it stops **before** the `t_*.sql` files (so no test data is in the shared
database) and prints a `KEEP PGHOST=… PGPORT=…` line instead of tearing down. Without `KEEP` the
script is unchanged; `sh scripts/check.sh --backend` still passes.

## What the stand-in serves

Database access is a **`psql` subprocess per request** (psycopg2 is not installed on this machine;
the script says so in its header). Every request value travels as a psql variable (`-v vN=…`) and is
written into SQL as `:'vN'`, which psql quotes as a literal for the connection's settings;
identifiers are checked against the catalog (`pg_class`/`pg_attribute`, `pg_proc`) and
double-quoted. Nothing from a request is spliced into SQL text. Each request is one transaction:

```sql
begin [read only];
select set_config('request.jwt.claims', '<claims json>', true);   -- what shim.sql's auth.uid() reads
set local role anon | authenticated;                               -- the real database roles
<the one statement>;
commit;
```

so RLS, grants and `auth.uid()` behave as on Supabase. A request with no bearer token, or with the
anon key as its token (what supabase-js sends before sign-in), is `anon`.

### GoTrue (`/auth/v1`) — paths and bodies read from the supabase-js 2.45.4 UMD source

| supabase-js call | request | answer |
|---|---|---|
| `auth.signInAnonymously()` | `POST /signup` `{data, gotrue_meta_security}` (no email) | a session: `{access_token, token_type: "bearer", expires_in: 3600, expires_at, refresh_token, user}`; a row in `auth.users` with `is_anonymous = true` |
| `auth.getSession()` (expired) / the refresh timer | `POST /token?grant_type=refresh_token` `{refresh_token}` | a fresh session for the same user and `session_id` |
| `auth.getUser()` | `GET /user` (bearer) | the user `{id, aud, role, email, new_email, is_anonymous, app_metadata, user_metadata, created_at, …}` |
| `auth.updateUser({email})` | `PUT /user` `{email, code_challenge…}` (bearer) | the user with `new_email` set; **no mail exists here**, the email is never confirmed |
| `auth.signInWithOtp({email})` | `POST /otp?redirect_to=…` | `200 {}`; **no mail is sent** |
| `auth.signOut()` | `POST /logout?scope=global` | `204`; the user's refresh tokens are forgotten |
| — | `GET /settings`, `GET /health` | `{external: {anonymous_users: true, email: true}}`, a name |

Tokens are HS256 JWTs under a fixed **test** secret (claims `aud`, `role`, `sub`, `is_anonymous`,
`email`, `iat`, `exp` = 1 h, `session_id`, `aal`, `amr`). supabase-js stores the session under
`localStorage["sb-127-auth-token"]` (hostname `127.0.0.1` → `127`) per page origin, so two
Playwright contexts, or two browsers, are two users. Errors use GoTrue's 2024-01-01 shape
`{code, error_code, msg}`; a refresh with an unknown token answers `400 refresh_token_not_found`, on
which supabase-js drops the stored session (a stale browser profile after a stack restart recovers
by signing in anonymously again on the next write).

### PostgREST (`/rest/v1`) — generic over schema `public`

Any **view or table** in `public` answers `GET /rest/v1/<relation>` with `select=*` or a comma list
of columns (`alias:column` allowed), filters `<col>=eq.|neq.|gt.|gte.|lt.|lte.|like.|ilike.|is.null|
is.true|is.false|in.(a,b)` and `not.<op>`, `order=<col>.asc|desc[.nullsfirst|nullslast]` (comma
list), `limit`, `offset`. `Prefer: count=exact` puts the total in `Content-Range` (exposed through
CORS). `Accept: application/vnd.pgrst.object+json` returns one object or `406 PGRST116` with
`details: "The result contains N rows"` (supabase-js's `.maybeSingle()` turns 0 rows into `data:
null`; on `GET` it sends `Accept: application/json` and picks the row itself). Not served: embedded
resources `a(b)`, `and=()`/`or=()`, full-text and array operators, and **writes on tables** (`POST`,
`PATCH`, `DELETE` answer `405`; the page writes only through RPC — `docs/project-conventions.md`).

Any **function** in `public` answers `POST /rest/v1/rpc/<fn>` with a JSON object of named
arguments. The argument types come from `pg_proc`, so the body is bound as
`json_to_record(body) as _("p_x" uuid, "p_ids" bigint[], …)` and the call is
`public.fn(p_x => …, …)`; missing arguments take their SQL defaults, an unknown name or a missing
required argument is `404 PGRST202`. The answer follows the function's declared return:
`setof` / `returns table` → a JSON array, a row type → one object, a scalar → the bare JSON value
(`true`, `"none"`, `1`), `void` → `204`. `GET /rpc/<fn>?a=b` works for stable functions.

SQL errors are `{"code": <sqlstate>, "message", "details", "hint"}`; `backend.js`'s `wrap()` reads
`message` (the `raise exception 'rate_limited'` names). Status by SQLSTATE as PostgREST maps it:
`42501` → **403**, or **401** when the caller is anon; `P0001` (a bare `raise exception`), `22023`, `42703`
and the rest → 400; **every other `P0*` → 500** (the migrations' `errcode = 'P0002'` for `unknown_pickup`,
`no_request`, `not_friends` … answers 500 on Supabase too, with the name in `message`, which is all the
page reads); `23503`/`23505` → 409; `40*` → 500; `42P01`/`42883` → 404; `PT<nnn>` → nnn; unknown relation
→ `404 PGRST205`; invalid or expired JWT → `401 PGRST301`. The table is `pg_status_for` in
`local-backend.py`, mirrored from PostgREST v12.2.3's `pgErrorStatus`.

Grants decide what anon sees, from the migrations: `courts_live`, `open_pickups`, `pickups`,
`pickup_teams` and `pickup_by_token()` answer anon; `my_notifications`, `my_pickups`, `profiles`,
`friendships`, `mvp_votes`, `player_standing` and every writing function are granted to
`authenticated` only, so anon gets `permission denied` (42501) → **401** (the smoke asserts this
for `my_notifications`).

### Every call `assets/js/backend.js` makes, and how it lands here

Reads (`from(...).select(...)`): `courts_live` (`order=name.asc`), `profiles` (`id=eq.<uid>`
maybeSingle; `id=in.(…)`), `open_pickups` (`court_id=eq.`, `order=starts_at.asc`), `my_pickups`,
`my_notifications` (`read_at=is.null`, `order=created_at.desc`, `limit`), `friendships`,
`mvp_votes`, `pickup_teams` (`pickup_id=eq.`, `order=team_no.asc`), `player_standing`
(`player_id=eq.` maybeSingle). RPC: `submit_report`, `upsert_profile`, `create_pickup`,
`join_pickup`, `leave_pickup` (void), `cancel_pickup`, `respond_to_invitation` (void),
`pickup_by_token` (table), `pickup_roster` (table), `mark_notifications_read` (`bigint[]` → integer),
`search_players`, `friend_status` (text), `send_friend_request` (text), `accept_friend_request`,
`reject_friend_request`, `cancel_friend_request`, `remove_friend` (void), `my_friends`,
`incoming_friend_requests` (setof profiles, `{}` body), `invite_to_pickup`, `cancel_invitation`
(void), `record_result` (`uuid[]`, `integer[]` arguments → pickups row), `vote_mvp` (boolean).
Auth: `getSession`, `signInAnonymously`, `signInWithOtp`, `updateUser`, `signOut`,
`onAuthStateChange` (client-side). A new view or function in a later migration needs no change
here: the catalog is re-read every 10 s and on any miss.

**Realtime is not served.** `client.channel(...).subscribe()` (M4) opens
`ws://127.0.0.1:54400/realtime/v1/websocket`, which answers `404`; realtime-js retries with
backoff (1 s, 2 s, 5 s, then every 10 s) and Chromium logs each failed handshake as a console
error. The page never reaches `SUBSCRIBED`, so it keeps polling (inbox 60 s, courts 5 min) and
shows no "· live"; a browser test that counts console errors should ignore
`/realtime/v1/websocket` (and the `4xx` that Chromium logs for every refused fetch, such as the
rate-limited second report). Also not served: storage, edge functions, mail of any kind.

### Verified here (2026-10-17)

- `sh test/e2e/smoke-local-backend.sh`: 44/44 on a fresh stack and again on the same database
  (it picks a free court with no reports and no games yet, and unique usernames per run).
- The real page with the real `supabase-js@2.45.4` in headless Chromium (config.js routed to the
  values above): `#data-source` reads "Shared data"; `ensureSession` → anonymous user;
  `submitReport` → `open`, the second one → `rate_limited`; `upsertProfile`, `createPickup`,
  `listPickups`, `myPickups` (`owner`), `notifications`, `fetchCourts` (`live_reports` 1,
  `open_pickup_count` 1), `friendStatus` → `none`, `roster`, `myStanding` (maybeSingle), all
  answered; the session survives a reload (`sb-127-auth-token`) as the same user.
- `sh scripts/check.sh --backend` after the `KEEP` change: `BACKEND TESTS PASSED (182 assertions)`.

## Limits, plainly

A stand-in, for this machine: no realtime, no mail, no OAuth, no storage, a fixed test JWT secret,
refresh tokens in memory (gone when the backend restarts), one `psql` process per request (~15–40
ms). It proves the page and the SQL agree; it does not prove Supabase's own PostgREST, GoTrue or
Realtime configuration — that needs the provisioned project (`supabase/README.md`,
`scripts/provision-supabase.sh`).

## Two browsers, one proof: `two-browsers.cjs`

The owner's acceptance line, as a script: *open two browsers and confirm a report on one appears on
the other* — and a pickup created in one and joined from the other. Two isolated Chromium contexts
(fresh storage each, so two anonymous users) walk the real page with the real `supabase-js`; each
step prints `PASS`/`FAIL` with the observed text, a step whose prerequisite failed prints
`FAIL … not run`, both browsers are screenshotted on any failure, a JSON summary ends the output, and
the exit code is 1 on any `FAIL` (`SKIP` is not a failure).

| Step | What must be seen |
|---|---|
| 1 | A loads; `#data-source` reads "Shared data" (20 s); the court list has 20 rows |
| 2 | A opens the court and taps **Open**; feedback "Thanks. Marked as open just now — shared with everyone for 90 min."; status source "◉ Live signal" |
| 3 | B loads fresh, opens the same court: "◉ Live signal", "Likely open", "Reported N min ago by a player on the ground.", and *Recent reports* = what A saw before its tap + 1 (B reported nothing) |
| 4 | A starts a pickup (the name prompt first, then the form with a note, two hours ahead); the row reads "1/4 players · by Ada … · yours · …" |
| 5 | B reloads, opens the court: A's row with a **Join** button; B joins (its own name prompt); "You’re in. The organiser has been told."; the row reads "2/4 players … · you’re in" |
| 6 | A reloads: the row reads "2/4 … · yours" (the session survived); the inbox badge reads 1; the item reads "Bo … joined your pickup at <court> (…)" |
| 7 | A's **Mine** sheet lists the pickup: chip `open`, "… · 2/4 · yours", actions invite · link · cancel (SKIP when `index.html` has no `#mine-btn`) |
| 8 | B opens `#pickup=<token>` (token from `Backend.myPickups()` in A) as a fresh page load: the detail panel opens on that court with the row highlighted |

`maps.googleapis.com` is aborted in both contexts, so the proof never depends on Google Maps or the
key: `app.js` renders the list before the map, `renderMarkers()` returns without one, and
`selectCourt()` only pans when a map exists. Console errors are collected per browser and reported
in the summary, minus the realtime handshake the stand-in refuses and Chromium's generic line for a
refused fetch (`IGNORE_CONSOLE` in the script).

Environment: `OC_PAGE_URL` (default `http://localhost:8020/`); `OC_SUPABASE_URL` and
`OC_SUPABASE_ANON_KEY` — when **both** are set, `**/assets/js/config.js` is routed in every context to
a config with those values (`GOOGLE_MAP_ID ""`, `METRO "LA"`; the file on disk is never touched), when
unset the page's own `config.js` is used; `OC_COURT` (default the first free-tier court in
`assets/data/courts.json`, `memorial-park-sm`; a private court is refused); `OC_SCREENSHOT_DIR`
(default `<tmpdir>/opencourt-two-browsers`); `OC_STEP_TIMEOUT_MS` (default 30000).

Playwright is a tool on the machine that runs the proof, not a dependency of the repository (there is
no `package.json`): `require('playwright')` must resolve — `NODE_PATH` on this machine, elsewhere
`npm i -g playwright && npx playwright install chromium`.

### Against the stand-in (this machine)

```sh
sh test/e2e/local-stack.sh start
OC_SUPABASE_URL=http://127.0.0.1:54400 OC_SUPABASE_ANON_KEY=local-anon OC_PAGE_URL=http://127.0.0.1:8020/ \
  NODE_PATH=/opt/node22/lib/node_modules:/opt/node-tools/node_modules node test/e2e/two-browsers.cjs
sh test/e2e/local-stack.sh stop
```

Verified 2026-10-17: 8 passed, 0 failed, 0 skipped, no console or page errors, on a fresh stack and
again on the same database (the second run sees A's *Recent reports* go 1 → 2 and the first run's
pickup still on the court). Each run leaves two anonymous users (`ada_<pid>…`, `bo_<pid>…`), one
report, one open pickup with two on its roster and one read-or-unread notification; re-runs are safe
because the names are unique per run and the report check is relative. Without the backend values the
script fails honestly at step 1 (`#data-source reads "Offline data · reports stay on this device"`),
marks 2–8 "not run", writes the screenshots and exits 1.

### Against the real project, the minute it exists

Serve the repository and route the page to the project (`assets/js/config.js` stays as committed):

```sh
python3 -m http.server 8000 --directory . >/dev/null 2>&1 & echo $! > /tmp/oc-page.pid
OC_PAGE_URL=http://localhost:8000/ \
OC_SUPABASE_URL=https://<project-ref>.supabase.co OC_SUPABASE_ANON_KEY=<the project's anon key> \
  node test/e2e/two-browsers.cjs
kill $(cat /tmp/oc-page.pid)
```

Or, once `config.js` is filled on `main` and Pages has deployed, with no `OC_SUPABASE_*` at all (the
page's own config is the thing under test):

```sh
OC_PAGE_URL=https://shwinster101.github.io/PickUp/ node test/e2e/two-browsers.cjs
```

**Caution (2026-11-07 audit):** against the real project the proof writes real data that every visitor sees:
an "Open" report on the court (shown as a live signal for 90 minutes), a pickup with the two throwaway players
on the map, and two anonymous users who cannot be deleted while they organise a pickup
(`pickups_organiser_id_fkey`). Nothing cleans it up. The 2026-10-18 run left two pickups and two reports on
Memorial Park. Pick a quiet hour, or a separate project, until the proof cancels what it creates.

The anon key is a publishable client credential (`docs/MIGRATION.md` §3); it goes in the command's
environment, never in a file of this repository. On the real project `#data-source` may read "Shared
data · live" (the realtime channel is SUBSCRIBED); the script accepts both. What this proof still does
not cover: realtime itself (B reloads rather than waiting for a push) and anything that needs mail.
