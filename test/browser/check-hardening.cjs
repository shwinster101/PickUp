// Hardening checks (v1.4.0; owner, 2026-11-07). Serve the repository root on PORT (8000) first, then
//   PORT=8000 node test/browser/check-hardening.cjs test/browser/fake-supabase.js <dir holding supabase.js>
// where the directory is dist/umd of the pinned package, straight from npm (jsDelivr serves the same file):
//   npm pack @supabase/supabase-js@2.45.4 && tar -xzf supabase-supabase-js-2.45.4.tgz   → package/dist/umd
// Prints one JSON object; exits 1 when a check fails.
//   time    — a Los Angeles device and a UTC device read the same Los Angeles wall clock (the UTC one with
//             PDT/PST beside it); the new-pickup form turns an LA wall time into the same instant on both
//   sri     — the npm file passes the page's integrity hash; a changed copy is refused and the page says
//             "Backend unreachable", not "Offline data"
//   captcha — with CAPTCHA_SITE_KEY the anonymous sign-in carries the Turnstile token; without it no
//             Turnstile script is requested and the sign-in carries nothing
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8000;
const FAKE = process.argv[2];
const SBJS_DIR = process.argv[3];
const PAGE = `http://localhost:${PORT}/`;
const config = (o) => `window.OPENCOURT_CONFIG = ${JSON.stringify(Object.assign({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', GOOGLE_MAP_ID: '', METRO: 'LA', CAPTCHA_SITE_KEY: '' }, o))};`;
const failures = [];
const expect = (ok, what, got) => { if (!ok) failures.push(`${what} — got ${JSON.stringify(got)}`); };
const JS = { status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' } };

async function open(browser, { tz, cfg, fake, stripIntegrity, cdn, turnstile }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: tz || 'UTC' });
  if (stripIntegrity) {      // the fake stands in for supabase-js, so its pin cannot hold here
    await ctx.route('**/*', async (r) => {
      if (r.request().resourceType() !== 'document') return r.fallback();
      const res = await r.fetch();
      return r.fulfill({ response: res, body: (await res.text()).replace(/\s+integrity="sha384-[^"]+"\s+crossorigin="anonymous"/, '') });
    });
  }
  await ctx.route('**/maps.googleapis.com/**', r => r.abort());
  await ctx.route('**/assets/js/config.js', r => r.fulfill(Object.assign({ body: cfg }, JS)));
  await ctx.route('**/cdn.jsdelivr.net/**', cdn || (r => r.fulfill(Object.assign({ body: '' }, JS))));
  const seen = { turnstile: 0 };
  await ctx.route('**/challenges.cloudflare.com/**', r => { seen.turnstile++; return turnstile ? r.fulfill(Object.assign({ body: turnstile }, JS)) : r.abort(); });
  if (fake) await ctx.addInitScript({ path: FAKE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 220)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 220)));
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.court-item').length > 0 && document.getElementById('data-source').textContent !== 'Loading…', null, { timeout: 30000 });
  return { ctx, page, errors, seen };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const out = {};

  // ---- time: the same instants on an LA device and a UTC device ----------------------------------
  const probe = () => ({
    summer: fmtWhen('2025-07-04T01:00:00Z'),                 // Thu 3 July 2025, 6:00 PM in Los Angeles (PDT)
    winter: fmtWhen('2025-12-01T02:30:00Z'),                 // Sun 30 November 2025, 6:30 PM (PST)
    formSummer: fromZonedInput('2025-07-03T18:00').toISOString(),
    formWinter: fromZonedInput('2025-11-30T18:30').toISOString(),
    roundTrip: toLocalInputValue(new Date('2025-07-04T01:00:00Z')),
    heuristicHour: zoned(new Date('2025-07-04T01:00:00Z')).h,
    heuristicWeekday: zoned(new Date('2025-07-04T01:00:00Z')).wd,
    clock: document.getElementById('current-time').textContent
  });
  for (const tz of ['America/Los_Angeles', 'UTC']) {
    const { ctx, page } = await open(browser, { tz, cfg: config({}) });
    out['time:' + tz] = await page.evaluate(probe);
    await ctx.close();
  }
  const la = out['time:America/Los_Angeles'], utc = out['time:UTC'];
  expect(la.summer === 'Thu, Jul 3 6:00 PM' && la.winter === 'Sun, Nov 30 6:30 PM', 'an LA device reads LA times with no zone tag', [la.summer, la.winter]);
  expect(utc.summer === 'Thu, Jul 3 6:00 PM PDT' && utc.winter === 'Sun, Nov 30 6:30 PM PST', 'a UTC device reads the same LA times, tagged', [utc.summer, utc.winter]);
  for (const t of [la, utc]) {
    expect(t.formSummer === '2025-07-04T01:00:00.000Z' && t.formWinter === '2025-12-01T02:30:00.000Z', 'the form reads an LA wall time as the same instant', [t.formSummer, t.formWinter]);
    expect(t.roundTrip === '2025-07-03T18:00', 'an instant fills the form in LA wall time', t.roundTrip);
    expect(t.heuristicHour === 18 && t.heuristicWeekday === 4, 'the heuristic sees 6 PM on a Thursday', [t.heuristicHour, t.heuristicWeekday]);
  }
  expect(/ P[DS]T$/.test(utc.clock) && !/ P[DS]T$/.test(la.clock), 'the header clock is tagged only elsewhere', [la.clock, utc.clock]);

  // ---- sri: the pinned file passes; a changed copy is refused, and the page says so --------------
  const file = (name) => path.join(SBJS_DIR, name);
  const unreachable = config({ SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'x' });
  for (const [label, body] of [['good', null], ['changed', fs.readFileSync(file('supabase.js'), 'utf8') + '\n/* changed */\n']]) {
    const { ctx, page, errors } = await open(browser, {
      cfg: unreachable,
      cdn: r => r.fulfill(Object.assign(body ? { body } : { path: file(path.basename(new URL(r.request().url()).pathname)) }, JS))
    });
    out['sri:' + label] = await page.evaluate(() => ({ client: !!window.supabase, backend: !!(window.Backend && window.Backend.enabled), source: document.getElementById('data-source').textContent }));
    out['sri:' + label].integrityError = errors.some(e => /integrity/i.test(e));
    await ctx.close();
  }
  expect(out['sri:good'].client && out['sri:good'].backend && !out['sri:good'].integrityError, 'the npm file passes the integrity hash', out['sri:good']);
  expect(!out['sri:changed'].client && !out['sri:changed'].backend && out['sri:changed'].integrityError, 'a changed file is refused', out['sri:changed']);
  expect(/^Backend unreachable/.test(out['sri:changed'].source), 'with the client refused the page says Backend unreachable', out['sri:changed'].source);

  // ---- captcha: the token rides the anonymous sign-in only when a site key is set -------------------
  const TURNSTILE = "window.turnstile = { render(el, o) { setTimeout(() => o.callback('tok-test-1'), 20); return 'w1'; }, remove() {} };";
  for (const [label, key] of [['on', 'test-site-key'], ['off', '']]) {
    const { ctx, page, seen } = await open(browser, {
      fake: true, stripIntegrity: true, turnstile: TURNSTILE,
      cfg: config({ SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'fake', CAPTCHA_SITE_KEY: key })
    });
    await page.click('.court-item[data-id="memorial-park-sm"]');
    await page.click('.report-btn[data-status="open"]');
    await page.waitForFunction(() => (document.getElementById('report-feedback') || {}).textContent, null, { timeout: 15000 });
    out['captcha:' + label] = await page.evaluate(() => ({
      signIns: window.__fake.auth.anon, feedback: document.getElementById('report-feedback').textContent,
      boxLeft: document.querySelectorAll('.captcha-box').length
    }));
    out['captcha:' + label].turnstileRequests = seen.turnstile;
    await ctx.close();
  }
  const on = out['captcha:on'], off = out['captcha:off'];
  expect(on.signIns.length === 1 && on.signIns[0] && on.signIns[0].options && on.signIns[0].options.captchaToken === 'tok-test-1', 'with a site key the sign-in carries the token', on.signIns);
  expect(on.turnstileRequests === 1 && on.boxLeft === 0 && /shared/.test(on.feedback), 'one Turnstile load, the box removed, the report shared', on);
  expect(off.signIns.length === 1 && off.signIns[0] === null && off.turnstileRequests === 0 && /shared/.test(off.feedback), 'without a key: no Turnstile, nothing extra on the sign-in', off);

  out.failures = failures;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
