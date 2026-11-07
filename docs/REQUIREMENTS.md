# OpenCourt LA — Software Requirements Specification (SRS)

**Version:** 1.3.5 · **Date:** 2026-11-07 · **Status:** Phase 1 shipped; Phase 2 and the Phase 3 people flow built, proven against a local stand-in, and live on the Supabase project `pickup` since 2026-10-18; PickUp foundation adopted. *(Corrected 2026-11-07: until then this line read "awaiting a Supabase project, one command".)*

This document consolidates every requirement stated across the CourtFinder project threads into one north star. Each requirement has an ID, a priority, a phase, and a status against the current build.

> **1.1.0 (2026-10-17):** this SRS remains the court-finder specification (FR-01–53, DR-01–07,
> NFR-01–09). The people half of the product — identity, friends, pickups on courts, results,
> notifications (FR-60–102, DR-10–14, NFR-10–15) — is specified in [`FOUNDATION.md`](./FOUNDATION.md),
> which also states the issue, goal, vision and mission of PickUp, the product this repository now
> carries. The Phase 3 rows below (FR-50–53) are superseded by FOUNDATION §5 Epic E/F where they overlap.

Priority: **M** = must, **S** = should, **C** = could. Status: ✅ done · 🔶 partial · ⬜ not started.

---

## 1. Purpose and scope

Recreational tennis and pickleball players in LA County cannot easily find free public courts, and cannot predict weekday-evening availability. OpenCourt LA is a map-first web tool that surfaces courts across three access tiers, scores likely availability, and lets players on the ground share live reports.

Mission: *Turning "where can I play?" into "I'm on my way."*

Out of scope for all phases: court reservations/booking, payments, coaching, equipment.

---

## 2. Users

| Persona | Need | Phase |
|---|---|---|
| Solo player (Ashwin, roommate) | "Where can I play in the next 30 min?" | 1 |
| Regular LA player | Same, plus trust in crowd signal | 2 |
| Player seeking a game | "Who's at a court near me now?" | 3 |
| Multi-city player | Same tool in SF / NYC / SD | 4 |

---

## 3. Functional requirements

### 3.1 Court discovery

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-01 | Display LA County courts as markers on a Google Map | M | 1 | ✅ |
| FR-02 | Auto-fit map bounds on load so the northernmost (Antelope Valley) and southernmost (South Bay) sites are both visible | M | 1 | ✅ |
| FR-03 | Sidebar list of courts synced with map; click list → map pans and highlights; click marker → list scrolls and highlights | M | 1 | ✅ |
| FR-04 | Detail panel per court: name, neighborhood, tier, court count, demand tier, notes, sports, directions link | M | 1 | ✅ |
| FR-05 | "Directions" deep-links to Google Maps navigation | S | 1 | ✅ |
| FR-06 | Curated dataset of ~20 sites (Phase 1) → ~50 sites (Phase 2) | M | 1→2 | 🔶 20/50 |
| FR-07 | Coordinates verified against ground truth for every listed court | M | 1.5 | ⬜ |

### 3.2 Classification and filtering

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-10 | Three-tier access model: Free / Low-cost public (<$20/hr) / Private-members | M | 1 | ✅ |
| FR-11 | Filter by sport: tennis, pickleball, or all; multi-sport sites appear under both | M | 1 | ✅ |
| FR-12 | Filter by access tier | M | 1 | ✅ |
| FR-13 | Filter by likely status (open / toss-up / full) | S | 1 | ✅ |
| FR-14 | Filters apply to list, map markers, and stat counters simultaneously | M | 1 | ✅ |
| FR-15 | Private courts always render as "full" from a public-access standpoint and expose no report buttons | M | 1 | ✅ |

### 3.3 Availability scoring

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-20 | Three-state output: 🟢 Likely Open / 🟡 Toss-up / 🔴 Likely Full | M | 1 | ✅ |
| FR-21 | Heuristic inputs: hour of day, day of week (weekend bump), court count, demand tier | M | 1 | ✅ |
| FR-22 | Fresh live report (< TTL) overrides heuristic | M | 1 | ✅ |
| FR-23 | UI labels the signal source honestly: "Live signal" vs "Heuristic estimate" | M | 1 | ✅ |
| FR-24 | Re-score automatically every 10 min during a session | S | 1 | ✅ |
| FR-25 | Server-side recency-weighted aggregation of reports, decaying to null after ~2 h | M | 2 | ⬜ |

### 3.4 Crowdsourced live reports

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-30 | Three-button report UI: Open / Mixed / Full — no forms, < 5 s to submit | M | 1 | ✅ |
| FR-31 | Report persisted client-side (localStorage), last 5 per court | M | 1 | ✅ |
| FR-32 | Report TTL = 90 min (tunable constant `REPORT_TTL_MINUTES`) | S | 1 | ✅ |
| FR-33 | Live-report courts show a pulsing "Live" badge in list and a marker dot | S | 1 | ✅ |
| FR-34 | Reports persisted server-side and shared across all users | M | 2 | ⬜ |
| FR-35 | Anonymous reporting with device fingerprint; no accounts | M | 2 | ⬜ |
| FR-36 | Rate limit: one report per court per device per 15 min | M | 2 | ⬜ |

### 3.5 Seasonal theming

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-40 | Palette keyed to the next Grand Slam: Roland-Garros clay, Wimbledon purple/green, US Open blue, Australian Open teal | S | 1 | ✅ |
| FR-41 | Theme activates ~4 weeks before each slam, persists through it | S | 1 | ✅ |
| FR-42 | Header pill shows "Next: X" or "X — Live"; sidebar hint explains the palette | C | 1 | ✅ |
| FR-43 | Calendar externalized in `grand-slams.json`; annual update only | S | 1 | ✅ |
| FR-44 | Pre-JS default theme in `index.html` matches current season (no flash) | C | 1 | ✅ |

