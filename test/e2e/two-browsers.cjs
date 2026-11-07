#!/usr/bin/env node
// Two real browsers, one shared backend — the proof that what one player does appears for another.
//
//   OC_SUPABASE_URL=http://127.0.0.1:54400 OC_SUPABASE_ANON_KEY=local-anon OC_PAGE_URL=http://127.0.0.1:8020/ \
//     NODE_PATH=/opt/node22/lib/node_modules:/opt/node-tools/node_modules node test/e2e/two-browsers.cjs
//
// Two isolated Chromium contexts (A and B: fresh storage each, so two anonymous users) walk the page:
//   1. A loads; #data-source reads "Shared data"; the court list has 20 rows.
//   2. A opens OC_COURT and taps the "Open" report button; the feedback says it was shared; the status
//      source reads the live wording.
//   3. B loads fresh and opens the same court: the live wording, the age, and courts_live's uncapped
//      recent_report_count is exactly one more than A saw before its tap (the panel's own count tops out
//      at 5, so it alone cannot prove A's report landed on a busy court); B never reported.
//   4. A starts a pickup there (profile prompt → unique name → create with a note); the row carries A's name.
//   5. B reloads, opens the court: A's pickup row is there; B taps Join (profile prompt, its own name);
//      the row reads 2 joined.
//   6. A reloads: the row reads 2 joined; the inbox badge shows 1 unread; opening it names B.
//   7. A's Mine list shows the pickup as organiser (SKIP when index.html has no #mine-btn).
//   8. B opens the share link (#pickup=<token>, token read from Backend.myPickups() in A): the detail
//      panel opens on that court with the row highlighted.
// Each step prints PASS/FAIL with the observed text; a step whose prerequisite failed prints FAIL "not run";
// on any FAIL both browsers are screenshotted into OC_SCREENSHOT_DIR; a JSON summary ends the output;
// the exit code is 1 on any FAIL (a SKIP is not a failure).
//
// Environment:
//   OC_PAGE_URL            the served page (default http://localhost:8020/)
//   OC_SUPABASE_URL, OC_SUPABASE_ANON_KEY
//                          when BOTH are set, **/assets/js/config.js is routed in every context to a config
//                          with those values (GOOGLE_MAP_ID "", METRO "LA"); the file on disk is never
//                          touched. When unset, the page's own config.js is used: that is the real-project
//                          mode once config.js is filled on main.
//   OC_COURT               a public court id from assets/data/courts.json (default: the first free-tier one)
//   OC_SCREENSHOT_DIR      where failure screenshots go (default <tmpdir>/opencourt-two-browsers)
//   OC_STEP_TIMEOUT_MS     per-wait timeout (default 30000; the first "Shared data" wait is 20 s regardless)
//
// maps.googleapis.com is routed to an aborted request in both contexts, so nothing here depends on Google
// Maps or the key: app.js renders the list before the map (boot → renderList/renderStats), renderMarkers()
// returns when there is no map, and selectCourt() only pans when state.map exists.
//
// Playwright is a tool on the machine that runs this, not a dependency of the repository (no package.json):
// it must be resolvable by require('playwright') (NODE_PATH on this machine; `npm i -g playwright` and
// `npx playwright install chromium` elsewhere).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE_URL = process.env.OC_PAGE_URL || 'http://localhost:8020/';
const SB_URL = process.env.OC_SUPABASE_URL || '';
const SB_KEY = process.env.OC_SUPABASE_ANON_KEY || '';
const ROUTED = !!(SB_URL && SB_KEY);
const SHOT_DIR = process.env.OC_SCREENSHOT_DIR || path.join(os.tmpdir(), 'opencourt-two-browsers');
const STEP_MS = Number(process.env.OC_STEP_TIMEOUT_MS) || 30000;
const SHARED_MS = 20000;

// The exact wording in assets/js/app.js (selectCourt's report handler, statusBlock, wirePickupButtons).
const REPORT_SHARED = 'Thanks. Marked as open just now — shared with everyone for 90 min.';
const LIVE_SOURCE = '◉ Live signal';
const JOINED_FLASH = /^You.re in\. The organiser has been told\.$/;

