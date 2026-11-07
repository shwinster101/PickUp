// Backend-mode browser check against the fake supabase-js (test/browser/fake-supabase.js).
//   PORT=8030 NODE_PATH=... node test/browser/check-backend.cjs test/browser/fake-supabase.js /tmp/shot.png
// Serve the repository root on PORT first. The page's own config.js stays empty: this script routes
// it to a test config. Prints one JSON object; `errors` must be empty.
// Three browser contexts: (1) realtime SUBSCRIBED — the whole M2/M3 flow, a pushed event, the
// account rows (sign in · keep · confirm · sign out); (2) realtime CHANNEL_ERROR — no "live" on the
// face, the 60 s inbox poll kept (fake clock); (3) auth hashes — an #error=… link is shown in one
// line and cleaned, a #access_token=… hash breaks nothing and is cleaned.
const { chromium } = require('playwright');
const PORT = process.env.PORT || 8000;
const FAKE = process.argv[2];
const SHOT = process.argv[3];
const CONFIG = "window.OPENCOURT_CONFIG = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'fake', GOOGLE_MAP_ID: '', METRO: 'LA' };";

async function newPage(browser, realtime, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // The page pins supabase-js with an integrity hash (v1.4.0); here the fake stands in for it, so the page
  // is served without that one attribute. The real file and its hash: test/browser/check-hardening.cjs.
  // Registered first, so it runs last: config.js and the CDN routes below answer before it.
  await ctx.route('**/*', async (r) => {
    if (r.request().resourceType() !== 'document') return r.fallback();
    const res = await r.fetch();
    return r.fulfill({ response: res, body: (await res.text()).replace(/\s+integrity="sha384-[^"]+"\s+crossorigin="anonymous"/, '') });
  });
  await ctx.clock.install();                                   // real-time ticking; runFor() jumps ahead
  if (realtime !== undefined) await ctx.addInitScript({ content: `window.__fakeRealtime = ${JSON.stringify(realtime)};` });
  await ctx.addInitScript({ path: FAKE });
  await ctx.route('**/assets/js/config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: CONFIG }));
  // block the real supabase CDN so the fake stays in charge
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !/Map ID|Google Maps/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
  // No native dialogs anywhere on the page (project-conventions, v1.3.0): one is an error, not a no-op.
  page.on('dialog', d => { errors.push('native dialog: ' + d.type() + ' ' + d.message().slice(0, 100)); d.dismiss().catch(() => {}); });
  return { ctx, page };
}

const dataSource = (page) => page.evaluate(() => { const el = document.getElementById('data-source'); return { text: el.textContent, live: el.dataset.live, poll: el.dataset.poll }; });
const calls = (page, re) => page.evaluate((src) => window.__fake.calls.filter(c => new RegExp(src).test(c)).length, re.source);
const channels = (page) => page.evaluate(() => window.__fake.channels.map(c => ({ status: c.status, tables: c.handlers.map(h => h.opts.table + (h.opts.filter ? '[' + h.opts.filter.replace(/1111.*/, '1111…') + ']' : '')) })));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const out = {};

  // ---- context 1: realtime SUBSCRIBED -------------------------------------------------------
  const { page } = await newPage(browser, 'SUBSCRIBED', errors);
  await page.goto(`http://localhost:${PORT}/#pickup=abcdef0123456789`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(8000);
  const $t = (sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent, sel);
  const $n = (sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const sheet = () => page.evaluate(() => ({ open: !document.getElementById('sheet').classList.contains('hidden'), kind: document.getElementById('sheet').dataset.kind || null, title: document.getElementById('sheet-title').textContent, feedback: document.getElementById('sheet-feedback').textContent }));
  out.boot = await page.evaluate(() => ({ enabled: Backend.enabled, dataSource: document.getElementById('data-source').textContent, pins: document.querySelectorAll('.gm-pin').length, gamePins: document.querySelectorAll('.gm-pin.has-game').length, gameBadges: document.querySelectorAll('.game-badge').length,
    m3ButtonsHiddenBeforeProfile: ['me-btn', 'mine-btn', 'friends-btn'].every(id => document.getElementById(id).classList.contains('hidden')) }));
  out.boot.source = await dataSource(page);
  out.boot.channels = await channels(page);               // one channel, pickups only (no session yet)
  // deep link should have opened Memorial Park with the pickup row highlighted
  out.deepLink = await page.evaluate(() => ({ panelOpen: document.getElementById('detail-panel').classList.contains('open'), name: document.getElementById('detail-name').textContent, rows: document.querySelectorAll('.pickup-row').length, highlighted: document.querySelectorAll('.pickup-row.highlight').length, firstRow: (document.querySelector('.pickup-row') || {}).textContent }));
  // join without a profile → profile form appears
  await page.click('.pk-btn[data-act="join"]');
  await page.waitForTimeout(500);
  out.profileFormShown = await page.evaluate(() => !!document.getElementById('profile-form'));
  // the anonymous sign-in's SIGNED_IN re-rendered the court panel meanwhile; the form must survive it
  await page.waitForTimeout(600);
  out.profileFormSurvivesAuthRefresh = Object.assign(await page.evaluate(() => ({ form: !!document.getElementById('profile-form'), signInLink: !!document.querySelector('#profile-form [data-signin]') })), { authEvents: await page.evaluate(() => window.__fake.auth.events.slice()) });
  await page.fill('#profile-form input[name=display_name]', 'Ashwin');
  await page.fill('#profile-form input[name=username]', 'Ash_56');
  await page.click('#profile-form button[type=submit]');
  await page.waitForTimeout(800);
  out.afterJoin = await page.evaluate(() => ({ feedback: document.getElementById('pickup-feedback').textContent, firstRow: (document.querySelector('.pickup-row') || {}).textContent, leaveBtn: !!document.querySelector('.pk-btn[data-act="leave"]'), inboxHidden: document.getElementById('inbox-btn').classList.contains('hidden'), inboxCount: document.getElementById('inbox-count').textContent,
    m3ButtonsShown: ['me-btn', 'mine-btn', 'friends-btn'].every(id => !document.getElementById(id).classList.contains('hidden')), meBtn: document.getElementById('me-btn').textContent }));
  // the channel followed the session: the first one closed, the new one carries attendees + my inbox filter
  out.afterJoin.channels = await channels(page);
  out.afterJoin.source = await dataSource(page);
  // start a pickup
  await page.click('#pickup-new');
  await page.waitForTimeout(300);
  await page.fill('#pickup-form input[name=note]', 'Casual singles');
  await page.click('#pickup-form button[type=submit]');
  await page.waitForTimeout(800);
  out.afterCreate = await page.evaluate(() => ({ feedback: document.getElementById('pickup-feedback').textContent, rows: document.querySelectorAll('.pickup-row').length, hasCancel: !!document.querySelector('.pk-btn[data-act="cancel"]'), hasLink: !!document.querySelector('.pk-btn[data-act="link"]'), hasInvite: !!document.querySelector('#pickups-list .pk-btn[data-act="invite"]') }));
  // report via backend
  await page.click('.report-btn[data-status="open"]');
  await page.waitForTimeout(900);
  out.report = await page.evaluate(() => ({ feedback: document.getElementById('report-feedback').textContent, source: document.querySelector('.detail-status-source').textContent }));
  // inbox
  await page.click('#inbox-btn');
  await page.waitForTimeout(300);
  out.inbox = await page.evaluate(() => ({ open: document.getElementById('inbox').classList.contains('open'), items: document.querySelectorAll('.inbox-item').length, text: (document.querySelector('.inbox-text') || {}).textContent }));
  // The dropdown must be the element under the pointer, not merely .open: the header clips its overflow,
  // and a clipped inbox would show the badge and never the notifications. Checked at desktop and phone width.
  const inboxVisible = () => page.evaluate(() => {
    const box = document.getElementById('inbox'); const item = document.querySelector('.inbox-item') || box;
    const r = item.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
    return { top: Math.round(r.top), height: Math.round(r.height), hitInsideInbox: !!(hit && box.contains(hit)), hit: hit ? (hit.id || hit.className) : null };
  });
  out.inbox.visible1280 = await inboxVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
  out.inbox.visible390 = await inboxVisible();
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(250);
  for (const w of ['1280', '390']) if (!out.inbox['visible' + w].hitInsideInbox) errors.push(`inbox dropdown is not under the pointer at ${w}px (clipped or covered): ` + JSON.stringify(out.inbox['visible' + w]));

  // ---- M4: a pushed event refreshes the inbox and the court panel; no poll is due for minutes ----
  const snap = () => page.evaluate(() => ({ inboxCount: document.getElementById('inbox-count').textContent, inboxItems: document.querySelectorAll('.inbox-item').length,
    notesReads: window.__fake.calls.filter(c => c === 'from:my_notifications').length, courtsReads: window.__fake.calls.filter(c => c === 'from:courts_live').length, pickupsReads: window.__fake.calls.filter(c => c === 'from:open_pickups').length,
    row: (document.querySelector('.pickup-row[data-pickup="p-1"] .pickup-meta') || {}).textContent }));
  const before = await snap();
  const delivered = await page.evaluate(() => ({ notifyHandlers: window.__fake.notify('joined'), joinHandlers: window.__fake.someoneJoined() }));
  await page.waitForTimeout(1000);
  out.realtime = { delivered, before, after: await snap(), source: await dataSource(page) };
  // 61 s of page time: the inbox poll is stretched to 5 min while subscribed, so no read is due
  const polls0 = await calls(page, /^from:my_notifications$/);
  await page.clock.runFor(61000);
  await page.waitForTimeout(400);
  out.realtime.pollReadsIn61s = (await calls(page, /^from:my_notifications$/)) - polls0;

  // ---- M3: Mine ----------------------------------------------------------------------------
  await page.click('#mine-btn');
  await page.waitForTimeout(600);
  out.mine = Object.assign(await sheet(), await page.evaluate(() => ({
    inboxClosed: !document.getElementById('inbox').classList.contains('open'),
    rows: Array.from(document.querySelectorAll('.mine-row')).map(r => ({ id: r.dataset.pickup, chip: r.querySelector('.st-chip').textContent, action: Array.from(r.querySelectorAll('.pickup-btns button, .pickup-btns span')).map(b => b.textContent.trim()).join(' | ') }))
  })));
  // One header layer at a time: with Mine open, the bell closes the sheet and opens the inbox on top;
  // Escape then closes the inbox (the layer the player sees), and Mine reopens for the steps below.
  await page.click('#inbox-btn');
  await page.waitForTimeout(250);
  out.bellOverSheet = Object.assign(await sheet(), { inboxOpen: await page.evaluate(() => document.getElementById('inbox').classList.contains('open')), inbox: await inboxVisible() });
  if (out.bellOverSheet.open || !out.bellOverSheet.inboxOpen || !out.bellOverSheet.inbox.hitInsideInbox) errors.push('the bell did not replace the open sheet with a visible inbox: ' + JSON.stringify(out.bellOverSheet));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  out.bellOverSheet.escapeClosedInbox = await page.evaluate(() => !document.getElementById('inbox').classList.contains('open'));
  await page.click('#mine-btn');
  await page.waitForTimeout(600);
  // Enter result on the in-progress pickup I organise: me → T1, bsmith → T2, sets, winner 1
  await page.click('.mine-row[data-pickup="p-live"] [data-act="result"]');
  await page.waitForTimeout(500);
  out.resultForm = Object.assign(await sheet(), { players: await $n('#result-form .result-player'), backShown: await page.evaluate(() => !document.getElementById('sheet-back').classList.contains('hidden')) });
  await page.click('.result-player[data-player="11111111-1111-1111-1111-111111111111"] [data-team="1"]');
  await page.waitForTimeout(150);
  await page.click('.result-player[data-player="22222222-2222-2222-2222-222222222222"] [data-team="2"]');
  await page.waitForTimeout(150);
  await page.fill('#result-sets', '6-4 3-6 10-7');
  await page.check('#result-form input[name=winner][value="1"]');
  out.resultToggles = await page.evaluate(() => Array.from(document.querySelectorAll('.seg.on')).map(b => b.dataset.player.slice(0, 2) + ':T' + b.dataset.team));
  await page.click('#result-form button[type=submit]');
  await page.waitForTimeout(700);
  out.afterResult = Object.assign(await sheet(), await page.evaluate(() => { const r = document.querySelector('.mine-row[data-pickup="p-live"]'); return { chip: r && r.querySelector('.st-chip').textContent, rowClass: r && r.className, action: r && r.querySelector('.pickup-btns').textContent.trim() }; }));
  // Vote MVP on the closed pickup I played
  await page.click('.mine-row[data-pickup="p-done"] [data-act="vote"]');
  await page.waitForTimeout(500);
  out.voteForm = Object.assign(await sheet(), { candidates: await page.evaluate(() => Array.from(document.querySelectorAll('.vote-row')).map(b => b.textContent.trim().replace(/\s+/g, ' '))) });
  await page.click('.vote-row[data-player="22222222-2222-2222-2222-222222222222"]');
  await page.waitForTimeout(600);
  out.afterVote = Object.assign(await sheet(), await page.evaluate(() => { const r = document.querySelector('.mine-row[data-pickup="p-done"]'); return { chip: r && r.querySelector('.st-chip').textContent, action: r && r.querySelector('.pickup-btns').textContent.trim() }; }));
  // Escape closes the top layer (the only layer here → the sheet closes)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  out.escapeClosesSheet = !(await sheet()).open;

  // ---- M3: Friends ------------------------------------------------------------------------
  await page.click('#friends-btn');
  await page.waitForTimeout(500);
  out.friendsEmpty = Object.assign(await sheet(), { friends: await $n('#friend-list .friend-row'), search: await page.evaluate(() => !!document.getElementById('friend-q')) });
  await page.fill('#friend-q', 'b');
  await page.waitForTimeout(450);
  out.searchOneChar = { results: await $n('#friend-results .friend-row'), searchCalls: await page.evaluate(() => window.__fake.calls.filter(c => c.startsWith('rpc:search_players')).length) };
  await page.fill('#friend-q', 'bs');
  await page.waitForTimeout(600);
  out.search = { results: await $n('#friend-results .friend-row'), first: await $t('#friend-results .friend-row'), action: await $t('#friend-results .friend-row [data-act]'), searchCalls: await page.evaluate(() => window.__fake.calls.filter(c => c.startsWith('rpc:search_players')).length) };
  await page.click('#friend-results [data-act="friend-add"]');
  await page.waitForTimeout(600);
  out.afterAdd = Object.assign(await sheet(), { action: await $t('#friend-results .friend-row [data-act]'), edges: await page.evaluate(() => window.__fake.edges()) });
  // the fake flips it: B asked me instead → an incoming request with a badge
  await page.evaluate(() => window.__fake.flipToIncoming('bsmith'));
  await page.click('#sheet [data-act="close"]');
  await page.waitForTimeout(100);
  await page.click('#friends-btn');
  await page.waitForTimeout(500);
  out.incoming = Object.assign(await sheet(), { requests: await $n('#friend-incoming .friend-row'), badge: await $t('#friends-count'), badgeHidden: await page.evaluate(() => document.getElementById('friends-count').classList.contains('hidden')), actions: await page.evaluate(() => Array.from(document.querySelectorAll('#friend-incoming [data-act]')).map(b => b.dataset.act)) });
  await page.click('#friend-incoming [data-act="friend-accept"]');
  await page.waitForTimeout(600);
  out.afterAccept = Object.assign(await sheet(), { friends: await $n('#friend-list .friend-row'), friendRow: await $t('#friend-list .friend-row'), requests: await $n('#friend-incoming .friend-row'), badgeHidden: await page.evaluate(() => document.getElementById('friends-count').classList.contains('hidden')) });
  // Friends ✓ → two taps to remove: the first arms, nothing is sent
  await page.click('#friend-list [data-act="friend-remove"]');
  await page.waitForTimeout(300);
  out.removeArmed = { label: await $t('#friend-list [data-act="friend-remove"]'), removeCalls: await page.evaluate(() => window.__fake.calls.filter(c => c.startsWith('rpc:remove_friend')).length), stillFriends: await $n('#friend-list .friend-row') };

  // ---- M3: Invite from my open pickup (p-new) --------------------------------------------
  await page.click('#mine-btn');
  await page.waitForTimeout(600);
  await page.click('.mine-row[data-pickup="p-new"] [data-act="invite"]');
  await page.waitForTimeout(600);
  out.invite = Object.assign(await sheet(), { candidates: await page.evaluate(() => Array.from(document.querySelectorAll('#invite-list .friend-row')).map(r => r.querySelector('.friend-name').textContent)), roster: await page.evaluate(() => Array.from(document.querySelectorAll('#invite-roster .friend-row')).map(r => r.querySelector('.friend-name').textContent + ':' + r.querySelector('.st-chip').textContent)) });
  await page.click('#invite-list [data-act="invite-send"]');
  await page.waitForTimeout(600);
  out.afterInvite = Object.assign(await sheet(), { candidates: await $n('#invite-list .friend-row'), roster: await page.evaluate(() => Array.from(document.querySelectorAll('#invite-roster .friend-row')).map(r => r.querySelector('.friend-name').textContent + ':' + r.querySelector('.st-chip').textContent)), inviteCall: await page.evaluate(() => window.__fake.calls.find(c => c.startsWith('rpc:invite_to_pickup'))) });
  // ‹ Back returns to Mine (Escape would too)
  await page.click('#sheet-back');
  await page.waitForTimeout(500);
  out.backToMine = await sheet();

  // ---- M3: Profile sheet -----------------------------------------------------------------
  await page.click('#me-btn');
  await page.waitForTimeout(600);
  out.profile = Object.assign(await sheet(), await page.evaluate(() => ({
    name: (document.querySelector('.prof-name') || {}).textContent, user: (document.querySelector('.prof-user') || {}).textContent,
    standing: Array.from(document.querySelectorAll('.stand-tile')).map(t => t.querySelector('.stand-num').textContent + ' ' + t.querySelector('.stand-label').textContent.trim()),
    formulaHidden: document.getElementById('stand-formula').classList.contains('hidden')
  })));
  await page.click('#standing [data-act="formula"]');
  await page.waitForTimeout(100);
  out.formula = await page.evaluate(() => ({ hidden: document.getElementById('stand-formula').classList.contains('hidden'), text: document.getElementById('stand-formula').textContent }));

  // ---- M4: account rows on an anonymous session ------------------------------------------
  const acct = () => page.evaluate(() => ({ keepForm: !!document.getElementById('keep-form'), signInForm: !!document.getElementById('signin-form'), signOut: !!document.querySelector('#acct [data-act="signout"]'),
    email: (document.querySelector('#acct .acct-email') || {}).textContent || null, notes: Array.from(document.querySelectorAll('#acct .pickup-form-note')).map(n => n.textContent.trim()) }));
  out.accountAnon = await acct();
  // Sign in on another device: a magic link, never a new account
  await page.fill('#signin-form input[name=email]', 'ash@example.com');
  await page.click('#signin-form button[type=submit]');
  await page.waitForTimeout(400);
  out.signIn = Object.assign(await sheet(), { otp: await page.evaluate(() => window.__fake.auth.otps[0]) });
  // Keep this account: link the email; pending until the click
  await page.fill('#keep-form input[name=email]', 'ash@example.com');
  await page.click('#keep-form button[type=submit]');
  await page.waitForTimeout(700);
  out.keep = Object.assign(await sheet(), { update: await page.evaluate(() => window.__fake.auth.updates[0]) }, { acct: await acct() });
  // the confirmation link is clicked elsewhere → a new, permanent session arrives (SIGNED_IN)
  const upserts0 = await calls(page, /^rpc:upsert_profile/);
  await page.evaluate(() => window.__fake.confirmEmail());
  await page.waitForTimeout(1000);
  out.confirmed = { acct: await acct(), upsertsAfterConfirm: (await calls(page, /^rpc:upsert_profile/)) - upserts0, profileIsAnonymous: await page.evaluate(() => window.__fake.profile().is_anonymous), sheet: await sheet(), source: await dataSource(page) };
  await page.screenshot({ path: SHOT });
  // Sign out: two taps; the first arms and sends nothing
  await page.click('#acct [data-act="signout"]');
  await page.waitForTimeout(200);
  out.signOutArmed = { label: await $t('#acct [data-act="signout"]'), events: await page.evaluate(() => window.__fake.auth.events.filter(e => e === 'SIGNED_OUT').length) };
  await page.click('#acct [data-act="signout"]');
  await page.waitForTimeout(1000);
  out.signedOut = Object.assign({ sheet: await sheet() }, await page.evaluate(() => ({ events: window.__fake.auth.events.slice(), headerHidden: ['me-btn', 'mine-btn', 'friends-btn', 'inbox-btn'].every(id => document.getElementById(id).classList.contains('hidden')) })), { source: await dataSource(page), channels: (await channels(page)).slice(-1) });

  out.calls = await page.evaluate(() => window.__fake.calls.slice(0, 30));
  out.m3calls = await page.evaluate(() => window.__fake.calls.filter(c => /rpc:(search_players|send_friend|accept_friend|invite_to|record_result|vote_mvp)|from:(friendships|mvp_votes|player_standing)/.test(c)));
  await page.context().close();

  // ---- context 2: realtime CHANNEL_ERROR → no "live", the 60 s poll kept ------------------
  {
    const { page: p2 } = await newPage(browser, 'CHANNEL_ERROR', errors);
    await p2.goto(`http://localhost:${PORT}/#pickup=abcdef0123456789`, { waitUntil: 'load', timeout: 60000 });
    await p2.waitForTimeout(6000);
    const r = { boot: await dataSource(p2), channels: await channels(p2) };
    await p2.click('.pk-btn[data-act="join"]');
    await p2.waitForTimeout(600);
    await p2.fill('#profile-form input[name=display_name]', 'Ashwin');
    await p2.fill('#profile-form input[name=username]', 'Ash_56');
    await p2.click('#profile-form button[type=submit]');
    await p2.waitForTimeout(1000);
    r.afterJoin = await dataSource(p2);
    r.afterJoinChannels = await channels(p2);
    // The court panel's Cancel is two-tap armed like Mine's: the first tap reads "Sure?" and sends nothing;
    // the second sends cancel_pickup once. No native confirm (a dialog would land in `errors` above).
    await p2.click('#pickup-new');
    await p2.waitForTimeout(300);
    await p2.click('#pickup-form button[type=submit]');
    await p2.waitForTimeout(800);
    const cancelSel = '#pickups-list .pk-btn[data-act="cancel"]';
    const cancelCalls = () => p2.evaluate(() => window.__fake.calls.filter(c => c.startsWith('rpc:cancel_pickup')).length);
    r.cancelBefore = { label: await p2.evaluate((s) => (document.querySelector(s) || {}).textContent, cancelSel), calls: await cancelCalls() };
    await p2.click(cancelSel);
    await p2.waitForTimeout(250);
    r.cancelArmed = { label: await p2.evaluate((s) => (document.querySelector(s) || {}).textContent, cancelSel), sure: await p2.evaluate((s) => (document.querySelector(s) || { dataset: {} }).dataset.sure || null, cancelSel), calls: await cancelCalls() };
    await p2.click(cancelSel);
    await p2.waitForTimeout(700);
    r.cancelSent = { calls: await cancelCalls(), feedback: await p2.evaluate(() => document.getElementById('pickup-feedback').textContent) };
    if (r.cancelBefore.label !== 'Cancel' || r.cancelArmed.label !== 'Sure?' || r.cancelArmed.calls !== 0 || r.cancelSent.calls !== 1 || r.cancelSent.feedback !== 'Pickup cancelled.') errors.push('court-panel Cancel is not two-tap armed: ' + JSON.stringify({ before: r.cancelBefore, armed: r.cancelArmed, sent: r.cancelSent }));
    const polls0 = await calls(p2, /^from:my_notifications$/);
    const courts0 = await calls(p2, /^from:courts_live$/);
    await p2.clock.runFor(61000);
    await p2.waitForTimeout(500);
    r.pollReadsIn61s = (await calls(p2, /^from:my_notifications$/)) - polls0;
    await p2.clock.runFor(240000);
    await p2.waitForTimeout(500);
    r.courtsReadsIn5min = (await calls(p2, /^from:courts_live$/)) - courts0;
    r.pushedEventReaches = await p2.evaluate(() => window.__fake.notify('joined'));   // nobody is subscribed
    r.end = await dataSource(p2);
    out.channelError = r;
    await p2.context().close();
  }

  // ---- context 3: auth hashes are not pickup links -------------------------------------------
  {
    const { page: p3 } = await newPage(browser, 'SUBSCRIBED', errors);
    await p3.goto(`http://localhost:${PORT}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: 'load', timeout: 60000 });
    await p3.waitForTimeout(5000);
    const r = await p3.evaluate(() => ({ notice: document.getElementById('auth-notice').textContent, noticeHidden: document.getElementById('auth-notice').classList.contains('hidden'), hash: location.hash, href: location.href, panelOpen: document.getElementById('detail-panel').classList.contains('open') }));
    await p3.evaluate(() => { location.hash = '#access_token=abc.def.ghi&refresh_token=xyz&expires_in=3600&token_type=bearer&type=magiclink'; });
    await p3.waitForTimeout(800);
    r.afterTokenHash = await p3.evaluate(() => ({ hash: location.hash, href: location.href, panelOpen: document.getElementById('detail-panel').classList.contains('open') }));
    await p3.evaluate(() => { location.hash = '#pickup=abcdef0123456789'; });
    await p3.waitForTimeout(1200);
    r.pickupLinkStillWorks = await p3.evaluate(() => ({ panelOpen: document.getElementById('detail-panel').classList.contains('open'), name: document.getElementById('detail-name').textContent }));
    out.authHash = r;
    await p3.context().close();
  }

  out.errors = errors;
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED', String(e).slice(0, 800)); process.exit(1); });
