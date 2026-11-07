# PickUp — Foundation

**Issue · goal · vision · mission · personas · user stories · workflow · fundamental requirements**

**Version 1.4.0 · 2026-11-07 · Status: adopted as the north star for the PickUp → OpenCourt migration; the shared backend (M1–M3 SQL and screens, M4 realtime + account) is built, proven in two browsers against a local stand-in, and live on the Supabase project `pickup` since 2026-10-18 (v1.3.1).**

> **Correction (2026-11-07 audit):** this line and every "awaiting the project" in §5's status column were
> true until 2026-10-18; the project has been live since then. Two qualifiers the column does not show: the
> account stories (keep / sign in by email) cannot work until the project sends mail beyond its own team and
> its redirect URLs name `/PickUp/`, and nothing measures whether any story is used, which §8's Phase 5
> gate needs. Evidence: `working/2026-11-07-audit.md`.
Owner ruling (2026-10-17): *"OpenCourt is the modern successor — though keeping the PickUp namesake
and logo will be the path forward: migration of PickUp backend flow to the OpenCourt structure and
working APIs."*

This document states what PickUp is for and what it must do. It is written from the record: the
2021 iOS app (`PickUpBois/PickUp`), its backend (`PickUpBois/PickUpHasura`, all backend commits by
Arian Rahbar), and the 2026 court finder in this repository. Every statement below is tagged
**EVIDENCE** (the code or a document says it) or **INFERENCE** (a reading of the evidence) or
**RULING** (the owner decided it). Companion documents: [`LEGACY_PICKUP_BACKEND.md`](./LEGACY_PICKUP_BACKEND.md)
(what the 2021 backend did), [`MIGRATION.md`](./MIGRATION.md) (how it moves here),
[`REQUIREMENTS.md`](./REQUIREMENTS.md) (the court-finder SRS this document extends).

---

## 1. The issue

Recreational court sports lose games to two frictions, and every tool so far has attacked only one.

| Friction | What the player experiences | Who attacked it | Evidence |
|---|---|---|---|
| **WHERE** — a free, public court that is actually open, near me, now | Search results skew to paid and private facilities; weekday-evening availability is unpredictable; LA sits far below national court density | OpenCourt LA (2026): 20 curated courts, a heuristic open/toss-up/full score, three-button crowd reports | `docs/PROJECT_BRIEF.md` "Problem"; `docs/RESEARCH_NOTES.md` |
| **WHO** — people to play with, at my level, at that court, at that time | Games are organised in group chats; no roster, no capacity, no record of who showed up or who won | PickUp (2021): friends, pickups with capacity, invitations, join/leave, set scores, MVP vote, notifications | `PickUpHasura` schema and 19 actions; `PickUp/views/*` |
| **The loop** — from "where can I play?" to "we played, here's the score" | Nobody closes it. The court app does not know about the game; the game app does not know about the court. PickUp's court screen was demo data; OpenCourt's matchmaking is a roadmap line | — | `PickUp/views/nearme/CourtsNearBy/CourtsNearMeView.swift` (ten hard-coded places); `docs/ROADMAP.md` Phase 3 |

**Root cause (INFERENCE).** Both products modelled half the entity graph. PickUp had `events`,
`event_attendees`, `relationships`, `notifications` and an unused `locations` table; OpenCourt has
`courts` and `live_reports` and no notion of a person. The missing join is **a pickup happens at a
court**, and the missing identity is **a player who is the same person on both halves**.

**What PickUp 2021 was, in its own words (EVIDENCE).** Bundle `PickUpBois.PickUpSportsApp`;
tabs Home · Search · Event · NearMe · Profile; copy reads "Create Pickup", "Invite Friends",
"Find teammates", "Team Members", "GOAT"; sign-up asks first name, last name, username, email,
password; the profile carries a `college`; the enum of sports is `tennis` and `basketball`;
the icon strip shows sixteen sports (assets `b1`–`b16`); the wordmark spells PickUp in six
colours with a ball in every letter. The team was plausibly a college friend group building for
its own campus and gyms (INFERENCE, circumstantial: the GitHub organisation `PickUpBois`, an
optional `college` column that the shipped sign-up never populated, the backend author's `usc.edu`
address, an unused Iowa State campus-map asset and the mock venue "State Gym", commit timestamps
in US Central time; nothing in the code targets a campus). Friends are called **"Teammates"**
throughout the UI; a pickup is a scheduled game
with a capacity ("e.g. 4 (doubles)"), scored in sets; the backend nags the organiser to close the
game with a result. No written problem statement exists in either 2021 repository (the README is an
Xcode tutorial, the backend README is empty): the issue is reconstructed from what was built first
and tested.