// Console noise that is not a defect: the realtime websocket the stand-in does not serve (the page keeps
// polling and never claims "· live"), Chromium's generic line for every refused fetch, the aborted Maps script.
const IGNORE_CONSOLE = /realtime\/v1\/websocket|Failed to load resource|ERR_BLOCKED_BY_CLIENT|ERR_FAILED|maps\.googleapis\.com|Google Maps/;

// Chromium on Linux honours the proxy variables of its environment; the page and a local stand-in live on
// 127.0.0.1 and must never be sent through one.
for (const k of ['no_proxy', 'NO_PROXY']) {
  const have = (process.env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
  const need = ['localhost', '127.0.0.1'].filter(h => !have.includes(h));
  if (need.length) process.env[k] = have.concat(need).join(',');
}

// ---- the court ------------------------------------------------------------------------------------
const courts = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'data', 'courts.json'), 'utf8')).courts;
const COURT_ID = process.env.OC_COURT || (courts.find(c => c.tier === 'free') || courts[0]).id;
const COURT = courts.find(c => c.id === COURT_ID);
if (!COURT) { console.error(`OC_COURT=${COURT_ID} is not in assets/data/courts.json`); process.exit(2); }
if (COURT.tier === 'private') { console.error(`OC_COURT=${COURT_ID} is private: private courts take no reports and no pickups`); process.exit(2); }

// ---- the two players: unique per run (the pid plus a slice of the clock), so re-runs never collide ------
const tag = `${process.pid}${Date.now().toString(36).slice(-3)}`;
const WHO = {
  A: { display: `Ada ${tag}`, username: `ada_${tag}` },
  B: { display: `Bo ${tag}`, username: `bo_${tag}` }
};
const NOTE = `two-browsers ${tag}`;

const CONFIG_JS = `window.OPENCOURT_CONFIG = ${JSON.stringify({ SUPABASE_URL: SB_URL, SUPABASE_ANON_KEY: SB_KEY, GOOGLE_MAP_ID: '', METRO: 'LA' })};`;

