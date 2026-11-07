const { chromium } = require('playwright');
const PORT = process.env.PORT || 8000; // serve the repo root on this port first
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(async e => { console.log('launch fallback:', e.message.split('\n')[0]); return chromium.launch({ args: ['--no-sandbox'] }); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // Offline on every machine: since a04ce05 the committed config.js names the real project, so without this
  // route a networked run read production (audit 2026-11-07). Empty values = the page's offline mode.
  await page.route('**/assets/js/config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript',
    body: "window.OPENCOURT_CONFIG = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', GOOGLE_MAP_ID: '', METRO: 'LA' };" }));
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on('requestfailed', r => logs.push(`[requestfailed] ${r.url().slice(0, 120)} ${r.failure() && r.failure().errorText}`));
  page.on('response', r => { if (r.url().includes('maps.googleapis.com')) logs.push(`[maps response] ${r.status()} ${r.url().slice(0, 100)}`); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(12000);
  const result = await page.evaluate(() => ({
    mapReady: typeof state !== 'undefined' ? state.mapReady : 'n/a',
    dataReady: typeof state !== 'undefined' ? state.dataReady : 'n/a',
    courts: typeof COURTS !== 'undefined' ? COURTS.length : 'n/a',
    pins: document.querySelectorAll('.gm-pin').length,
    advancedPins: document.querySelectorAll('gmp-advanced-marker').length,
    listRows: document.querySelectorAll('#court-list .court-row, #court-list [data-id]').length,
    keyWarningShown: !!document.querySelector('#key-warning.shown'),
    mapLoadingHidden: !!document.querySelector('#map-loading.hidden'),
    hasGoogle: typeof google !== 'undefined' && !!(google.maps),
    hasAdvanced: typeof google !== 'undefined' && !!(google.maps && google.maps.marker && google.maps.marker.AdvancedMarkerElement),
    theme: document.documentElement.getAttribute('data-theme'), authDialog: !!Array.from(document.querySelectorAll('div')).find(d => d.textContent && d.textContent.includes("can't load Google Maps correctly")), devWatermark: document.body.innerText.includes('For development purposes only'),
  }));
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: process.argv[2] || '/tmp/oc.png', fullPage: false });
  console.log('--- console/log lines (' + logs.length + ')');
  logs.forEach(l => console.log(l));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