---

## 2. Goal, vision, mission

- **Goal (RULING + INFERENCE).** One product, **PickUp**, that takes a player from *"where can I
  play?"* to *"I'm on my way"* to *"we played — here's the score"*, in the fewest taps, in Los
  Angeles first. The court finder that already ships is the front door; the 2021 people flow,
  rebuilt on working APIs, is the house.
- **Vision.** Every public court in a city is known, its availability is readable in real time,
  and any player can find a game on it within minutes: a living map of open courts and open games,
  kept honest by the players standing on them.
- **Mission statement.** *Turning "where can I play?" into "I'm on my way."* (OpenCourt's line,
  kept verbatim, EVIDENCE: `README.md`.) **Proposed extension, pending the owner's wording:**
  *…and "who's playing?" into "we're on."*
- **Alternative mission line, reconstructed from the 2021 record (INFERENCE):** *Find an open
  court, pick up a game, keep the score.*
- **Taglines on the table (INFERENCE; pick one or none):** "Open courts, open games." ·
  "Find the court. Find the game." · "Pick a court. Pick a team. Keep score." · "Anyone down to
  play? Now there's a button." · "PickUp — where LA plays."

---

## 3. Name, logo, repository (RULING)

> **Landed 2026-10-18 (v1.3.1):** the page header now leads with the PickUp wordmark and keeps "OpenCourt LA"
> as the sub-line; the page title reads "PickUp — OpenCourt LA". The owner took the recommended wording.

| Item | Ruling | Where |
|---|---|---|
| Product name | **PickUp** | Everywhere a user reads it |
| Structure / codebase / repository name | **OpenCourt** (`shwinster101/PickUp`); "OpenCourt LA" remains the name of the LA court catalogue and may stay as a sub-brand or section title | This repository |
| Logo | The 2021 PickUp wordmark (581×197, six-colour letters with sports balls) and the "P" app icon, carried byte-identically | `assets/img/pickup-logo.png`, `assets/img/pickup-icon-1024.png` (sources: `PickUp/Assets.xcassets/logo.imageset/Logo.png`, `AppIcon.appiconset/Picture3-1024.png`) |
| Legacy repositories | `PickUpBois/PickUp` and `PickUpBois/PickUpHasura` are frozen references; nothing new is built there | Their `CLAUDE.md` files say so |
| Visible rename of the live page | **Open decision.** The header still reads "OpenCourt LA". Wording to rule on: "PickUp" alone · "PickUp · OpenCourt LA" · "PickUp LA" | `index.html` brand mark; first change of migration step M0 |

---

## 4. Personas