// ---- browsers ------------------------------------------------------------------------------------
async function newBrowser(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (ROUTED) await ctx.route('**/assets/js/config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CONFIG_JS }));
  await ctx.route('**/maps.googleapis.com/**', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return { label, ctx, page, errors, who: WHO[label] };
}

// ---- small waits (everything waits for a selector or a text; no fixed sleeps) -----------------------
async function waitFor(page, fn, arg, what, ms = STEP_MS) {
  try {
    const h = await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
    return await h.jsonValue();
  } catch (e) {
    if (/Timeout/i.test(String(e))) throw new Error(`${what}: not seen within ${ms / 1000}s`);
    throw e;
  }
}

const dataSource = (page) => page.evaluate(() => { const el = document.getElementById('data-source'); return el ? el.textContent.trim() : null; });

// Load (or reload) and wait for #data-source to settle; "Shared data" (optionally "· live") is required.
async function waitShared(page) {
  const text = await waitFor(page, () => {
    const el = document.getElementById('data-source');
    const t = el && el.textContent.trim();
    return t && !/^Loading/.test(t) ? t : false;
  }, null, '#data-source', SHARED_MS);
  if (!/^Shared data/.test(text)) {
    throw new Error(`#data-source reads "${text}"${ROUTED ? '' : ' (no OC_SUPABASE_URL/OC_SUPABASE_ANON_KEY given, so the page\'s own assets/js/config.js was used)'}`);
  }
  return text;
}
async function load(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return waitShared(page);
}
async function reload(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  return waitShared(page);
}

// The detail panel's status block and its "Recent reports" row, as text.
const detail = (page) => page.evaluate(() => {
  const q = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; };
  const row = Array.from(document.querySelectorAll('.detail-row')).find(r => (r.querySelector('.detail-key') || {}).textContent === 'Recent reports');
  return { open: document.getElementById('detail-panel').classList.contains('open'), name: q('#detail-name'), label: q('.detail-status-label'), note: q('.detail-status-note'), source: q('.detail-status-source'), reports: row ? row.querySelector('.detail-val').textContent.trim() : null };
});
const reportCount = (txt) => { if (txt === 'None yet') return 0; const m = /^(\d+) in the last 90 min$/.exec(txt || ''); return m ? Number(m[1]) : NaN; };
// courts_live.recent_report_count for one court, read through the page's own client (uncapped, unlike the
// live_reports array behind the panel's "Recent reports" row, which courts_live limits to 5).
const recentCount = (page, id) => page.evaluate(async (cid) => {
  const rows = await window.Backend.fetchCourts();
  const c = (rows || []).find(r => r.id === cid);
  return c ? c.recent_report_count : null;
}, id);

async function openCourt(page) {
  await page.click(`.court-item[data-id="${COURT_ID}"]`);
  await waitFor(page, (name) => document.getElementById('detail-panel').classList.contains('open') && document.getElementById('detail-name').textContent.trim() === name, COURT.name, `detail panel on ${COURT.name}`);
  return detail(page);
}

// One pickup row of the open court, by id: its meta line, its buttons, its highlight.
const pickupRow = (id) => `#pickups-list .pickup-row[data-pickup="${id}"]`;
const rowInfo = (page, id) => page.evaluate((sel) => {
  const r = document.querySelector(sel);
  if (!r) return null;
  return { meta: (r.querySelector('.pickup-meta') || {}).textContent.trim(), acts: Array.from(r.querySelectorAll('.pk-btn')).map(b => b.dataset.act), highlight: r.classList.contains('highlight') };
}, pickupRow(id));
const allRows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#pickups-list .pickup-row')).map(r => ({ id: r.dataset.pickup, meta: (r.querySelector('.pickup-meta') || {}).textContent.trim() })));

// The profile prompt (showProfileForm in app.js): name, username, Save.
async function fillProfile(page, who) {
  await page.waitForSelector('#profile-form', { timeout: STEP_MS });
  await page.fill('#profile-form input[name=display_name]', who.display);
  await page.fill('#profile-form input[name=username]', who.username);
  await page.click('#profile-form button[type=submit]');
}

// A flash element's text once it has one.
const waitFlash = (page, id) => waitFor(page, (i) => { const el = document.getElementById(i); const t = el && el.textContent.trim(); return t || false; }, id, `#${id}`);

// datetime-local value for an instant, in Los Angeles wall-clock time: the page reads its form in the
// metro's zone whatever the device's zone is (v1.4.0). YYYY-MM-DDTHH:mm
function localInput(d) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`;
}

// ---- the step runner ---------------------------------------------------------------------------
const results = [];
const screenshots = [];
let browsers = {};
const passed = (n) => results.some(r => r.n === n && r.status === 'PASS');

async function shoot(n) {
  for (const b of Object.values(browsers)) {
    try {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = path.join(SHOT_DIR, `step-${n}-${b.label}.png`);
      await b.page.screenshot({ path: file, timeout: 10000 });
      screenshots.push(file);
    } catch (e) { /* a screenshot is best effort */ }
  }
}

async function step(n, name, needs, fn) {
  const missing = needs.filter(k => !passed(k));
  if (missing.length) {
    const why = `not run: step ${missing.join(', ')} did not pass`;
    console.log(`FAIL ${n}. ${name} — ${why}`);
    results.push({ n, name, status: 'FAIL', observed: why });
    return;
  }
  try {
    const out = await fn();
    if (out && out.skip) {
      console.log(`SKIP ${n}. ${name} — ${out.skip}`);
      results.push({ n, name, status: 'SKIP', observed: out.skip });
    } else {
      console.log(`PASS ${n}. ${name} — ${out}`);
      results.push({ n, name, status: 'PASS', observed: String(out) });
    }
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.log(`FAIL ${n}. ${name} — ${msg}`);
    await shoot(n);
    results.push({ n, name, status: 'FAIL', observed: msg });
  }
}

// ---- the proof -----------------------------------------------------------------------------------
(async () => {
  console.log(`two-browsers: page ${PAGE_URL} · court ${COURT_ID} (${COURT.name}) · config ${ROUTED ? `routed to ${SB_URL}` : "the page's own assets/js/config.js"} · players ${WHO.A.username}, ${WHO.B.username}`);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const A = await newBrowser(browser, 'A');
  const B = await newBrowser(browser, 'B');
  browsers = { A, B };

  let reportsBefore = NaN;   // A's "Recent reports" count before it reports (the panel, capped at 5)
  let recentBefore = null;   // courts_live.recent_report_count before A reports (uncapped)
  let pickupId = null;
  let shareLink = null;

  await step(1, 'A loads · "Shared data" · 20 courts listed', [], async () => {
    const src = await load(A.page, PAGE_URL);
    const n = await waitFor(A.page, () => document.querySelectorAll('#court-list .court-item').length || false, null, 'the court list');
    if (n !== 20) throw new Error(`#data-source "${src}" · court list has ${n} rows, expected 20`);
    return `#data-source "${src}" · ${n} court rows`;
  });

  await step(2, `A reports Open on ${COURT.name} · feedback says shared · status reads live`, [1], async () => {
    const before = await openCourt(A.page);
    reportsBefore = reportCount(before.reports);
    if (Number.isNaN(reportsBefore)) throw new Error(`"Recent reports" reads "${before.reports}"`);
    recentBefore = await recentCount(A.page, COURT_ID);
    if (typeof recentBefore !== 'number') throw new Error(`courts_live.recent_report_count for ${COURT_ID} reads ${JSON.stringify(recentBefore)}`);
    await A.page.click('.report-btn[data-status="open"]');
    const fb = await waitFlash(A.page, 'report-feedback');
    if (fb !== REPORT_SHARED) throw new Error(`feedback reads "${fb}" (expected "${REPORT_SHARED}")`);
    await waitFor(A.page, (want) => { const el = document.querySelector('.detail-status-source'); return !!el && el.textContent.trim() === want; }, LIVE_SOURCE, `status source "${LIVE_SOURCE}"`);
    const d = await detail(A.page);
    return `"${fb}" · ${d.source} · ${d.label} · ${d.note} · before the tap: Recent reports "${before.reports}", recent_report_count ${recentBefore}`;
  });

  await step(3, "B loads fresh · the same court shows A's report as live", [2], async () => {
    const src = await load(B.page, PAGE_URL);
    const d = await openCourt(B.page);
    const recent = await recentCount(B.page, COURT_ID);          // uncapped: A's one report, exactly
    const got = reportCount(d.reports);                           // the panel: the same view, capped at 5
    const ageOk = /^Reported \d+ min ago by a player\.$/.test(d.note || '');
    if (d.source !== LIVE_SOURCE || d.label !== 'Likely open' || !ageOk || recent !== recentBefore + 1 || got !== Math.min(recent, 5)) {
      throw new Error(`#data-source "${src}" · source "${d.source}" · label "${d.label}" · note "${d.note}" · recent_report_count ${recent} (expected ${recentBefore + 1}: A read ${recentBefore} before reporting, B reported nothing) · Recent reports "${d.reports}" (expected ${Math.min(recent, 5)})`);
    }
    return `#data-source "${src}" · ${d.source} · ${d.label} · ${d.note} · recent_report_count ${recentBefore} → ${recent} · Recent reports "${d.reports}" (B reported nothing)`;
  });

  await step(4, "A starts a pickup (profile prompt → create with a note) · the row carries A's name", [2], async () => {
    await A.page.click('#pickup-new');
    await A.page.waitForSelector('#pickup-form', { timeout: STEP_MS });
    // Two hours ahead, on the hour: never "started" by the database clock while the proof runs.
    const start = new Date(Date.now() + 2 * 3600000); start.setMinutes(0, 0, 0);
    await A.page.fill('#pickup-form input[name=starts_at]', localInput(start));
    await A.page.fill('#pickup-form input[name=note]', NOTE);
    await A.page.click('#pickup-form button[type=submit]');
    await fillProfile(A.page, A.who);                 // withProfile(): no profile yet → the name form first
    const fb = await waitFlash(A.page, 'pickup-feedback');
    if (!/^Pickup created for /.test(fb)) throw new Error(`feedback reads "${fb}"`);
    const row = await waitFor(A.page, (name) => {
      const r = Array.from(document.querySelectorAll('#pickups-list .pickup-row')).find(x => ((x.querySelector('.pickup-meta') || {}).textContent || '').includes(`by ${name}`));
      return r ? { id: r.dataset.pickup, meta: r.querySelector('.pickup-meta').textContent.trim() } : false;
    }, A.who.display, `a pickup row "by ${A.who.display}"`);
    pickupId = row.id;
    if (!/^1\/4 players · by /.test(row.meta) || !row.meta.includes(' · yours') || !row.meta.includes(NOTE)) throw new Error(`row reads "${row.meta}"`);
    return `"${fb}" · row "${row.meta}" · id ${pickupId}`;
  });

  await step(5, "B reloads · sees A's pickup · joins (profile prompt) · the row reads 2 joined", [4], async () => {
    await reload(B.page);
    await openCourt(B.page);
    await waitFor(B.page, (sel) => !!document.querySelector(sel), pickupRow(pickupId), `A's pickup row in B`).catch(async (e) => {
      throw new Error(`${e.message}; rows in B: ${JSON.stringify(await allRows(B.page))}`);
    });
    const before = await rowInfo(B.page, pickupId);
    if (!before.meta.includes(`by ${A.who.display}`) || !before.acts.includes('join')) throw new Error(`row reads "${before.meta}" with buttons [${before.acts}]`);
    await B.page.click(`${pickupRow(pickupId)} .pk-btn[data-act="join"]`);
    await fillProfile(B.page, B.who);
    const fb = await waitFlash(B.page, 'pickup-feedback');
    if (!JOINED_FLASH.test(fb)) throw new Error(`feedback reads "${fb}"`);
    const after = await waitFor(B.page, (sel) => {
      const r = document.querySelector(sel); const m = r && (r.querySelector('.pickup-meta') || {}).textContent.trim();
      return m && /^2\/\d+ players/.test(m) && /you.re in/.test(m) ? m : false;
    }, pickupRow(pickupId), 'the row reading 2 joined · you’re in');
    return `before: "${before.meta}" [${before.acts}] · "${fb}" · after: "${after}"`;
  });

  await step(6, 'A reloads · the row reads 2 joined · inbox badge 1 · the join notification names B', [5], async () => {
    await reload(A.page);
    await openCourt(A.page);
    const meta = await waitFor(A.page, (sel) => {
      const r = document.querySelector(sel); const m = r && (r.querySelector('.pickup-meta') || {}).textContent.trim();
      return m && /^2\/\d+ players/.test(m) ? m : false;
    }, pickupRow(pickupId), 'the row reading 2 joined in A');
    if (!meta.includes(' · yours')) throw new Error(`row reads "${meta}": no "yours", so A's session did not survive the reload`);
    const badge = await waitFor(A.page, () => {
      const b = document.getElementById('inbox-btn'), c = document.getElementById('inbox-count');
      return b && !b.classList.contains('hidden') && c && !c.classList.contains('hidden') ? c.textContent.trim() : false;
    }, null, 'the inbox badge');
    if (badge !== '1') throw new Error(`inbox badge reads "${badge}", expected 1`);
    await A.page.click('#inbox-btn');
    const items = await waitFor(A.page, () => {
      const box = document.getElementById('inbox');
      if (!box.classList.contains('open')) return false;
      const t = Array.from(box.querySelectorAll('.inbox-item .inbox-text')).map(e => e.textContent.trim());
      return t.length ? t : false;
    }, null, 'inbox items');
    const hit = items.find(t => t.startsWith(`${B.who.display} joined your pickup at ${COURT.name}`));
    if (!hit) throw new Error(`inbox reads ${JSON.stringify(items)}`);
    await A.page.keyboard.press('Escape');            // closes the inbox (no sheet is open)
    return `row "${meta}" · badge ${badge} · "${hit}"`;
  });

  await step(7, "A's Mine list shows the pickup as organiser", [6], async () => {
    if (!(await A.page.evaluate(() => !!document.getElementById('mine-btn')))) return { skip: 'index.html has no #mine-btn (the M3 Mine list is not on this page)' };
    await waitFor(A.page, () => { const b = document.getElementById('mine-btn'); return !!b && !b.classList.contains('hidden'); }, null, '#mine-btn shown');
    await A.page.click('#mine-btn');
    const row = await waitFor(A.page, (id) => {
      const s = document.getElementById('sheet');
      if (!s || s.classList.contains('hidden') || s.dataset.kind !== 'mine') return false;
      const r = s.querySelector(`.mine-row[data-pickup="${id}"]`);
      if (!r) return false;
      return { title: document.getElementById('sheet-title').textContent.trim(), chip: (r.querySelector('.st-chip') || {}).textContent, meta: (r.querySelector('.pickup-meta') || {}).textContent.trim(), acts: Array.from(r.querySelectorAll('[data-act]')).map(b => b.dataset.act) };
    }, pickupId, 'the pickup in the Mine panel').catch(async (e) => {
      const rows = await A.page.evaluate(() => Array.from(document.querySelectorAll('#sheet .mine-row')).map(r => r.dataset.pickup));
      throw new Error(`${e.message}; Mine lists ${JSON.stringify(rows)}`);
    });
    if (!row.meta.includes('yours') || !row.acts.includes('invite')) throw new Error(`Mine row reads "${row.chip}" "${row.meta}" with actions [${row.acts}]`);
    await A.page.click('#sheet [data-act="close"]');
    return `"${row.title}" · ${row.chip} · "${row.meta}" · actions ${row.acts.join(' ')}`;
  });

  await step(8, 'B opens the share link · the detail panel opens on the court with the row highlighted', [5], async () => {
    const mine = await A.page.evaluate(() => window.Backend.myPickups());
    const m = (mine || []).find(p => p.id === pickupId);
    if (!m || !m.share_token) throw new Error(`Backend.myPickups() in A carries no share_token for ${pickupId}`);
    shareLink = `${PAGE_URL}#pickup=${m.share_token}`;
    await B.page.goto('about:blank');
    await B.page.goto(shareLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitShared(B.page);
    const got = await waitFor(B.page, (sel) => {
      if (!document.getElementById('detail-panel').classList.contains('open')) return false;
      const r = document.querySelector(sel);
      return r && r.classList.contains('highlight') ? { name: document.getElementById('detail-name').textContent.trim(), meta: (r.querySelector('.pickup-meta') || {}).textContent.trim() } : false;
    }, pickupRow(pickupId), 'the highlighted row from the link').catch(async (e) => {
      const d = await detail(B.page);
      throw new Error(`${e.message}; panel open ${d.open}, name "${d.name}", row ${JSON.stringify(await rowInfo(B.page, pickupId))}`);
    });
    if (got.name !== COURT.name) throw new Error(`panel opened on "${got.name}", expected "${COURT.name}"`);
    return `${PAGE_URL}#pickup=<token> → panel "${got.name}" · highlighted row "${got.meta}"`;
  });

  await browser.close();

  const fails = results.filter(r => r.status === 'FAIL').length;
  const summary = {
    ok: fails === 0,
    pageUrl: PAGE_URL,
    config: ROUTED ? { routed: true, supabaseUrl: SB_URL } : { routed: false, note: "the page's own assets/js/config.js" },
    court: { id: COURT_ID, name: COURT.name },
    players: WHO,
    pickupId,
    shareLink,
    steps: results,
    consoleErrors: { A: A.errors, B: B.errors },
    screenshots
  };
  console.log(`two-browsers: ${results.filter(r => r.status === 'PASS').length} passed, ${fails} failed, ${results.filter(r => r.status === 'SKIP').length} skipped`);
  if (A.errors.length || B.errors.length) console.log(`NOTE console/page errors (realtime handshakes and refused fetches already ignored): A ${A.errors.length}, B ${B.errors.length} — see the summary`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('two-browsers: aborted —', (e && e.stack) || String(e)); process.exit(1); });
