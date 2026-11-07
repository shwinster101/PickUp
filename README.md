# OpenCourt LA — the home of PickUp

> Turning "where can I play?" into "I'm on my way."

OpenCourt LA is a discovery tool for recreational tennis and pickleball players in Los Angeles County. It surfaces free and low-cost public courts on a map, scores their likely availability in real time, and lets players on the ground share live availability reports with everyone else.

**PickUp.** Since 2026-10-17 this repository is also the successor of the 2021 PickUp app
(`PickUpBois/PickUp` + `PickUpBois/PickUpHasura`): the product keeps the PickUp name and logo
(`assets/img/pickup-logo.png`), and PickUp's people flow — friends, pickups on courts, invitations,
results, MVP, notifications — is being rebuilt here on working APIs. Start with
[`docs/FOUNDATION.md`](docs/FOUNDATION.md) (issue, goal, vision, mission, user stories, workflow,
requirements), then [`docs/MIGRATION.md`](docs/MIGRATION.md) and
[`docs/LEGACY_PICKUP_BACKEND.md`](docs/LEGACY_PICKUP_BACKEND.md). Agents read [`CLAUDE.md`](CLAUDE.md) first.

**[Live site →](https://shwinster101.github.io/PickUp/)** 

---

## Why this exists

LA's free public courts are hard to discover. Search results skew toward paid and private facilities, and weekday-evening availability is unpredictable. OpenCourt closes that gap with curated data plus a crowdsourced live layer.

The long-term vision is a multi-city platform. **OpenCourt LA** is v1.

---

## Features (Phase 1, shipped)

- **20 curated court sites** across LA County (Santa Monica, Westside, Hollywood, Mid-City, Valley, South Bay, Antelope Valley)
- **Google Maps with auto-fit bounds** — the first frame shows the full LA footprint, including the northernmost Antelope Valley site
- **Three-tier access model:** Free / Low-cost public (< $20/hr) / Private-members
- **Heuristic availability scoring** — 🟢 Likely Open / 🟡 Toss-Up / 🔴 Likely Full, computed from court count, demand tier, time of day, day of week
- **Crowdsourced live reports** — three-button interface (Open / Mixed / Full); shared through Supabase when configured, on the device otherwise, and the page says which
- **Seasonal Grand Slam theming** — palette automatically retunes for the next major (Roland-Garros clay, Wimbledon purple, US Open blue, Australian Open teal)
- **Filters** — sport, access tier, likely status
- **No build step** — plain HTML/CSS/JS deployable to GitHub Pages

---

## Project structure

```
opencourt-la/
├── index.html                   # Entry point
├── assets/
│   ├── css/styles.css           # All styles + seasonal theme variables
│   ├── js/app.js                # Application logic: court finder + the PickUp people flow
│   ├── js/backend.js            # Supabase client wrapper (views, RPC, one realtime channel); Backend.enabled gates the people features
│   ├── js/config.js             # Public runtime config: Supabase URL + anon key, optional Map ID
│   ├── data/
│   │   ├── courts.json          # Court seed (the source of supabase/seed.sql)
│   │   └── grand-slams.json     # Grand Slam calendar driving the theme engine
│   └── img/                     # favicon, the PickUp wordmark and icon
├── CLAUDE.md                    # Agent brief: rulings, release record, invariants, the gate
├── AGENTS.md                    # Thin pointer to CLAUDE.md
├── supabase/                    # The backend: migrations/0001–0005 (SQL), seed.sql, README (provisioning)
├── scripts/check.sh             # The gate: data parses, scripts parse, no secret-shaped strings, seed current (--backend adds the SQL leg)
├── scripts/provision-supabase.sh   # One command: project → auth → pg_cron → migrations + seed → anon key → config.js
├── scripts/export-courts-seed.mjs  # courts.json → supabase/seed.sql
├── test/backend/                # run.sh + shim.sql + t_*.sql: the SQL leg on a throwaway PostgreSQL (182 assertions)
├── test/browser/                # Playwright checks of the page, offline and against a fake supabase-js
├── test/e2e/                    # A local stand-in for Supabase (mini PostgREST + GoTrue) and the two-browser proof
├── test/provision/              # A mock of the Supabase Management API and the provisioner's tests
├── working/                     # Dated findings notes (the record of each pass)
├── docs/
│   ├── FOUNDATION.md            # PickUp: issue, goal, vision, mission, user stories, workflow, requirements
│   ├── MIGRATION.md             # The 2021 backend flow → OpenCourt structure and working APIs (status in §7b)
│   ├── LEGACY_PICKUP_BACKEND.md # What the 2021 backend actually did (source of truth for the port)
│   ├── project-conventions.md   # Locked decisions and the working rhythm
│   ├── REQUIREMENTS.md          # Consolidated SRS — the court-finder spec
│   ├── PROJECT_BRIEF.md         # Vision and phases
│   ├── SETUP.md                 # Local dev + deploy steps
│   ├── RESEARCH_NOTES.md        # Background research
│   └── ROADMAP.md               # Phase 1/2/3 plan
├── .github/workflows/pages.yml  # Auto-deploy to GitHub Pages
├── .gitignore
├── LICENSE
└── README.md
```

---

## Quick start

```bash
# Clone
git clone https://github.com/shwinster101/PickUp.git
cd PickUp

# Open index.html in a browser — but most browsers block fetch() on file:// URLs,
# so run a local server instead:
python3 -m http.server 8000
# then visit http://localhost:8000
```

You'll see a yellow banner prompting you to add your Google Maps API key. See `docs/SETUP.md` for the full provisioning steps including referrer restrictions.

---

## Tech stack

- **Frontend:** Plain HTML / CSS / JavaScript (no framework, no build step); the only runtime
  dependency is the pinned `supabase-js` UMD script
- **Map:** Google Maps JavaScript API; pins drawn by the page (OverlayView), Advanced Markers when a Map ID is configured
- **Fonts:** Fraunces (display), Inter Tight (UI), JetBrains Mono (data)
- **Data:** `assets/data/courts.json` is the seed; the shared backend is Supabase Postgres defined
  entirely by `supabase/migrations/` (PostgREST + RPC + row-level security, no server code). Without
  a configured backend the page runs on the JSON and keeps reports on the device, and says so.
- **Hosting:** GitHub Pages
- **Deploy:** GitHub Actions (`.github/workflows/pages.yml`)

## The shared backend

`supabase/` holds five SQL migrations and a seed: courts and crowd reports (M1), profiles, pickups,
invitations and the inbox (M2), friends, results and MVP (M3), the `pg_cron` schedules, and the realtime
publication (M4). Every rule lives in SQL under `auth.uid()`; clients never write a table directly.
`test/backend/run.sh` proves it on a throwaway PostgreSQL (the ported 2021 flows plus a cross-user
refusal matrix, 182 assertions).

**Provision it in one command** (`supabase/README.md`): with a Supabase access token in the environment,
`scripts/provision-supabase.sh` creates the project, enables anonymous sign-ins and `pg_cron`, applies the
migrations and seed, and writes the project URL and anon key into `assets/js/config.js`. The manual
checklist is kept as the fallback.

**Prove it in two browsers:** `test/e2e/two-browsers.cjs` opens two fresh browsers, reports a court in
one and reads it in the other, starts a pickup in one and joins from the other. Before a project
exists it runs against `test/e2e/local-backend.py`, a local stand-in for Supabase over the real
migrations; afterwards, against the project itself.

**With the backend configured the page gains:** shared reports, pickups on each public court with
invitations and a share link, an inbox (live while the realtime channel is up, polled otherwise), Mine
(results, MVP votes), Friends, and a You sheet with standing and an account you can keep by email.
Without it the page says "Offline data · reports stay on this device" and shows none of those controls.

---

## Roadmap

- **Phase 1 (current):** Personal MVP with curated data and heuristic scoring
- **Phase 2:** `courts.json` on Supabase with shared reports — built; waits on the project (`scripts/provision-supabase.sh`); expand to ~50 courts
- **Phase 3:** the PickUp people flow — pickups on courts, invitations, friends, results, MVP, standing — built; push and "I'm here" to follow

See `docs/ROADMAP.md` for the full plan.

---

## Contributing

OpenCourt is in early personal-MVP territory. If you're a player who's noticed a missing court or incorrect info, open an issue with the location's name, address, and a brief note about access.

---

## License

MIT — see `LICENSE`.