### 3.6 Matchmaking (Phase 3)

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| FR-50 | "I'm here, looking for a 4th" pickup signals per court | M | 3 | ⬜ |
| FR-51 | Lightweight identity: nickname + skill self-rating | M | 3 | ⬜ |
| FR-52 | Shareable deep links to group chats | S | 3 | ⬜ |
| FR-53 | Public board filtered by neighborhood + skill range | S | 3 | ⬜ |

---

## 4. Data requirements

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| DR-01 | Court schema carries Phase 2 fields from day one: `metro`, `live_reports[]`, `last_reported_availability` | M | 1 | ✅ |
| DR-02 | Court data lives in external `assets/data/courts.json`, loaded via `fetch()` | M | 1 | ✅ |
| DR-03 | JSON has a `metadata` wrapper with `version`, `schema_version`, `last_updated` | S | 1 | ✅ |
| DR-04 | `courts.json` migrates to Supabase Postgres `courts` table with identical columns | M | 2 | ⬜ |
| DR-05 | `live_reports` table with FK to `courts`, RLS policies for write | M | 2 | ⬜ |
| DR-06 | Every record tagged `metro` so multi-city is a query filter, not a refactor | M | 1 | ✅ |
| DR-07 | Logged corrections honored: Westchester (not Westminster); Pearl + Mariners Village MDR combined; El Segundo P&R included; Sgt. Steve Owen Memorial Park as AV anchor; Mar Vista resurfaced Summer 2024 | M | 1 | ✅ |

---

## 5. Non-functional requirements

| ID | Requirement | Pri | Phase | Status |
|---|---|---|---|---|
| NFR-01 | No build step; plain HTML/CSS/JS deployable to GitHub Pages as-is | M | 1 | ✅ |
| NFR-02 | Courts list renders < 500 ms on mobile LTE; report write < 1 s | M | 2 | ⬜ (measure) |
| NFR-03 | Responsive: desktop split-pane; mobile stacks map (40vh) over list | M | 1 | ✅ |
| NFR-04 | Google Maps key referrer-restricted (localhost + Pages domain) and API-restricted to Maps JavaScript API before any public push | M | 1 | ✅ referrers and API restriction confirmed in the owner's console screenshots (2026-10-17, CLAUDE.md v1.3.0); no Maps error dialog on `localhost:8000` 2026-11-07 *(was ⬜ blocker)* |
| NFR-05 | `.gitignore` excludes `.env*`, editor noise, optional Node artifacts | M | 1 | ✅ |
| NFR-06 | Backend runs unattended for a month: managed infra, free tier or < $10/mo | M | 2 | ⬜ |
| NFR-07 | Editorial "sport-atlas" visual identity: Fraunces / Inter Tight / JetBrains Mono, warm paper, court-green and clay accents; must not read as generic SaaS dashboard | S | 1 | ✅ |
| NFR-08 | Auto-deploy on push to `main` via GitHub Actions | S | 1 | ✅ |
| NFR-09 | Files edited in VS Code only (TextEdit RTF-corrupts HTML/JSON) | M | all | policy |

---

## 6. Explicit non-goals

- No user accounts before Phase 3
- No moderation queue or admin panel in Phase 2 (rate limit + recency decay is the trust model)
- No court expansion past 20 until Phase 2 backend is live
- No framework (React/Next) unless a build step becomes necessary for secret handling

---

## 7. Phase 2 deployable-backend definition (from backend thread)

A backend is "deployable" when all of the following hold:

1. Serves `courts.json`-equivalent data over HTTPS to `fetch()`
2. Accepts and persists live availability reports
3. Filters by `metro`
4. Reads < 500 ms, writes < 1 s on mobile
5. Has an abuse floor (rate limiting)
6. Survives a month untouched (managed, cheap)

Chosen stack: **Supabase** (Postgres + auto REST + RLS + free tier). Rejected: Cloudflare KV/D1 (more code), Firestore (fights normalized schema), self-hosted Node (more surface area).

Migration order: external JSON (done) → Supabase read-only `courts` → `live_reports` write endpoint → server-side aggregation view → rate limiting.

---

## 8. Acceptance criteria for v1.0.1 (this release)

- [ ] Page loads at `https://<user>.github.io/opencourt-la/` with no console errors
- [ ] All 20 markers visible on first frame without manual zoom
- [ ] Each filter chip changes list, markers, and stats together
- [ ] Clicking a report button on a public court flips its status immediately and survives a reload
- [ ] Header pill reads "Next: Australian Open" (through 2027-01-17)
- [ ] Maps key is restricted in Cloud Console; `git log -p` shows no other secrets

---

## 9. Traceability

| Source thread | Requirements derived |
|---|---|
| Project brief / SRS | FR-01, FR-06, FR-10, FR-11, FR-20, DR-01, §2, §6 |
| Backend management | FR-25, FR-34–36, DR-04–05, NFR-02, NFR-06, §7 |
| Prep the local folder | NFR-04, NFR-05, NFR-09 |
| v1.0 dashboard build | FR-01–05, FR-12–15, FR-21–24, NFR-03, NFR-07 |
| Google Maps / 3-button / seasonal | FR-02, FR-30–33, FR-40–43 |
| GitHub structure | DR-02–03, NFR-01, NFR-08 |