| # | Persona | Need | Source |
|---|---|---|---|
| P1 | **Solo player** (the owner, a roommate) | "Where can I play in the next 30 minutes?" | `REQUIREMENTS.md` §2 |
| P2 | **Organiser** (2021's event owner) | Put a pickup on a court at a time with a headcount, invite friends, run the game, record the result | `createEvent`, `inviteUserToEvent`, `endEvent` |
| P3 | **Teammate / friend** | Be found by username, accept or decline invitations, join open games, keep a record | `search_users`, `acceptEventInvitation`, `joinEvent`, past pickups |
| P4 | **Looking-for-a-4th player** | "Who is at a court near me right now, at my level?" | `ROADMAP.md` Phase 3 FR-50 |
| P5 | **Court steward** (any player on the ground) | Report open / mixed / full in under five seconds, no form, no account | FR-30, FR-35 |
| P6 | **Multi-city player** | The same tool in SF, NYC, SD | `metro` on every record, Phase 4 |

Identity across personas: P5 reports anonymously; P2–P4 need a durable identity. The migration
therefore starts with an anonymous device identity and lets a player upgrade it to an account
without losing history (`MIGRATION.md` §3).

---

## 5. User stories

Status columns: **2021** = what the PickUp iOS app and backend actually delivered
(`implemented` · `partial` · `placeholder` · `broken` · `—` not attempted), from the
2026-10-17 review; **Now** = OpenCourt at v1.0.1 (`✅` shipped · `⬜` not built);
**Phase** = where it lands (`1` court finder, `2` shared backend, `3` people & pickups,
`4` multi-city, `5` social layer, `×` dropped).

### Epic A — Find a court

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-A1 | As a player I want courts shown on a map with a synced list so that I can pick one near me. | placeholder (Apple Maps text search only) | ✅ FR-01–03 (pins redrawn through OverlayView in v1.2.0; the Maps key itself is the owner's console check) | 1 |
| US-A2 | As a player I want each court's tier (free / low-cost / private), court count, sport(s), notes and directions so that I know what I'm walking into. | — | ✅ FR-04–05, FR-10 | 1 |
| US-A3 | As a player I want to filter by sport, tier and likely status so that the list is short. | placeholder (filter buttons were no-ops) | ✅ FR-11–14 | 1 |
| US-A4 | As a player I want courts/gyms near me with hours and how busy they are so that I can pick a venue. | placeholder (ten hard-coded places, "BusyBars") | ✅ heuristic; ⬜ hours | 1→2 |
| US-A5 | As a player I want the same product in another metro so that it travels with me. | — | ⬜ (schema ready) | 4 |

### Epic B — Know if it's open

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-B1 | As a player I want a three-state read (likely open / toss-up / likely full) with its source named so that I trust it exactly as much as I should. | — | ✅ FR-20–24 | 1 |
| US-B2 | As a court steward I want to report Open / Mixed / Full in one tap so that others benefit. | — | ✅ locally (FR-30–33) | 1 |
| US-B3 | As a player I want everyone's reports, not just my own device's, so that the signal is real. | — | 🔶 built (v1.2.0 `courts_live` + `submit_report`); awaiting the Supabase project | 2 |
| US-B4 | As a player I want reports rate-limited and decaying so that the signal cannot be gamed or go stale. | — | 🔶 built (15-min limit in `submit_report`, 90-min decay in the view); awaiting the project | 2 |

### Epic C — Be someone

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-C1 | As a new player I want to sign up with name, username and a login so that I have a PickUp identity. | partial | 🔶 built: name + username on an anonymous session (`upsert_profile`); email link later | 3 |
| US-C2 | As a player I want to use the app and report courts without an account so that the first visit costs nothing. | — | ✅ (no accounts) | 1→2 |
| US-C3 | As a player I want to upgrade my anonymous identity to an account without losing my reports and games so that I am not punished for starting light. | — | 🔶 built: *Keep this account* in the You sheet (`auth.updateUser` keeps the id; `is_anonymous` refreshes on the next `upsert_profile`); the email round trip needs the real project | 3 |
| US-C4 | As a player I want a profile with photo, name, username, home court or neighbourhood and a skill self-rating so that others recognise me. | implemented (photo, name, username, college); placeholder (skill) | 🔶 name, username, skill, metro built; photo later | 3 |
| US-C5 | As a player I want to log out and sign back in on another device so that my identity is mine, not the phone's. | implemented | 🔶 built: *Played before? Sign in* (magic link, no new accounts) and a two-tap Sign out for permanent accounts; provable only on the real project | 3 |
| US-C6 | As a player I want to block or report another player so that I feel safe. | placeholder | ⬜ | 3 |

### Epic D — Build a team

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-D1 | As a player I want to search players by name or username so that I can find teammates. | implemented (`search_users`) | 🔶 built: Friends panel search (`search_players`, debounced); awaiting the project | 3 |
| US-D2 | As a player I want to send, accept, reject and cancel friend requests so that my team is consensual. | implemented | 🔶 built: + Add · Requested ✓ (tap cancels) · Accept/Decline · Friends ✓, over the six SQL functions; awaiting the project | 3 |
| US-D3 | As a player I want to remove a friend so that my team stays current. | implemented | 🔶 built: Friends ✓ → two-tap Remove; awaiting the project | 3 |
| US-D4 | As a player I want to see a friend's team members so that I can discover players. | implemented | 🔶 built: the friends list (`my_friends()`); a friend's own friends are not shown (owner call); awaiting the project | 3 |

### Epic E — Put a game on a court

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-E1 | As an organiser I want to create a pickup **at a court** with sport, start time, headcount and a note so that others can find and join it. | partial (court never saved; sport hard-coded tennis) | 🔶 built: `create_pickup` + the court-panel form (court, sport from the court's list, time, players, note); awaiting the project | 3 |
| US-E2 | As an organiser I want to see and edit my open pickups so that I can manage them. | implemented (list); placeholder (edit) | 🔶 `my_pickups` + cancel built; edit not yet | 3 |
| US-E3 | As an organiser I want to delete a pickup and have attendees told so that nobody shows up. | implemented (delete); the notification was never sent | 🔶 built: `cancel_pickup` notifies every attendee | 3 |
| US-E4 | As an organiser I want to invite friends and cancel invitations so that the roster fills. | implemented | 🔶 built: + Invite from Mine or the court panel (friends not yet on the roster), ✕ cancels an invitation, inbox Accept / Decline; awaiting the project | 3 |
| US-E5 | As a player I want to browse upcoming pickups near me, filtered by sport, time and spots left, so that I can find a game. | partial (all events, no filters, "0.25 miles" constant) | 🔶 per-court list and map marks built; a cross-court board with filters later | 3 |
| US-E6 | As a player I want to join or leave an open pickup, within its capacity, so that my attendance counts. | implemented (capacity never enforced) | 🔶 built: `join_pickup` enforces capacity under a row lock; awaiting the project | 3 |
| US-E7 | As an invitee I want to accept or decline an invitation from my notifications so that the organiser knows. | implemented | 🔶 built: inbox Accept / Decline | 3 |
| US-E8 | As a player I want to say "I'm here, looking for a 4th" at a court so that walk-ups can find me. | — | ⬜ FR-50 | 3 |
| US-E9 | As a player I want a shareable link to a pickup so that a group chat can join without the app. | — | 🔶 built: Copy link → `#pickup=<token>` opens the court and highlights the pickup | 3 |

### Epic F — Play, record, rank

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-F1 | As an organiser I want the pickup to start by itself at its time so that the record reflects reality. | implemented (in-process timer, lost on restart) | 🔶 built: `start_due_pickups()` on `pg_cron` | 3 |
| US-F2 | As an organiser I want to enter teams, set scores and the winner after the game so that the result is recorded. | implemented (team membership was discarded) | 🔶 built: Enter result in Mine (roster → two teams by tap, sets as "6-4 3-6 10-7", winner); `record_result` keeps team membership; awaiting the project | 3 |
| US-F3 | As an attendee I want to vote for the MVP, once, not for myself, so that the result is fair. | implemented (repeat and self votes possible) | 🔶 built: Vote MVP, one tap (`vote_mvp`: one vote, not self; early finalise; 24 h deadline); awaiting the project | 3 |
| US-F4 | As a player I want to see my past pickups with W/L and the MVP so that I can track my record. | implemented | 🔶 built: Mine lists my pickups with status, result and ⭐ MVP; set scores not yet shown; awaiting the project | 3 |
| US-F5 | As a player I want a standing (the 2021 "GOAT score") earned from MVPs and wins so that reputation means something. | placeholder (column existed, never written) | 🔶 built: the You sheet shows games · wins · ⭐ MVP · score from `player_standing` (provisional formula behind ⓘ); awaiting the project | 3 |
| US-F6 | As a player I want a head-to-head record with a friend so that we can compare. | placeholder | ⬜ | 5 |

### Epic G — Be told

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-G1 | As a player I want in-app notifications for friend requests and responses, invitations, joins, leaves, deletions, "enter the score", "vote for MVP" and "you are MVP" so that nothing depends on a group chat. | implemented (9 of 10 types written) | 🔶 built: ten kinds written in the RPC transactions; inbox shows them; v1.3.0: arrives live while the channel is subscribed, else every 60 s | 3 |
| US-G2 | As a player I want to mark a notification read, and only my own, so that my inbox is mine. | implemented (ownership not checked) | 🔶 built: `mark_notifications_read` and RLS limit it to the recipient | 3 |
| US-G3 | As a player I want a push when it matters (invitation, game starting, score entered) so that I do not have to open the app. | placeholder (tokens stored, nothing sent) | ⬜ | 3 |

### Epic H — Share the game (deferred)

| ID | Story | 2021 | Now | Phase |
|---|---|---|---|---|
| US-H1 | Post photos and captions, tag teammates, attach a pickup. | placeholder (demo feed) | ⬜ | 5 |
| US-H2 | Like, comment, share. | placeholder | ⬜ | 5 |
| US-H3 | Message other players. | placeholder (seven hard-coded chats) | ⬜ | 5 |

**Explicit non-goals** (unchanged from the SRS, re-affirmed): no court reservations or booking, no
payments, no coaching, no equipment; no moderation queue or admin panel before the social layer; no
framework or build step unless secret handling forces one.

---

## 6. The workflow

### 6.1 The core loop

```
 1. OPEN the map          → courts near me, each with a lamp (open · toss-up · full) and its source
 2. PICK a court          → tier, courts, notes, directions, who has reported, which pickups are on it
 3. REPORT (optional)     → one tap: Open / Mixed / Full  (anonymous, rate-limited, decays)
 4. CREATE or JOIN        → a pickup = court + sport + start + capacity (+ a note); or "I'm here, need a 4th"
 5. INVITE                → friends by username; they accept or decline from their inbox
 6. PLAY                  → the pickup starts itself at its time ("in progress")
 7. RECORD                → the organiser enters teams, set scores and the winner
 8. RANK                  → attendees vote MVP once; the MVP and the win feed the player's standing
 ↺  the court's report history and the pickup's attendance feed tomorrow's "likely open" and "who plays here"
```

### 6.2 State machines (carried from 2021, corrected)

| Object | States | Transitions | 2021 defect corrected |
|---|---|---|---|
| Pickup | `open` → `in_progress` → `closed`; `cancelled` from any state | `open→in_progress` at `starts_at` (database clock, not a process timer); `in_progress→closed` by the organiser's result; `→cancelled` by the organiser | timers lived in one Node process and were lost on restart; delete did not cancel the timer |
| Attendee | `owner` · `invited` · `joined` | `invited→joined` (accept) · `invited→∅` (decline/cancel) · `joined→∅` (leave) · join only while `open` and `count(joined) < capacity` | capacity never enforced; anyone could invite to any pickup |
| Friendship | `pending (A→B)` → `friends` | accept creates the reverse edge; reject or cancel deletes the pending edge; remove deletes both | the "are we friends" computed field was broken |
| Notification | `unread` → `read` | only by its owner | any user could mark any notification read |
| Court report | `live` (< TTL) → `expired` | decays server-side; one per court per device per 15 min | client-only, one device |

### 6.3 One pickup, end to end (the sequence the APIs must support)

| Step | Actor | Call (see `MIGRATION.md` §5) | Side effects |
|---|---|---|---|
| 1 | Organiser | `create_pickup(court_id, sport, starts_at, capacity, note)` | row `pickups(open)`; organiser row `pickup_attendees(owner)`; log `PICKUP_CREATED` |
| 2 | Organiser | `invite_to_pickup(pickup_id, player_id)` | `pickup_attendees(invited)`; notification `invitation` to the player |
| 3 | Invitee | `respond_to_invitation(pickup_id, accept)` | `invited→joined` or row deleted; notification `joined` to the organiser |
| 4 | Anyone | `join_pickup(pickup_id)` / `leave_pickup(pickup_id)` | capacity checked in the database; notifications `joined` / `left` |
| 5 | Clock | scheduled job | `open→in_progress` where `starts_at <= now()`; notification `enter_result` to the organiser |
| 6 | Organiser | `record_result(pickup_id, teams[], set_scores[], winning_team)` | `pickup_teams` with members; `in_progress→closed`; `invited` rows dropped; notification `vote_mvp` to every attendee |
| 7 | Attendees | `vote_mvp(pickup_id, player_id)` | one vote per voter, not self; when all have voted, MVP chosen among the tied leaders; notification `you_are_mvp`; standing updated |
| 8 | Anyone | `GET pickups?court_id=…&status=open` / `GET my_pickups` | read models for the map, the court page and the profile |

---

## 7. Fundamental requirements

IDs continue the SRS numbering (`REQUIREMENTS.md` owns FR-01–53, DR-01–07, NFR-01–09). Priority
**M** must · **S** should · **C** could. Phase as in §5. Status against this repository today.

### 7.1 Identity and access

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-60 | A visitor can read courts and availability and submit reports with **no account**, under a server-minted anonymous identity. | M | 2 | ⬜ |
| FR-61 | A player can create an account (email + password or a magic link) and **upgrade** an anonymous identity to it, keeping its reports and games. | M | 3 | ⬜ |
| FR-62 | Every write is attributed to the authenticated identity by the database (`auth.uid()`); **no client-supplied user id is ever trusted** (the 2021 `X-Hasura-User-Id` design is explicitly not ported). | M | 2 | ⬜ |
| FR-63 | Row-level security on every table: a player reads what the product shows and writes only their own rows; organiser-only actions are enforced in SQL. | M | 2 | ⬜ |
| FR-64 | Profile: display name, unique username, photo, metro, optional skill self-rating; editable by its owner only. | M | 3 | ⬜ |
| FR-65 | Block and report another player; blocked players are invisible to each other's invitations and searches. | S | 3 | ⬜ |

### 7.2 Friends

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-70 | Search players by username or name with prefix matching; a parameterised query, never string-built SQL. | M | 3 | ⬜ |
| FR-71 | Friend request → accept / reject / cancel → remove, as a directed-edge model (`pending` = one edge, `friends` = both). | M | 3 | ⬜ |
| FR-72 | "Are we friends" and "my friends" are correct read models (a view), not a computed field that can silently break. | M | 3 | ⬜ |

### 7.3 Pickups

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-80 | A pickup references a **court row** (`courts.id`), a sport from the court's sports, `starts_at`, `capacity`, an optional note; the organiser is its first attendee. | M | 3 | ⬜ |
| FR-81 | Sports are an open enum seeded with `tennis`, `pickleball`, `basketball` (2021 shipped `tennis` and `basketball`; OpenCourt ships `tennis` and `pickleball`). | M | 3 | ⬜ |
| FR-82 | Invite (organiser only), accept / decline (invitee only), cancel (organiser only), join / leave (any player while `open`), each enforced in SQL. | M | 3 | ⬜ |
| FR-83 | Capacity is enforced at join time in the database (no over-subscription under concurrency). | M | 3 | ⬜ |
| FR-84 | Status moves `open → in_progress` by the database clock at `starts_at`; no application process holds timers. | M | 3 | ⬜ |
| FR-85 | Cancel (soft) by the organiser; attendees are notified; a cancelled pickup never starts. | M | 3 | ⬜ |
| FR-86 | The court page lists its open pickups; the map marks courts with a game on. | M | 3 | ⬜ |
| FR-87 | "I'm here, looking for a 4th": a lightweight pickup with `starts_at = now()` and `capacity = 4` from one tap on the court page (the SRS's FR-50). | S | 3 | ⬜ |
| FR-88 | A pickup has a shareable deep link that renders without an account (FR-52). | S | 3 | ⬜ |
| FR-89 | Editing a pickup's court, time or sport notifies every attendee and asks them to re-confirm or leave (2021 drew this as "Accept Changes / Leave Pickup"; it never reached the backend). | S | 3 | ⬜ |
| FR-89b | A player joining two pickups that overlap in time is warned (2021's unused `conflict` status, done as a read-time check, not a stored state). | C | 3 | ⬜ |

### 7.4 Results and standing

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-90 | The organiser records teams **with their members**, per-set scores and the winning team; the pickup closes; pending invitations are dropped. | M | 3 | ⬜ |
| FR-91 | Each attendee votes once for an attendee other than themselves; when all have voted (or 24 h pass), the MVP is the top-voted, ties broken at random **among the leaders**. | M | 3 | ⬜ |
| FR-92 | A player's standing (the 2021 "GOAT score") is a derived read model from wins and MVPs, recomputed, never hand-edited. | S | 3 | ⬜ |
| FR-93 | Past pickups show W/L, scores and the MVP on the profile. | M | 3 | ⬜ |
| FR-94 | Attendees can confirm or dispute the recorded result within a window before it counts toward standing (2021 drew the confirmation screen; the backend had no such state). | S | 3 | ⬜ |
| FR-95 | The result model is per-set scores for racquet sports; a points-based result is added by migration before basketball pickups can be closed. | M | 3 | ⬜ |

### 7.5 Notifications

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-100 | In-app notifications of these kinds: `friend_request`, `friend_accepted`, `friend_rejected`, `invitation`, `joined`, `left`, `cancelled`, `enter_result`, `vote_mvp`, `you_are_mvp`; each created by a database trigger on the state change, never by a second request from a client. | M | 3 | ⬜ |
| FR-101 | A player reads and marks read **only their own** notifications. | M | 3 | ⬜ |
| FR-102 | Live delivery while the page is open (database change subscription); push later (web push with stored subscriptions, server secrets only). | S | 3 | ⬜ |

### 7.6 Data

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| DR-10 | One schema serves both halves: `courts` ← `pickups` ← `pickup_attendees` → `profiles` ↔ `friendships`; `court_reports` and `notifications` hang off the same ids. | M | 2–3 | ⬜ |
| DR-11 | Every table carries `metro` directly or through `courts`; multi-city is a filter. | M | 2 | ⬜ |
| DR-12 | An append-only `event_log` records every state change with actor, type and payload (the 2021 `domain_events` outbox, kept for audit and for triggers). | S | 2 | ⬜ |
| DR-13 | Migrations only add; renames and drops go through a deprecation note in `working/`. | M | all | policy |
| DR-14 | The 2021 pytest flows (`PickUpHasura/tests/src/tests/test_flows.py`) are ported as the acceptance tests of the people flow before any UI is built on it. | M | 3 | ⬜ |

### 7.7 Non-functional

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| NFR-10 | No build step: the frontend stays plain HTML/CSS/JS on GitHub Pages; the backend client is a pinned CDN script. | M | all | ✅ policy |
| NFR-11 | Managed backend on a free or < $10/mo tier that survives a month untouched (SRS NFR-06); no process the owner must keep alive. | M | 2 | ⬜ |
| NFR-12 | Secrets never enter the repository; the only credential in source is the referrer-restricted Maps browser key. Server keys live in the backend's secret store. | M | all | ✅ policy |
| NFR-13 | Honest labelling carries over to people data: a pickup's attendee count is live or it says when it was last read; a standing shows the games behind it. | M | 3 | ⬜ |
| NFR-14 | Reads < 500 ms, writes < 1 s on mobile LTE (SRS NFR-02) for the people flow too. | S | 3 | ⬜ |
| NFR-15 | Every requirement above maps to at least one acceptance check in `MIGRATION.md` §7 before its phase is called done. | M | all | policy |

---

## 8. Definition of done, by phase

| Phase | Done when |
|---|---|
| 2 — shared backend | Courts and reports come from the backend; reports are shared across devices, rate-limited and decay; the site still deploys from `main` with no build step; the gate passes. |
| 3 — people & pickups | The 2021 pytest flows pass against the new API; a pickup can be created on a court, joined to capacity, started by the clock, scored with team members, MVP-voted fairly; notifications arrive by trigger; RLS tests prove a player cannot act as another. |
| 4 — multi-city | A second metro's courts load behind a city picker with no schema change. |
| 5 — social | Only after 3 is used weekly by people who are not the owner. **Measured (v1.4.0):** `metrics.phase5_gate` — met when each of the last 4 complete Los Angeles weeks had at least one *real game* (a pickup that started, was not cancelled, and had 2+ players who are neither the owner nor a test account; `metrics.usage_weekly`). |

---

## 9. Traceability

| Statement in this document | Primary evidence |
|---|---|
| The WHERE problem and the mission line | `docs/PROJECT_BRIEF.md`, `docs/REQUIREMENTS.md` §1–2, `README.md` |
| The WHO flow as delivered | `PickUpHasura/hasura/metadata/actions.graphql` (19 actions), `express-server/src/actions/*`, `tests/src/tests/test_flows.py`; summarised in `LEGACY_PICKUP_BACKEND.md` |
| 2021 story statuses | The iOS screen inventory (111 views) in `working/2026-10-17-pickup-opencourt-review.md` §3 |
| Court discovery was demo data in 2021 | `PickUp/views/nearme/CourtsNearBy/CourtsNearMeView.swift` (author: Ashwin Yedavalli, 2021-05-12), `views/busyness/BusynessView.swift` |
| Sports | `PickUpHasura/hasura/migrations/default/1626770639404_enums/up.sql` (`tennis`, `basketball`); `assets/data/courts.json` (`tennis`, `pickleball`) |
| Brand | `PickUp/Assets.xcassets/logo.imageset`, `AppIcon.appiconset`; `project.pbxproj` `PRODUCT_BUNDLE_IDENTIFIER` |
| The identity defect | `PickUp/services/interceptors/AuthenticationInterceptor.swift`, `PickUpHasura/docker-compose.yml` (no admin secret), no `*_permissions` in any table yaml |
| Owner rulings | This session, 2026-10-17 (quoted at the top) |
