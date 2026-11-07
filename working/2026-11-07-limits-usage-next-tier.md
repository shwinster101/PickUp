# 2026-11-07 — Signals that cost something, a number for real use, and the next tier (v1.4.0)

**Owner (2026-11-07)**, replying to the audit (`working/2026-11-07-audit.md`) with three of its items and
"Email later":
> "A decision on how much abuse to block. Options: limits on creating pickups, sending invites and friend
> requests; a CAPTCHA on anonymous sign-in; rules so farmed games don't count toward standing; and either
> different wording or a location check for 'on the ground'. · A usage measure. Decide which number shows
> real use before building more features. · Next tier: the CDN script has no integrity hash, all times use
> the visitor's device clock instead of LA time, the stale push-to-github.sh is a hazard, and organisers
> can't be deleted. · Email later"

## What materially changed since the audit

- The owner deferred email and asked for the rest. While reading for this pass a further gap surfaced:
  `anon` (no session at all) can `select` from `player_standing`, through Supabase's default grants (the
  shim mirrors them; `has_table_privilege('anon', 'public.player_standing', 'select')` = true), although
  the conventions say standing is "readable by any signed-in player".

## Interpretations — assumptions for the owner to correct (recorded before the build)

1. **Abuse posture: slow and visible, not impossible.** Identity is free (anonymous sign-in), so no rule in
   SQL can stop a determined faker; the rules make each fake cost time and sessions. Built: per-actor
   limits, friends-only invitations, standing rules, honest wording, and a CAPTCHA the page is ready for
   but which stays **off** until the owner turns it on (it needs a Cloudflare Turnstile site and the secret
   in Supabase). **Not built: a location check.** The server cannot verify a browser's location, so it
   would not make "on the ground" true, and the permission prompt would cost reports in a product that has
   none yet. The wording changes instead.
2. **The numbers** (each one place in `0006`, easy to change):
   - reports from one session cover at most **3 different courts per rolling hour** (the 15-minute rule per
     court stays);
   - an organiser has at most **5 open pickups** and creates at most **10 in 24 hours**;
   - **invitations go to mutual friends only** (the story US-E4 and the Invite panel already say "friends");
   - friend requests: at most **10 per hour**, **20 unanswered** at once, and none to someone who declined
     you in the last **7 days**.
3. **Standing rules:** a game counts when its result came **at least 20 minutes after its start**; at most
   **3 counted games per player per Los Angeles day**; an MVP counts only on a counted game; the tiles show
   counted games. The formula stays provisional and its ⓘ says the rules.
4. **Deleting a player** keeps their finished games for everyone else (the organiser becomes empty), and
   cancels their open or running pickups with a notice to the players. Organiser-only checks compare with
   `is distinct from`, so an empty organiser never matches anyone.
5. **The number that shows real use: real games per week.** A real game is a pickup that started in that
   Los Angeles week, was not cancelled, and had **at least 2 players** who are neither on the owner's
   exclusion list (`metrics.exclusions`) nor proof accounts (anyone on a pickup whose note starts
   `two-browsers `). **The FOUNDATION §8 Phase 5 gate** ("used weekly by people who are not the owner") is
   met when **each of the last 4 complete weeks has at least one real game**. Secondary numbers beside it:
   real reporters, reports, pickups created, results. Owner-only, read in the SQL editor; not a page.
6. **Time:** every clock the page shows or reasons with is **Los Angeles time** (from `METRO`): the
   availability heuristic, pickup times, the new-pickup form, the header clock and the theme date. A
   device elsewhere sees the zone abbreviation (PST/PDT) beside the time.
7. **Integrity hash:** the `sha384` of `dist/umd/supabase.js` from the npm tarball of 2.45.4, which is the
   file jsDelivr serves (its `591.supabase.js` chunk is the `ws` fallback, loaded only without a native
   WebSocket). If the hash ever failed, the browser refuses the script and the page must say "Backend
   unreachable", not "Offline data": that state is added.
8. **`push-to-github.sh` is deleted** (git history keeps it).
9. **Version v1.4.0:** a migration with new rules.

## Deprecation note (migrations add; this one changes a constraint)

- `pickups.organiser_id` loses `not null` and its foreign key is re-created `on delete set null`; a check
  keeps an organiser-less pickup cancelled or closed. Reason: a player who organised anything could not be
  deleted (audit probe P1). Nothing is renamed; no column is dropped.
- `player_standing` is replaced with the same columns; `anon` loses `select` on it.

## Outcomes

**The audit probes, before and after `0006`** (`working/2026-11-07-audit-probes.sql`, throwaway cluster;
"before" = migrations 0001–0005 only):

| Probe | Before | After |
|---|---|---|
| P1 delete a player who organised a pickup | refused (`pickups_organiser_id_fkey`, 23503) | deleted |
| P2 ten instant farmed games, 3 sock puppets | standing 10 / 10 / 10, score 50 | 10 games recorded, standing 0 |
| P3 a stranger to every profile | 5 friend requests + 5 invitations | 4 requests (under the hourly cap), 0 invitations |
| P4 one session, 50 pickups on one court | 50 of 50 | 4 of 50 (5 open, one was P3's) |
| P5 sessions to mark all 18 public courts Full | 1 | 6 (within one IP's default 30 anonymous sign-ins an hour: the CAPTCHA is the next cost) |

**Verification:** gate + backend 220 assertions (`t_050` 38 new; `t_020` seeds friendships for its
invitations and removes them; `t_030` backdates its games 35 minutes and moves p6's whole game a day back);
`check-hardening.cjs` (new) passes: an LA device reads "Thu, Jul 3 6:00 PM", a UTC device "… PDT", the form
maps an LA wall time to the same instant on both, the heuristic sees 18:00 on a Thursday; the npm file passes
the integrity hash and a changed copy is refused with "Backend unreachable"; the Turnstile token rides the
sign-in with a key and nothing loads without one. Offline check 20 pins; fake-backend check errors are only
this sandbox's 6 blocked hosts (as before); stand-in smoke 44/44 with `0006`; two-browser proof 8/8 twice
("Reported 0 min ago by a player.", "Pickup created for Today 3:00 PM PST"); provisioner mock 41/41.

**Not done, by design or by owner:** email (owner: later); a location check (declined, assumption 1);
`0006` on the live project (owner step); the CAPTCHA switched on (owner step); jsDelivr's copy compared
byte for byte with npm's (blocked here: `curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A`
must print `0w2KAL2YHP6wKOkUDzkCDGgVvfmHnj02DHeQ6XcHOgTfFsGyonKOpShMH1x6nk9o`).

**Commit:** `44de2dc` on `claude/fervent-carson-5ozivy` (pushed 2026-11-07; not merged, so not deployed, and
`0006` is not on the live project until the owner applies it).
