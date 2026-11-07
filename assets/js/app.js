/* ============================================================
   OPENCOURT — main application (PickUp's successor)
   v1.2.0
   ============================================================
   This file is responsible for:
   - Loading courts (shared backend when configured, bundled JSON otherwise)
   - Initializing Google Maps with auto-fit bounds
   - Rendering the court list + map markers + stats
   - Wiring filters, selection, and the detail panel
   - Crowd reports: shared through the backend, or kept on this device
   - Pickups on a court: list, start, join, leave, cancel, share (backend only)
   - The inbox (backend only)
   - The M3 sheet: Mine (my pickups: result, MVP vote, invite), Friends,
     Invite, Result, Vote, Profile with standing (backend only)
   - M4: one realtime channel while it is honest ("· live" only while
     SUBSCRIBED), polling otherwise; the account rows (keep this account ·
     sign in on another device · sign out) and the auth-event refresh
   - Applying the seasonal Grand Slam theme

   Honesty rule: the page always says where its data comes from
   (#data-source) and never labels a device-local report as shared.
   ============================================================ */

// In-memory state
let COURTS = [];
let GRAND_SLAMS = [];

const REPORT_TTL_MINUTES = 90;
const STORAGE_KEY = 'opencourt-la-reports-v1';
const CFG = window.OPENCOURT_CONFIG || {};
const BE = (window.Backend && window.Backend.enabled) ? window.Backend : null;

const state = {
  filters: { sport: "all", tier: "all", status: "all" },
  selectedId: null,
  markers: {},
  map: null,
  mapReady: false,
  dataReady: false,
  dataSource: 'offline',      // 'live' | 'offline' | 'offline-fallback'
  pickups: {},                // courtId -> rows from open_pickups
  mine: {},                   // pickupId -> my_pickups row
  me: null,                   // my profile (backend only)
  highlightPickup: null,      // pickup id opened from a share link
  highlightCourt: null,       // the court that pickup sits on (the highlight survives re-renders there)
  highlightShown: false,      // scrolled to it once
  inbox: [],
  inboxOpen: false,
  // M3 sheet
  sheets: [],                 // stack of { kind, data }; the top one is rendered
  confirm: null,              // 'act:id' of a two-tap button that is armed
  minePickups: [],            // my_pickups rows, newest first
  mineFresh: false,           // false → the Mine panel re-reads before it renders
  myVotes: {},                // pickupId -> votee id (my own mvp_votes)
  names: {},                  // profile id -> display name (MVPs, friends)
  friends: { fresh: false, edges: [], incoming: [], list: [], query: '', results: [] },
  // M4 realtime: status is the channel's last word (SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED | null);
  // uid is the session the channel was opened for; seq retires a channel's callbacks when a newer one opens.
  rt: { status: null, uid: null, seq: 0, unsub: null, pollInbox: null, pollCourts: null, inboxEvery: 0, kicks: {} }
};

const live = () => !!BE && state.dataSource === 'live';

/* ============================================================
   SMALL HELPERS
   ============================================================ */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

function sportEmoji(s) {
  return { tennis: '🎾', pickleball: '🏓', basketball: '🏀' }[s] || '🏟️';
}

function toLocalInputValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function flash(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.add('shown');
}

/* ============================================================
   DATA LOADING
   ============================================================ */
function normaliseCourt(c) {
  return Object.assign({}, c, {
    live_reports: Array.isArray(c.live_reports) ? c.live_reports : [],
    last_reported_availability: c.last_reported_availability || null,
    open_pickup_count: c.open_pickup_count || 0
  });
}

async function fetchCourts() {
  if (BE) {
    try {
      const rows = await BE.fetchCourts();
      state.dataSource = 'live';
      return rows.map(normaliseCourt);
    } catch (e) {
      console.warn('Backend unreachable; using bundled courts.json', e);
      state.dataSource = 'offline-fallback';
    }
  }
  const res = await fetch('assets/data/courts.json');
  if (!res.ok) throw new Error(`Failed to load courts.json: ${res.status}`);
  const data = await res.json();
  return data.courts.map(normaliseCourt);
}

async function fetchSlams() {
  const res = await fetch('assets/data/grand-slams.json');
  if (!res.ok) throw new Error(`Failed to load grand-slams.json: ${res.status}`);
  const data = await res.json();
  return data.slams;
}

function renderDataSource() {
  const el = document.getElementById('data-source');
  if (!el) return;
  const text = {
    'live': 'Shared data',
    'offline': 'Offline data · reports stay on this device',
    'offline-fallback': 'Backend unreachable · bundled data · reports stay on this device'
  }[state.dataSource];
  // "· live" only while the realtime channel reports SUBSCRIBED; otherwise the page polls and claims nothing more.
  const liveNow = rtLive();
  el.textContent = liveNow ? `${text} · live` : text;
  el.dataset.source = state.dataSource;
  el.dataset.live = liveNow ? '1' : '0';
  el.dataset.poll = live() && state.rt.inboxEvery ? String(state.rt.inboxEvery / 1000) : '';
  // One tap deep: what "live" covers. Reports are not in the publication (0005), so they stay on the 5-minute
  // read either way; polling names both cadences (the inbox every minute until setPolling runs, inboxEvery 0).
  el.title = liveNow ? 'Pickups and your inbox arrive as they happen · reports refresh every 5 min'
    : live() ? `Inbox every ${state.rt.inboxEvery >= 300000 ? '5 min' : 'minute'} · reports every 5 min` : '';
}

/* ============================================================
   SEASONAL THEME ENGINE
   ============================================================ */
function getCurrentSlamTheme(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  for (let i = GRAND_SLAMS.length - 1; i >= 0; i--) {
    if (today >= GRAND_SLAMS[i].activate) {
      return GRAND_SLAMS[i];
    }
  }
  return GRAND_SLAMS[0];
}

function applyTheme() {
  if (GRAND_SLAMS.length === 0) return;
  const slam = getCurrentSlamTheme();
  document.documentElement.setAttribute('data-theme', slam.id);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const inProgress = today >= slam.start && today <= slam.end;

  document.getElementById('slam-name').textContent = inProgress
    ? `${slam.name} — Live`
    : `Next: ${slam.name}`;

  const startDate = new Date(slam.start);
  const daysUntil = Math.ceil((startDate - now) / (1000 * 60 * 60 * 24));

  const hint = document.getElementById('hint-body');
  const hintTitle = document.getElementById('hint-title');
  const surface = slam.surface.charAt(0).toUpperCase() + slam.surface.slice(1);

  if (inProgress) {
    hintTitle.textContent = `${slam.name} is live`;
    hint.textContent = `${surface} season. Theme matches the tournament — check back as we roll through the calendar.`;
  } else if (daysUntil <= 7 && daysUntil >= 0) {
    hintTitle.textContent = `${slam.name} in ${daysUntil}d`;
    hint.textContent = `Theme shifts to celebrate the upcoming slam. ${surface} court colors take over.`;
  } else if (daysUntil < 0) {
    hintTitle.textContent = `${slam.name} just finished`;
    hint.textContent = `Background still tuned to ${slam.surface} until the next slam's window opens.`;
  } else {
    hintTitle.textContent = `Next slam: ${slam.name}`;
    hint.textContent = `${daysUntil} days out. Background tuned to ${slam.surface}.`;
  }
}

/* ============================================================
   LIVE REPORTS
   Shared through the backend when it is configured and reachable;
   otherwise kept in this browser's localStorage (and labelled so).
   ============================================================ */
function loadReports() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Could not load reports', e);
    return {};
  }
}

function saveReports(reports) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch (e) {
    console.warn('Could not save reports', e);
  }
}

function applyReportToCourt(court, status, timestamp) {
  const rep = { status, timestamp };
  court.live_reports = [...(court.live_reports || []), rep].slice(-5);
  court.last_reported_availability = rep;
}

// Returns { shared: boolean }. Throws (with a readable message) when the backend refuses.
async function submitReport(courtId, status) {
  const court = COURTS.find(c => c.id === courtId);
  if (live()) {
    const row = await BE.submitReport(courtId, status);
    if (court) applyReportToCourt(court, row.status, row.created_at);
    return { shared: true };
  }
  const reports = loadReports();
  const now = new Date().toISOString();
  if (!reports[courtId]) reports[courtId] = [];
  reports[courtId].push({ status, timestamp: now });
  if (reports[courtId].length > 5) reports[courtId] = reports[courtId].slice(-5);
  saveReports(reports);
  if (court) applyReportToCourt(court, status, now);
  return { shared: false };
}

function hydrateReportsIntoCourts() {
  if (live()) return; // the view already carries everyone's reports
  const reports = loadReports();
  COURTS.forEach(court => {
    if (reports[court.id] && reports[court.id].length > 0) {
      court.live_reports = reports[court.id];
      court.last_reported_availability = reports[court.id][reports[court.id].length - 1];
    }
  });
}

/* ============================================================
   AVAILABILITY SCORING
   Live reports (if fresh, < REPORT_TTL_MINUTES) override the
   heuristic. Heuristic uses day, hour, court count, demand tier.
   ============================================================ */
function scoreAvailability(court, now = new Date()) {
  if (court.last_reported_availability) {
    const reportAge = (now - new Date(court.last_reported_availability.timestamp)) / 60000;
    if (reportAge < REPORT_TTL_MINUTES) {
      return { status: court.last_reported_availability.status, source: 'live', ageMin: Math.round(reportAge) };
    }
  }

  const hour = now.getHours();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6);

  let pressure;
  if (hour < 7) pressure = 0;
  else if (hour < 10) pressure = 1;
  else if (hour < 15) pressure = 2;
  else if (hour < 17) pressure = 3;
  else if (hour < 21) pressure = 4;
  else pressure = 1;

  if (isWeekend && hour >= 9 && hour <= 18) pressure += 1;

  const demandBoost = { low: 0, medium: 1, high: 2 }[court.demand_tier] || 0;
  pressure += demandBoost;

  if (court.court_count >= 10) pressure -= 2;
  else if (court.court_count >= 6) pressure -= 1;
  else if (court.court_count <= 2) pressure += 1;

  if (court.tier === "private") return { status: "full", source: "heuristic", ageMin: null };

  let status;
  if (pressure <= 1) status = "open";
  else if (pressure <= 3) status = "toss";
  else status = "full";

  return { status, source: "heuristic", ageMin: null };
}

function availabilityLabel(status) {
  return { open: "Likely open", toss: "Toss-up", full: "Likely full" }[status];
}

function availabilityNote(score, court) {
  if (score.source === 'live') {
    return live()
      ? `Reported ${score.ageMin} min ago by a player on the ground.`
      : `Reported ${score.ageMin} min ago on this device.`;
  }
  const hour = new Date().getHours();
  const isEvening = hour >= 17 && hour <= 21;
  if (court.tier === "private") return "Private facility — public access not available.";
  if (score.status === "open") return court.court_count >= 6
    ? "Plenty of courts, low demand right now."
    : "Quiet window — good time to head over.";
  if (score.status === "toss") return isEvening
    ? "Evening pressure rising. Worth a call ahead if possible."
    : "Could go either way — moderate demand expected.";
  return court.demand_tier === "high"
    ? "High-demand spot at peak hours. Expect a wait."
    : "Limited courts during a busy window.";
}

/* ============================================================
   GOOGLE MAPS INITIALIZATION
   Called by the Google Maps script tag via &callback=initMap
   ============================================================ */
window.initMap = function() {
  state.mapReady = true;
  if (state.dataReady) buildMap();
};

// Advanced Markers need a Map ID (and a Map ID makes Google ignore the JSON style below).
// Without a configured Map ID the page draws its own pins through an OverlayView, which keeps
// the editorial style. Found in the 2026-10-17 review: the previous build used Advanced Markers
// on a map without a Map ID and rendered no pins at all.
const useAdvancedMarkers = () => !!CFG.GOOGLE_MAP_ID && !!(google.maps.marker && google.maps.marker.AdvancedMarkerElement);

function buildMap() {
  document.getElementById('map-loading').classList.add('hidden');
  // A map that loads after the 5 s timer (slow network) must not keep the "map unavailable" banner over it.
  document.getElementById('key-warning')?.classList.remove('shown');

  // Subtle, editorial-atlas map style
  const mapStyle = [
    { elementType: "geometry", stylers: [{ color: "#ebe4d4" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f4efe6" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#5a3c2a" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#dce8d3" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#faf2e3" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d4be99" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f5e5c4" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#c89028" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#bcd3df" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5a8095" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] }
  ];

  const options = {
    zoom: 10,
    center: { lat: 34.15, lng: -118.35 },
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    gestureHandling: 'greedy'
  };
  if (CFG.GOOGLE_MAP_ID) options.mapId = CFG.GOOGLE_MAP_ID;
  else options.styles = mapStyle;

  state.map = new google.maps.Map(document.getElementById('map'), options);

  // Fit bounds to all courts (Antelope Valley → South Bay)
  const bounds = new google.maps.LatLngBounds();
  COURTS.forEach(c => bounds.extend({ lat: c.lat, lng: c.lng }));
  state.map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

  renderAll();
}

function createMarker(court) {
  const score = scoreAvailability(court);
  const hasLive = score.source === 'live';
  const hasGame = (court.open_pickup_count || 0) > 0;

  const pinEl = document.createElement('div');
  pinEl.className = `gm-pin ${score.status}${hasLive ? ' has-live' : ''}${hasGame ? ' has-game' : ''}`;
  pinEl.dataset.id = court.id;
  pinEl.textContent = court.court_count;
  pinEl.title = `${court.name} — ${availabilityLabel(score.status)}${hasGame ? ` — ${court.open_pickup_count} pickup${court.open_pickup_count > 1 ? 's' : ''} on` : ''}`;
  pinEl.setAttribute('role', 'button');
  pinEl.setAttribute('aria-label', pinEl.title);

  let marker;
  if (useAdvancedMarkers()) {
    marker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: court.lat, lng: court.lng },
      map: state.map,
      content: pinEl,
      title: court.name
    });
    pinEl.addEventListener('click', () => selectCourt(court.id, { fly: false }));
  } else {
    const overlay = new google.maps.OverlayView();
    overlay.onAdd = function() {
      this.getPanes().overlayMouseTarget.appendChild(pinEl);
      pinEl.style.position = 'absolute';
      pinEl.addEventListener('click', () => selectCourt(court.id, { fly: false }));
    };
    overlay.draw = function() {
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(court.lat, court.lng));
      pinEl.style.left = (point.x - 15) + 'px';
      pinEl.style.top = (point.y - 15) + 'px';
    };
    overlay.onRemove = function() { pinEl.remove(); };
    overlay.setMap(state.map);
    marker = overlay;
    marker._pinEl = pinEl;
  }
  return marker;
}

function removeMarker(marker) {
  if (marker.setMap) marker.setMap(null);
  else if (marker.map !== undefined) marker.map = null;
}

/* ============================================================
   RENDER
   ============================================================ */
function visibleCourts() {
  return COURTS.filter(c => {
    if (state.filters.sport !== "all" && !c.sports.includes(state.filters.sport)) return false;
    if (state.filters.tier !== "all" && c.tier !== state.filters.tier) return false;
    if (state.filters.status !== "all" && scoreAvailability(c).status !== state.filters.status) return false;
    return true;
  });
}

function renderList() {
  const list = document.getElementById('court-list');
  const visible = visibleCourts();

  if (visible.length === 0) {
    list.innerHTML = `<div style="padding:32px 24px;text-align:center;color:var(--ink-mute);font-size:13px;">
      No courts match these filters.<br><span style="font-size:11px;">Try widening your search.</span>
    </div>`;
    return;
  }

  list.innerHTML = visible.map(c => {
    const score = scoreAvailability(c);
    const tierClass = `tier-${c.tier.replace('-', '')}`;
    const tierLabel = { "free": "Free", "low-cost": "Low-cost", "private": "Private" }[c.tier];
    const liveBadge = score.source === 'live'
      ? `<span class="live-badge"><span class="live-dot"></span>Live</span>`
      : '';
    const gameBadge = c.open_pickup_count > 0
      ? `<span class="game-badge" title="${c.open_pickup_count} pickup${c.open_pickup_count > 1 ? 's' : ''} on">🎾 ${c.open_pickup_count}</span>`
      : '';
    return `
      <div class="court-item ${state.selectedId === c.id ? 'selected' : ''}" data-id="${esc(c.id)}" role="button" tabindex="0">
        <div class="court-row">
          <div style="flex:1; min-width: 0;">
            <div class="court-name">${esc(c.name)}</div>
            <div class="court-meta">
              <span>${esc(c.neighborhood)}</span>
              <span class="court-meta-dot"></span>
              <span class="tier-badge ${tierClass}">${tierLabel}</span>
              <span class="court-meta-dot"></span>
              <span>${esc(c.court_count)} courts</span>
              ${liveBadge}${gameBadge}
            </div>
          </div>
          <div class="availability-indicator">
            <span class="avail-dot ${score.status}"></span>
            <span class="avail-label ${score.status}">${availabilityLabel(score.status).replace('Likely ','')}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.court-item').forEach(el => {
    el.addEventListener('click', () => selectCourt(el.dataset.id, { fly: true }));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCourt(el.dataset.id, { fly: true }); } });
  });
}

function renderStats() {
  const visible = visibleCourts();
  const counts = { open: 0, toss: 0, full: 0 };
  visible.forEach(c => counts[scoreAvailability(c).status]++);
  document.getElementById('stat-open').textContent = counts.open;
  document.getElementById('stat-toss').textContent = counts.toss;
  document.getElementById('stat-full').textContent = counts.full;
}

function renderMarkers() {
  if (!state.map) return;

  Object.values(state.markers).forEach(removeMarker);
  state.markers = {};

  visibleCourts().forEach(c => {
    state.markers[c.id] = createMarker(c);
  });

  if (state.selectedId && state.markers[state.selectedId]) {
    const m = state.markers[state.selectedId];
    const pinEl = m._pinEl || m.content;
    if (pinEl) pinEl.classList.add('selected');
  }
}

function renderAll() {
  renderList();
  renderStats();
  renderMarkers();
  if (state.selectedId) refreshDetailStatus();
}

// Re-score the open detail panel's status block without rebuilding the whole panel.
function refreshDetailStatus() {
  const court = COURTS.find(c => c.id === state.selectedId);
  const el = document.getElementById('detail-status');
  if (!court || !el) return;
  el.outerHTML = statusBlock(court);
}

/* ============================================================
   SELECTION + DETAIL PANEL
   ============================================================ */
function statusBlock(court) {
  const score = scoreAvailability(court);
  return `
    <div class="detail-status ${score.status}" id="detail-status">
      <span class="detail-status-dot ${score.status}"></span>
      <div class="detail-status-text">
        <div class="detail-status-label ${score.status}">${availabilityLabel(score.status)}</div>
        <div class="detail-status-note">${esc(availabilityNote(score, court))}</div>
        <div class="detail-status-source">${score.source === 'live' ? (live() ? '◉ Live signal' : '◉ Your report on this device') : '✦ Heuristic estimate'}</div>
      </div>
    </div>`;
}

function selectCourt(id, opts = {}) {
  state.selectedId = id;
  if (state.highlightPickup && state.highlightCourt !== id) {
    state.highlightPickup = null; state.highlightCourt = null; state.highlightShown = false;
  }
  const court = COURTS.find(c => c.id === id);
  if (!court) return;

  document.querySelectorAll('.court-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
    if (el.dataset.id === id) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelectorAll('.gm-pin').forEach(el => el.classList.remove('selected'));
  const marker = state.markers[id];
  if (marker) {
    const pinEl = marker._pinEl || marker.content;
    if (pinEl) pinEl.classList.add('selected');
  }

  if (opts.fly && state.map) {
    state.map.panTo({ lat: court.lat, lng: court.lng });
    if (state.map.getZoom() < 12) state.map.setZoom(13);
  }

  const tierLabel = { "free": "Free public", "low-cost": "Low-cost public (< $20/hr)", "private": "Private / members" }[court.tier];

  document.getElementById('detail-eyebrow').textContent = `${court.neighborhood} • ${tierLabel}`;
  document.getElementById('detail-name').textContent = court.name;

  const reportCount = (court.live_reports || []).length;
  const demand = String(court.demand_tier || '');

  document.getElementById('detail-body').innerHTML = `
    ${statusBlock(court)}

    <div class="detail-rows">
      <div class="detail-row">
        <span class="detail-key">Courts</span>
        <span class="detail-val">${esc(court.court_count)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Access</span>
        <span class="detail-val">${tierLabel}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Demand tier</span>
        <span class="detail-val">${esc(demand.charAt(0).toUpperCase() + demand.slice(1))}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Recent reports</span>
        <span class="detail-val">${reportCount > 0 ? reportCount + ' in the last 90 min' : 'None yet'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Notes</span>
        <span class="detail-val">${esc(court.notes)}</span>
      </div>
    </div>

    <div class="detail-sports">
      ${court.sports.map(s => `<span class="sport-tag ${esc(s)}">${sportEmoji(s)} ${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>`).join('')}
    </div>

    ${court.tier !== 'private' ? `
    <div class="report-section">
      <div class="report-label">You're on the ground — what do you see?</div>
      <div class="report-buttons">
        <button class="report-btn" data-status="open" data-id="${esc(court.id)}">
          <span class="report-btn-dot"></span>
          <span class="report-btn-label">Open</span>
          <span class="report-btn-sub">Courts free</span>
        </button>
        <button class="report-btn" data-status="toss" data-id="${esc(court.id)}">
          <span class="report-btn-dot"></span>
          <span class="report-btn-label">Mixed</span>
          <span class="report-btn-sub">Some wait</span>
        </button>
        <button class="report-btn" data-status="full" data-id="${esc(court.id)}">
          <span class="report-btn-dot"></span>
          <span class="report-btn-label">Full</span>
          <span class="report-btn-sub">All taken</span>
        </button>
      </div>
      <div class="report-feedback" id="report-feedback"></div>
    </div>

    <div class="pickups-section" id="pickups-section">
      <div class="report-label">Pickups here</div>
      <div id="pickups-list" class="pickups-list"></div>
      <div id="pickups-actions"></div>
      <div class="report-feedback" id="pickup-feedback"></div>
    </div>
    ` : ''}

    <a class="directions-btn" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(court.lat + ',' + court.lng)}" target="_blank" rel="noopener">
      Open directions in Google Maps →
    </a>
  `;

  document.querySelectorAll('.report-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const status = e.currentTarget.dataset.status;
      const courtId = e.currentTarget.dataset.id;
      const labels = { open: 'open', toss: 'mixed', full: 'full' };
      document.querySelectorAll('.report-btn').forEach(b => b.disabled = true);
      try {
        const r = await submitReport(courtId, status);
        flash('report-feedback', r.shared
          ? `Thanks. Marked as ${labels[status]} just now — shared with everyone for 90 min.`
          : `Thanks. Marked as ${labels[status]} just now — saved on this device for 90 min.`);
        setTimeout(() => { renderAll(); }, 600);
      } catch (err) {
        flash('report-feedback', err.message || 'Could not save the report.', true);
        document.querySelectorAll('.report-btn').forEach(b => b.disabled = false);
      }
    });
  });

  renderPickups(court);

  openDetail();
}

/* The court panel is a side card on desktop and a bottom sheet on phones (v1.3.3): one open/close
   pair keeps the backdrop, the body scroll lock and the selection in step. */
function openDetail() {
  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-backdrop').classList.add('open');
  document.body.classList.add('detail-open');
  const body = document.getElementById('detail-body');
  if (body) body.scrollTop = 0;
}
function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-backdrop').classList.remove('open');
  document.body.classList.remove('detail-open');
  state.selectedId = null;
  renderAll();
}

/* ============================================================
   PICKUPS ON A COURT (backend only)
   ============================================================ */
async function renderPickups(court) {
  const list = document.getElementById('pickups-list');
  const actions = document.getElementById('pickups-actions');
  if (!list || !actions) return;

  if (!live()) {
    // Two different facts (audit 2026-11-07): configured but unreachable (e.g. a paused project) is not "not configured".
    list.innerHTML = state.dataSource === 'offline-fallback'
      ? `<div class="pickups-empty">Pickups need the shared backend, which is not answering right now. Try again later.</div>`
      : `<div class="pickups-empty">Pickups need the shared backend, which is not configured on this copy of the page.</div>`;
    actions.innerHTML = '';
    return;
  }

  list.innerHTML = `<div class="pickups-empty">Loading…</div>`;
  try {
    const [rows, mine] = await Promise.all([BE.listPickups(court.id), BE.myPickups()]);
    state.pickups[court.id] = rows;
    state.mine = {};
    mine.forEach(m => { state.mine[m.id] = m; });
    court.open_pickup_count = rows.length;
    paintPickupRows(court);
    // A realtime event or an auth refresh re-renders this block while the visitor may be filling
    // in a form (name, new pickup, sign-in): the old slot element is re-attached, listeners intact.
    const prevSlot = document.getElementById('pickup-form-slot');
    actions.innerHTML = `<button class="pickup-new-btn" id="pickup-new">+ Start a pickup here</button>`;
    actions.appendChild(prevSlot && prevSlot.childElementCount ? prevSlot : Object.assign(document.createElement('div'), { id: 'pickup-form-slot' }));
    document.getElementById('pickup-new').addEventListener('click', () => showPickupForm(court));
  } catch (err) {
    list.innerHTML = `<div class="pickups-empty error">${esc(err.message || 'Could not load pickups.')}</div>`;
    actions.innerHTML = '';
  }
}

// The rows of the open court from state.pickups, buttons wired; no read. Also run when a two-tap
// button arms. The share-link highlight is re-applied on every paint of this court (a realtime event
// or an auth refresh rebuilds the rows); it is dropped only when another court is opened. Scroll once.
function paintPickupRows(court) {
  const list = document.getElementById('pickups-list');
  if (!list) return;
  const rows = state.pickups[court.id] || [];
  list.innerHTML = rows.length ? rows.map(p => pickupRow(p)).join('') : `<div class="pickups-empty">No pickup on this court yet.</div>`;
  wirePickupButtons(court);
  if (state.highlightPickup) {
    const el = list.querySelector(`[data-pickup="${state.highlightPickup}"]`);
    if (el) {
      el.classList.add('highlight');
      if (!state.highlightShown) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); state.highlightShown = true; }
    }
  }
}

function pickupRow(p) {
  const me = state.mine[p.id];
  const myStatus = me ? me.my_status : null;
  const full = p.spots_left <= 0;
  const open = p.status === 'open';
  let btns = '';
  if (myStatus === 'owner') {
    btns = (open ? `<button class="pk-btn ghost" data-act="invite" data-pickup="${esc(p.id)}">+ Invite</button>` : '') +
           `<button class="pk-btn ghost" data-act="link" data-pickup="${esc(p.id)}">Copy link</button>` +
           (p.status !== 'closed' ? confirmBtn('cancel', p.id, 'Cancel', 'danger', 'data-pickup') : '');
  } else if (myStatus === 'joined') {
    btns = `<button class="pk-btn ghost" data-act="leave" data-pickup="${esc(p.id)}">Leave</button>`;
  } else if (myStatus === 'invited') {
    btns = `<button class="pk-btn" data-act="accept" data-pickup="${esc(p.id)}">Accept</button><button class="pk-btn ghost" data-act="decline" data-pickup="${esc(p.id)}">Decline</button>`;
  } else if (open && !full) {
    btns = `<button class="pk-btn" data-act="join" data-pickup="${esc(p.id)}">Join</button>`;
  } else {
    btns = `<span class="pk-state">${full ? 'Full' : 'In progress'}</span>`;
  }
  const you = myStatus === 'owner' ? ' · yours' : myStatus === 'joined' ? ' · you’re in' : myStatus === 'invited' ? ' · invited' : '';
  return `
    <div class="pickup-row ${p.status}" data-pickup="${esc(p.id)}">
      <div class="pickup-main">
        <div class="pickup-when">${sportEmoji(p.sport)} ${esc(fmtWhen(p.starts_at))}${p.status === 'in_progress' ? ' · playing now' : ''}</div>
        <div class="pickup-meta">${esc(p.joined_count)}/${esc(p.capacity)} players · by ${esc(p.organiser_name)}${you}${p.note ? ` · ${esc(p.note)}` : ''}</div>
      </div>
      <div class="pickup-btns">${btns}</div>
    </div>`;
}

function wirePickupButtons(court) {
  document.querySelectorAll('#pickups-list .pk-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const act = e.currentTarget.dataset.act;
      const id = e.currentTarget.dataset.pickup;
      // Cancel is two-tap armed, as in Mine: the first tap says "Sure?" and sends nothing; any other
      // tap disarms. No native confirm dialog (project-conventions, v1.3.0).
      const sure = !!e.currentTarget.dataset.sure;
      state.confirm = null;
      if (act === 'cancel' && !sure) { state.confirm = armKey('cancel', id); paintPickupRows(court); return; }
      try {
        if (act === 'link') {
          const mine = state.mine[id];
          const url = `${location.origin}${location.pathname}#pickup=${mine ? mine.share_token : ''}`;
          await navigator.clipboard.writeText(url);
          flash('pickup-feedback', 'Link copied. Anyone with it can open this pickup and join.');
          return;
        }
        if (act === 'invite') { openSheet('invite', { pickupId: id }); return; }
        await withProfile(async () => {
          if (act === 'join') { await BE.joinPickup(id); flash('pickup-feedback', 'You’re in. The organiser has been told.'); }
          if (act === 'leave') { await BE.leavePickup(id); flash('pickup-feedback', 'You left this pickup.'); }
          if (act === 'cancel') { await BE.cancelPickup(id); flash('pickup-feedback', 'Pickup cancelled.'); }
          if (act === 'accept') { await BE.respondToInvitation(id, true); flash('pickup-feedback', 'Accepted. You’re in.'); }
          if (act === 'decline') { await BE.respondToInvitation(id, false); flash('pickup-feedback', 'Declined.'); }
        }, court);
        await renderPickups(court);
        renderList(); renderMarkers();
      } catch (err) {
        flash('pickup-feedback', err.message || 'That did not work.', true);
      }
    });
  });
}

// Runs fn once the visitor has a profile; shows the name form first when they have none.
async function withProfile(fn, court) {
  await BE.ensureSession();
  const me = state.me || await BE.myProfile();
  if (me) { state.me = me; return fn(); }
  return new Promise((resolve, reject) => {
    showProfileForm(court, async () => {
      try { resolve(await fn()); } catch (e) { reject(e); }
    });
  });
}

function showProfileForm(court, onDone) {
  const slot = document.getElementById('pickup-form-slot');
  if (!slot) return;
  slot.innerHTML = `
    <form class="pickup-form" id="profile-form">
      <div class="pickup-form-title">Pick a name other players will see</div>
      <label>Name <input name="display_name" maxlength="40" required placeholder="Ashwin"></label>
      <label>Username <input name="username" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" required placeholder="ash_56"></label>
      <label>Skill
        <select name="skill">
          <option value="">—</option><option value="1">1 · new</option><option value="2">2</option><option value="3">3 · steady</option><option value="4">4</option><option value="5">5 · competitive</option>
        </select>
      </label>
      <div class="pickup-form-btns"><button type="submit" class="pk-btn">Save</button><button type="button" class="pk-btn ghost" data-close>Not now</button></div>
      <div class="pickup-form-note">No password · no email <button type="button" class="link-btn" data-signin>Played before? Sign in</button></div>
    </form>`;
  const form = document.getElementById('profile-form');
  form.querySelector('[data-close]').addEventListener('click', () => { slot.innerHTML = ''; });
  form.querySelector('[data-signin]').addEventListener('click', () => showSignInForm(slot));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      state.me = await BE.upsertProfile(String(fd.get('username')), String(fd.get('display_name')), fd.get('skill') || null);
      slot.innerHTML = '';
      refreshInbox();
      onDone && onDone();
    } catch (err) {
      flash('pickup-feedback', err.message || 'Could not save your name.', true);
    }
  });
}

// A returning player on a new device, before they have a profile here: a magic link to the email they kept.
function showSignInForm(slot) {
  slot.innerHTML = `
    <form class="pickup-form" id="signin-form-court">
      <div class="pickup-form-title">Sign in with the email you kept</div>
      <label>Email <input type="email" name="email" required placeholder="you@example.com" autocomplete="email"></label>
      <div class="pickup-form-btns"><button type="submit" class="pk-btn">Send link</button><button type="button" class="pk-btn ghost" data-close>Not now</button></div>
    </form>`;
  const form = slot.querySelector('form');
  form.querySelector('[data-close]').addEventListener('click', () => { slot.innerHTML = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { flash('pickup-feedback', await sendSignInLink(new FormData(form).get('email'))); slot.innerHTML = ''; }
    catch (err) { flash('pickup-feedback', err.message || 'Could not send the link.', true); }
  });
}

async function sendSignInLink(email) {
  const addr = String(email || '').trim();
  await BE.signInWithEmail(addr);
  return `Check ${addr} for a sign-in link.`;
}

function showPickupForm(court) {
  const slot = document.getElementById('pickup-form-slot');
  if (!slot) return;
  const start = new Date(Date.now() + 30 * 60000);
  start.setMinutes(start.getMinutes() - (start.getMinutes() % 30), 0, 0);
  slot.innerHTML = `
    <form class="pickup-form" id="pickup-form">
      <div class="pickup-form-title">Start a pickup at ${esc(court.name)}</div>
      <label>Sport
        <select name="sport">${court.sports.map(s => `<option value="${esc(s)}">${sportEmoji(s)} ${esc(s)}</option>`).join('')}</select>
      </label>
      <label>When <input type="datetime-local" name="starts_at" required value="${toLocalInputValue(start)}"></label>
      <label>Players <input type="number" name="capacity" min="2" max="30" value="4" required></label>
      <label>Note <input name="note" maxlength="280" placeholder="Doubles, bring balls"></label>
      <div class="pickup-form-btns"><button type="submit" class="pk-btn">Create</button><button type="button" class="pk-btn ghost" data-close>Cancel</button></div>
    </form>`;
  const form = document.getElementById('pickup-form');
  form.querySelector('[data-close]').addEventListener('click', () => { slot.innerHTML = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const startsAt = new Date(String(fd.get('starts_at')));
    try {
      await withProfile(async () => {
        const p = await BE.createPickup({
          courtId: court.id, sport: String(fd.get('sport')), startsAt: startsAt.toISOString(),
          capacity: Number(fd.get('capacity')), note: String(fd.get('note') || '')
        });
        flash('pickup-feedback', `Pickup created for ${fmtWhen(p.starts_at)}. Use “Copy link” to invite people.`);
      }, court);
      await renderPickups(court);
      renderList(); renderMarkers();
    } catch (err) {
      flash('pickup-feedback', err.message || 'Could not create the pickup.', true);
    }
  });
}

/* ============================================================
   INBOX (backend only)
   ============================================================ */
function notificationText(n) {
  const who = n.actor_name || 'Someone';
  const where = n.court_name ? ` at ${n.court_name}` : '';
  const when = n.pickup_starts_at ? ` (${fmtWhen(n.pickup_starts_at)})` : '';
  return {
    joined: `${who} joined your pickup${where}${when}.`,
    left: `${who} left your pickup${where}${when}.`,
    invitation: `${who} invited you to a pickup${where}${when}.`,
    cancelled: `${who} cancelled the pickup${where}${when}.`,
    enter_result: `Your pickup${where}${when} has started. Enter the result when it ends.`,
    vote_mvp: `Vote for the MVP of your pickup${where}${when}.`,
    you_are_mvp: `You were voted MVP${where}${when}.`,
    friend_request: `${who} wants to be your teammate.`,
    friend_accepted: `${who} accepted your teammate request.`,
    friend_rejected: `${who} declined your teammate request.`
  }[n.kind] || n.kind;
}

async function refreshInbox() {
  const btn = document.getElementById('inbox-btn');
  if (!btn || !live()) return;
  try {
    const session = await BE.getSession();
    if (!session) { btn.classList.add('hidden'); refreshHeader(); return; }
    state.inbox = await BE.notifications(20);
    btn.classList.remove('hidden');
    const count = document.getElementById('inbox-count');
    count.textContent = state.inbox.length;
    count.classList.toggle('hidden', state.inbox.length === 0);
    // aria-label replaces the button's content in its accessible name, so the count rides it.
    btn.setAttribute('aria-label', state.inbox.length ? `Notifications · ${state.inbox.length} unread` : 'Notifications');
    if (state.inboxOpen) renderInbox();
    if (!state.me) state.me = await BE.myProfile();
    refreshHeader();
    refreshFriendBadge();
  } catch (e) {
    console.warn('Inbox unavailable', e);
  }
}

// The M3 header buttons (my name, Mine, Friends) show only with a profile on the shared backend.
function refreshHeader() {
  const has = !!(live() && state.me);
  ['me-btn', 'mine-btn', 'friends-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !has);
  });
  const meBtn = document.getElementById('me-btn');
  if (meBtn && has) meBtn.textContent = state.me.display_name;
}

async function refreshFriendBadge() {
  if (!live() || !state.me) return;
  try { updateFriendBadge((await BE.incomingFriendRequests()).length); }
  catch (e) { console.warn('Friend requests unavailable', e); }
}

function updateFriendBadge(n) {
  const el = document.getElementById('friends-count');
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('hidden', !n);
  const btn = document.getElementById('friends-btn');
  if (btn) btn.setAttribute('aria-label', n ? `Friends · ${n} request${n === 1 ? '' : 's'}` : 'Friends');
}

function renderInbox() {
  const box = document.getElementById('inbox');
  if (!box) return;
  box.classList.toggle('open', state.inboxOpen);
  if (!state.inboxOpen) return;
  if (state.inbox.length === 0) {
    box.innerHTML = `<div class="inbox-empty">Nothing new.</div>`;
    return;
  }
  box.innerHTML = state.inbox.map(n => `
    <div class="inbox-item" data-id="${esc(n.id)}">
      <div class="inbox-text">${esc(notificationText(n))}</div>
      <div class="inbox-actions">
        ${n.kind === 'invitation' && n.pickup_id ? `<button class="pk-btn" data-act="accept" data-pickup="${esc(n.pickup_id)}" data-nid="${esc(n.id)}">Accept</button><button class="pk-btn ghost" data-act="decline" data-pickup="${esc(n.pickup_id)}" data-nid="${esc(n.id)}">Decline</button>` : ''}
        ${n.kind === 'enter_result' && n.pickup_id ? `<button class="pk-btn" data-act="result" data-pickup="${esc(n.pickup_id)}" data-nid="${esc(n.id)}">Enter result</button>` : ''}
        ${n.kind === 'vote_mvp' && n.pickup_id ? `<button class="pk-btn" data-act="vote" data-pickup="${esc(n.pickup_id)}" data-nid="${esc(n.id)}">Vote MVP</button>` : ''}
        ${n.kind === 'friend_request' ? `<button class="pk-btn" data-act="friends" data-nid="${esc(n.id)}">Open</button>` : ''}
        ${n.court_id ? `<button class="pk-btn ghost" data-act="show" data-court="${esc(n.court_id)}" data-nid="${esc(n.id)}">Show</button>` : ''}
        <button class="pk-btn ghost" data-act="read" data-nid="${esc(n.id)}">Dismiss</button>
      </div>
    </div>`).join('') + `<button class="pk-btn ghost inbox-all" data-act="read-all">Mark all read</button>`;
  box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async (e) => {
    const { act, pickup, nid, court } = e.currentTarget.dataset;
    try {
      if (act === 'accept') await BE.respondToInvitation(pickup, true);
      if (act === 'decline') await BE.respondToInvitation(pickup, false);
      if (act === 'show') { state.inboxOpen = false; renderInbox(); selectCourt(court, { fly: true }); }
      if (act === 'result' || act === 'vote') { state.inboxOpen = false; renderInbox(); state.sheets = []; openSheet(act, { pickupId: pickup }); }
      if (act === 'friends') { state.inboxOpen = false; renderInbox(); state.sheets = []; state.friends.fresh = false; openSheet('friends'); }
      if (act === 'read-all') await BE.markRead(state.inbox.map(n => n.id));
      else if (nid) await BE.markRead([Number(nid)]);
      await refreshInbox();
      if (act !== 'show' && state.inboxOpen) renderInbox();
    } catch (err) {
      // No native dialog: the error reads inside the dropdown, above the items.
      const note = document.createElement('div');
      note.className = 'inbox-empty error';
      note.textContent = err.message || 'That did not work.';
      box.prepend(note);
    }
  }));
}

/* ============================================================
   M3 SHEET — Mine · Friends · Invite · Result · Vote · Profile (backend only)
   One container (#sheet) and a stack of panels; the top one renders.
   ✕ closes the sheet, ‹ and Escape close the top layer only.
   Clicks, input and submit are delegated on #sheet: a re-render replaces
   innerHTML and adds no listeners. One rendering function per panel.
   Every player field reaches innerHTML through esc().
   ============================================================ */
const myId = () => (state.me && state.me.id) || (BE && BE.userId()) || null;
const LOADING = `<div class="pickups-empty">Loading…</div>`;

const PANELS = {
  mine:    { title: () => 'My pickups',   render: renderMinePanel,    act: actMine },
  friends: { title: () => 'Friends',      render: renderFriendsPanel, act: actFriends },
  invite:  { title: () => 'Invite',       render: renderInvitePanel,  act: actInvite },
  result:  { title: () => 'Enter result', render: renderResultPanel,  act: actResult, submit: submitResult },
  vote:    { title: () => 'Vote MVP',     render: renderVotePanel,    act: actVote },
  profile: { title: () => 'You',          render: renderProfilePanel, act: actProfile, submit: submitProfile }
};

const topSheet = () => state.sheets[state.sheets.length - 1] || null;
function openSheet(kind, data) { state.sheets.push({ kind, data: data || {} }); renderSheet(); }
function popSheet() { state.sheets.pop(); renderSheet(); }
function closeSheet() { state.sheets = []; renderSheet(); }

// Header buttons: a second tap on the same panel closes it; a different one replaces the stack.
function toggleSheet(kind) {
  const top = topSheet();
  if (top && top.kind === kind && state.sheets.length === 1) return closeSheet();
  state.sheets = [];
  if (kind === 'mine') state.mineFresh = false;
  if (kind === 'friends') state.friends.fresh = false;
  if (state.inboxOpen) { state.inboxOpen = false; renderInbox(); }
  openSheet(kind);
}

function renderSheet() {
  const box = document.getElementById('sheet');
  if (!box) return;
  const top = topSheet();
  state.confirm = null;
  box.classList.toggle('hidden', !top);
  const back = document.getElementById('sheet-back');
  if (back) back.classList.toggle('hidden', state.sheets.length < 2);
  const fb = document.getElementById('sheet-feedback');
  if (fb) { fb.textContent = ''; fb.classList.remove('shown', 'error'); }
  if (!top) { box.removeAttribute('data-kind'); return; }
  const panel = PANELS[top.kind];
  document.getElementById('sheet-title').textContent = panel.title(top.data);
  box.dataset.kind = top.kind;
  Promise.resolve(panel.render(top.data)).catch(err => sheetFlash(err.message || 'Could not load.', true));
}

// Writes the body only while `entry` is still the top panel (a slow load never paints over a newer one).
function setBody(entry, html) {
  if (topSheet() !== entry) return;
  const b = document.getElementById('sheet-body');
  if (b) b.innerHTML = html;
}
const sheetFlash = (text, isError) => flash('sheet-feedback', text, isError);

// Two-tap buttons (Cancel, Leave, Remove): the first tap arms, the second acts. No native dialog.
function armKey(act, id) { return `${act}:${id}`; }
function confirmBtn(act, id, label, cls, attr) {
  const armed = state.confirm === armKey(act, id);
  return `<button type="button" class="pk-btn ${armed ? 'danger' : cls}" data-act="${act}" ${attr}="${esc(id)}"${armed ? ' data-sure="1"' : ''}>${armed ? 'Sure?' : label}</button>`;
}

function refreshCourtPanel() {
  const court = COURTS.find(c => c.id === state.selectedId);
  if (court && document.getElementById('pickups-list')) renderPickups(court);
  renderList(); renderMarkers();
}

async function copyShareLink(p) {
  const url = `${location.origin}${location.pathname}#pickup=${p && p.share_token ? p.share_token : ''}`;
  try { await navigator.clipboard.writeText(url); sheetFlash('Link copied.'); }
  catch (e) { sheetFlash(`Copy this link: ${url}`); }
}

/* ---- Mine --------------------------------------------------------------------------------- */
async function loadMine() {
  const [rows, votes] = await Promise.all([BE.myPickups(), BE.myVotes().catch(() => [])]);
  rows.sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  state.minePickups = rows;
  state.mine = {};
  rows.forEach(m => { state.mine[m.id] = m; });
  state.myVotes = {};
  votes.forEach(v => { state.myVotes[v.pickup_id] = v.votee_id; });
  const need = rows.map(r => r.mvp_id).filter(id => id && !state.names[id]);
  if (need.length) (await BE.profilesByIds(need)).forEach(p => { state.names[p.id] = p.display_name; });
  state.mineFresh = true;
  return rows;
}

const STATUS_WORD = { open: 'open', in_progress: 'in progress', closed: 'closed', cancelled: 'cancelled' };

// The one action a row's state allows (and the glyphs that ride beside it).
function mineAction(p) {
  const uid = myId();
  const organiser = p.my_status === 'owner' || p.organiser_id === uid;
  const started = new Date(p.starts_at) <= new Date();
  const id = esc(p.id);
  if (p.status === 'cancelled') return '';
  if (p.status === 'closed') {
    if (p.winning_team_no == null) return `<span class="pk-state">no result</span>`;
    if (p.mvp_id) return `<span class="mvp-chip" title="MVP">⭐ ${esc(p.mvp_id === uid ? 'you' : (state.names[p.mvp_id] || 'MVP'))}</span>`;
    if (state.myVotes[p.id]) return `<span class="pk-state">voted ✓</span>`;
    if (p.my_status === 'owner' || p.my_status === 'joined') return `<button type="button" class="pk-btn" data-act="vote" data-pickup="${id}">Vote MVP</button>`;
    return '';
  }
  // A started pickup that never happened is cancelled from here too (cancel_pickup allows open and in_progress).
  if (organiser && (p.status === 'in_progress' || started)) return `<button type="button" class="pk-btn" data-act="result" data-pickup="${id}">Enter result</button>` +
    confirmBtn('cancel', p.id, 'Cancel', 'ghost', 'data-pickup');
  if (p.my_status === 'invited') return `<button type="button" class="pk-btn" data-act="accept" data-pickup="${id}">Accept</button><button type="button" class="pk-btn ghost" data-act="decline" data-pickup="${id}">Decline</button>`;
  if (organiser) return `<button type="button" class="pk-btn ghost" data-act="invite" data-pickup="${id}">+ Invite</button>` +
    `<button type="button" class="pk-btn ghost" data-act="link" data-pickup="${id}" aria-label="Copy link" title="Copy link">🔗</button>` +
    confirmBtn('cancel', p.id, 'Cancel', 'danger', 'data-pickup');
  if (p.my_status === 'joined') return (p.status === 'open' ? `<button type="button" class="pk-btn ghost" data-act="link" data-pickup="${id}" aria-label="Copy link" title="Copy link">🔗</button>` : '') +
    confirmBtn('leave', p.id, 'Leave', 'ghost', 'data-pickup');
  return '';
}

function mineRow(p) {
  const you = p.my_status === 'owner' ? 'yours' : p.my_status === 'invited' ? 'invited' : '';
  return `
    <div class="mine-row ${esc(p.status)}" data-pickup="${esc(p.id)}">
      <div class="mine-main">
        <div class="mine-top"><span class="st-chip ${esc(p.status)}">${STATUS_WORD[p.status] || esc(p.status)}</span><span class="mine-court">${sportEmoji(p.sport)} ${esc(p.court_name)}</span></div>
        <div class="pickup-meta">${esc(fmtWhen(p.starts_at))} · ${esc(p.joined_count)}/${esc(p.capacity)}${you ? ` · ${you}` : ''}</div>
      </div>
      <div class="pickup-btns">${mineAction(p)}</div>
    </div>`;
}

async function renderMinePanel() {
  const entry = topSheet();
  if (!state.mineFresh) { setBody(entry, LOADING); await loadMine(); }
  const rows = state.minePickups;
  setBody(entry, rows.length
    ? `<div class="mine-list">${rows.map(mineRow).join('')}</div>`
    : `<div class="pickups-empty">No pickups yet · start one from a court</div>`);
}

async function actMine(act, ds) {
  const id = ds.pickup;
  if (act === 'result') return openSheet('result', { pickupId: id });
  if (act === 'vote') return openSheet('vote', { pickupId: id });
  if (act === 'invite') return openSheet('invite', { pickupId: id });
  if (act === 'link') return copyShareLink(state.mine[id]);
  if ((act === 'cancel' || act === 'leave') && !ds.sure) { state.confirm = armKey(act, id); return renderMinePanel(); }
  if (act === 'cancel') { await BE.cancelPickup(id); sheetFlash('Cancelled.'); }
  else if (act === 'leave') { await BE.leavePickup(id); sheetFlash('You left.'); }
  else if (act === 'accept') { await BE.respondToInvitation(id, true); sheetFlash('You’re in.'); }
  else if (act === 'decline') { await BE.respondToInvitation(id, false); sheetFlash('Declined.'); }
  else return;
  state.mineFresh = false;
  await renderMinePanel();
  refreshCourtPanel();
}

/* ---- Result ------------------------------------------------------------------------------- */
const playing = (r) => r.status === 'owner' || r.status === 'joined';
const pickupLine = (p) => p ? `${sportEmoji(p.sport)} ${esc(p.court_name)} · ${esc(fmtWhen(p.starts_at))}` : '';

// "6-4 3-6 10-7" → { t1: [6,3,10], t2: [4,6,7] }; null when a token is not two numbers.
function parseSets(text) {
  const toks = String(text || '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!toks.length) return null;
  const t1 = [], t2 = [];
  for (const t of toks) {
    const m = t.match(/^(\d{1,2})[-–:](\d{1,2})$/);
    if (!m) return null;
    t1.push(Number(m[1])); t2.push(Number(m[2]));
  }
  return { t1, t2 };
}

async function renderResultPanel(data) {
  const entry = topSheet();
  if (!data.roster) {
    setBody(entry, LOADING);
    if (!state.mine[data.pickupId]) await loadMine();
    data.roster = (await BE.roster(data.pickupId)).filter(playing);
    data.teams = {}; data.sets = ''; data.winner = null;
  }
  const uid = myId();
  const seg = (r, n) => `<button type="button" class="seg${data.teams[r.player_id] === n ? ' on' : ''}" data-act="team" data-player="${esc(r.player_id)}" data-team="${n}" aria-pressed="${data.teams[r.player_id] === n}" aria-label="${esc(r.display_name)} team ${n}">${n}</button>`;
  setBody(entry, `
    <div class="sheet-sub">${pickupLine(state.mine[data.pickupId])}</div>
    <form id="result-form" class="result-form" autocomplete="off">
      <div class="result-grid">
        <div class="result-head"><span>Player</span><span>T1</span><span>T2</span></div>
        ${data.roster.map(r => `
          <div class="result-player" data-player="${esc(r.player_id)}">
            <span class="result-name">${esc(r.display_name)}${r.player_id === uid ? ' <span class="you">you</span>' : ''}</span>
            ${seg(r, 1)}${seg(r, 2)}
          </div>`).join('')}
      </div>
      <label class="result-sets"><span>Sets · T1-T2</span><input id="result-sets" name="sets" value="${esc(data.sets)}" placeholder="6-4 3-6 10-7" inputmode="numeric"></label>
      <div class="result-winner" role="radiogroup" aria-label="Winner">
        <span class="result-label">Winner</span>
        <label class="radio"><input type="radio" name="winner" value="1"${data.winner === 1 ? ' checked' : ''}> Team 1</label>
        <label class="radio"><input type="radio" name="winner" value="2"${data.winner === 2 ? ' checked' : ''}> Team 2</label>
      </div>
      <div class="pickup-form-btns"><button type="submit" class="pk-btn">Save result</button></div>
    </form>`);
}

function captureResultForm(data) {
  const form = document.getElementById('result-form');
  if (!form) return;
  const fd = new FormData(form);
  data.sets = String(fd.get('sets') || '');
  data.winner = Number(fd.get('winner')) || null;
}

function actResult(act, ds, el, data) {
  if (act !== 'team') return;
  captureResultForm(data);
  const n = Number(ds.team);
  if (data.teams[ds.player] === n) delete data.teams[ds.player]; else data.teams[ds.player] = n;
  data.ackUnassigned = false;
  return renderResultPanel(data);
}

async function submitResult(form, data) {
  captureResultForm(data);
  const team1 = Object.keys(data.teams).filter(k => data.teams[k] === 1);
  const team2 = Object.keys(data.teams).filter(k => data.teams[k] === 2);
  const sets = parseSets(data.sets);
  if (!team1.length || !team2.length) return sheetFlash('Each team needs a player.', true);
  if (!sets) return sheetFlash('Sets read like 6-4 3-6 10-7.', true);
  if (!data.winner) return sheetFlash('Pick the winning team.', true);
  // record_result accepts a roster player on neither team; player_standing then counts them a game they
  // could not win (0003). Say so once; the next Save sends (actResult clears the acknowledgement).
  const unassigned = data.roster.filter(r => !data.teams[r.player_id]).length;
  if (unassigned && !data.ackUnassigned) {
    data.ackUnassigned = true;
    return sheetFlash(`${unassigned} player${unassigned === 1 ? '' : 's'} unassigned · they count as played · Save again to confirm`, true);
  }
  const row = await BE.recordResult({ pickupId: data.pickupId, team1, team2, team1Scores: sets.t1, team2Scores: sets.t2, winningTeam: data.winner });
  const m = state.mine[data.pickupId];
  if (m) { m.status = (row && row.status) || 'closed'; m.winning_team_no = (row && row.winning_team_no) || data.winner; }
  state.mineFresh = false;
  popSheet();
  if (!topSheet()) openSheet('mine');     // opened from the inbox: nothing beneath, so the flash needs a sheet
  sheetFlash(`Saved · closed · team ${data.winner} won`);
  refreshCourtPanel();
}

/* ---- Vote --------------------------------------------------------------------------------- */
async function renderVotePanel(data) {
  const entry = topSheet();
  if (!data.roster) {
    setBody(entry, LOADING);
    if (!state.mine[data.pickupId]) await loadMine();
    const uid = myId();
    data.roster = (await BE.roster(data.pickupId)).filter(r => playing(r) && r.player_id !== uid);
  }
  setBody(entry, `
    <div class="sheet-sub">${pickupLine(state.mine[data.pickupId])}</div>
    <div class="vote-list">${data.roster.length ? data.roster.map(r => `
      <button type="button" class="vote-row" data-act="votefor" data-player="${esc(r.player_id)}">
        <span class="friend-name">${esc(r.display_name)}</span>
        ${r.team_no ? `<span class="pk-state">T${esc(r.team_no)}</span>` : ''}
        <span class="vote-star" aria-hidden="true">⭐</span>
      </button>`).join('') : `<div class="pickups-empty">Nobody else to vote for</div>`}
    </div>`);
}

async function actVote(act, ds, el, data) {
  if (act !== 'votefor') return;
  const decided = await BE.voteMvp(data.pickupId, ds.player);
  state.myVotes[data.pickupId] = ds.player;
  state.mineFresh = false;
  popSheet();
  if (!topSheet()) openSheet('mine');     // opened from the inbox: nothing beneath, so the flash needs a sheet
  sheetFlash(decided ? 'Voted ✓ · MVP decided' : 'Voted ✓');
}

/* ---- Friends ------------------------------------------------------------------------------ */
async function loadFriends() {
  const f = state.friends;
  const [edges, incoming, list] = await Promise.all([BE.myFriendEdges(), BE.incomingFriendRequests(), BE.myFriends()]);
  f.edges = edges; f.incoming = incoming; f.list = list; f.fresh = true;
  incoming.concat(list).forEach(p => { state.names[p.id] = p.display_name; });
  updateFriendBadge(incoming.length);
}

// friend_status derived from my own edges: both = friends, mine only = pending_out, theirs only = pending_in.
function friendStatusOf(id) {
  const uid = myId();
  let out = false, inn = false;
  state.friends.edges.forEach(e => {
    if (e.requester_id === uid && e.addressee_id === id) out = true;
    if (e.requester_id === id && e.addressee_id === uid) inn = true;
  });
  return out && inn ? 'friends' : out ? 'pending_out' : inn ? 'pending_in' : 'none';
}

function friendBtns(p) {
  if (p.id === myId()) return `<span class="pk-state">you</span>`;
  const id = esc(p.id);
  const st = friendStatusOf(p.id);
  if (st === 'none') return `<button type="button" class="pk-btn" data-act="friend-add" data-player="${id}">+ Add</button>`;
  if (st === 'pending_out') return `<button type="button" class="pk-btn ghost" data-act="friend-cancel" data-player="${id}" title="Tap to cancel">Requested ✓</button>`;
  if (st === 'pending_in') return `<button type="button" class="pk-btn" data-act="friend-accept" data-player="${id}">Accept</button><button type="button" class="pk-btn ghost" data-act="friend-decline" data-player="${id}">Decline</button>`;
  return state.confirm === armKey('remove', p.id)
    ? `<button type="button" class="pk-btn danger" data-act="friend-remove" data-player="${id}" data-sure="1">Remove</button>`
    : `<button type="button" class="pk-btn ghost" data-act="friend-remove" data-player="${id}" title="Tap for Remove">Friends ✓</button>`;
}

function playerRow(p, btns) {
  return `
    <div class="friend-row" data-player="${esc(p.id)}">
      <div class="friend-main">
        <span class="friend-name">${esc(p.display_name)}</span>
        <span class="friend-user">@${esc(p.username)}</span>${p.skill ? `<span class="skill-chip" title="skill ${esc(p.skill)} of 5">S${esc(p.skill)}</span>` : ''}
      </div>
      <div class="pickup-btns">${btns}</div>
    </div>`;
}

function friendResultsHtml() {
  const f = state.friends;
  if (f.query.trim().length < 2) return '';
  if (!f.results.length) return `<div class="pickups-empty">No player matches</div>`;
  return f.results.map(p => playerRow(p, friendBtns(p))).join('');
}

let friendQueryTimer = null;
function onFriendQuery(value) {
  const f = state.friends;
  f.query = value;
  clearTimeout(friendQueryTimer);
  const q = value.trim();
  const paint = () => { const el = document.getElementById('friend-results'); if (el) el.innerHTML = friendResultsHtml(); };
  if (q.length < 2) { f.results = []; paint(); return; }
  friendQueryTimer = setTimeout(async () => {
    try {
      const rows = await BE.searchPlayers(q);
      if (f.query.trim() !== q) return; // a newer query is in flight
      f.results = rows || [];
      rows.forEach(p => { state.names[p.id] = p.display_name; });
      paint();
    } catch (err) { sheetFlash(err.message || 'Search failed.', true); }
  }, 300);
}

async function renderFriendsPanel() {
  const entry = topSheet();
  if (!state.friends.fresh) { setBody(entry, LOADING); await loadFriends(); }
  const f = state.friends;
  setBody(entry, `
    <input id="friend-q" class="sheet-search" type="search" value="${esc(f.query)}" placeholder="Find a player · 2+ letters" aria-label="Find a player" autocomplete="off">
    <div id="friend-results" class="friend-list">${friendResultsHtml()}</div>
    ${f.incoming.length ? `<div class="sheet-h">Requests <span class="count-pill">${f.incoming.length}</span></div>
    <div class="friend-list" id="friend-incoming">${f.incoming.map(p => playerRow(p, friendBtns(p))).join('')}</div>` : ''}
    <div class="sheet-h">Friends <span class="count-pill">${f.list.length}</span></div>
    <div class="friend-list" id="friend-list">${f.list.length ? f.list.map(p => playerRow(p, friendBtns(p))).join('') : `<div class="pickups-empty">No friends yet · search above</div>`}</div>`);
}

async function actFriends(act, ds) {
  const id = ds.player;
  if (act === 'friend-add') { const r = await BE.sendFriendRequest(id); sheetFlash(r === 'friends' ? 'Friends ✓' : 'Requested ✓'); }
  else if (act === 'friend-cancel') { await BE.cancelFriendRequest(id); sheetFlash('Request withdrawn.'); }
  else if (act === 'friend-accept') { await BE.acceptFriendRequest(id); sheetFlash('Friends ✓'); }
  else if (act === 'friend-decline') { await BE.rejectFriendRequest(id); sheetFlash('Declined.'); }
  else if (act === 'friend-remove') {
    if (!ds.sure) { state.confirm = armKey('remove', id); return renderFriendsPanel(); }
    await BE.removeFriend(id); sheetFlash('Removed.');
  }
  else return;
  state.friends.fresh = false;
  await renderFriendsPanel();
}

/* ---- Invite (from a pickup I organise) ---------------------------------------------------- */
async function renderInvitePanel(data) {
  const entry = topSheet();
  setBody(entry, LOADING);
  if (!state.mine[data.pickupId]) await loadMine().catch(() => {});
  const p = state.mine[data.pickupId];
  const [roster, friends] = await Promise.all([BE.roster(data.pickupId), BE.myFriends()]);
  const on = new Set(roster.map(r => r.player_id));
  const cands = friends.filter(f => !on.has(f.id));
  const rosterChip = (r) => r.status === 'invited'
    ? `<span class="st-chip invited">invited</span><button type="button" class="pk-btn ghost" data-act="invite-cancel" data-player="${esc(r.player_id)}" aria-label="Cancel invitation" title="Cancel invitation">✕</button>`
    : `<span class="st-chip ${esc(r.status)}">${r.status === 'owner' ? 'organiser' : 'joined ✓'}</span>`;
  setBody(entry, `
    <div class="sheet-sub">${pickupLine(p)}${p ? ` · ${esc(p.joined_count)}/${esc(p.capacity)}` : ''}</div>
    <div class="sheet-h">Friends to invite</div>
    <div class="friend-list" id="invite-list">${cands.length
      ? cands.map(f => playerRow(f, `<button type="button" class="pk-btn" data-act="invite-send" data-player="${esc(f.id)}">+ Invite</button>`)).join('')
      : `<div class="pickups-empty">${friends.length ? 'Every friend is on the roster' : 'No friends yet · add some under 👥'}</div>`}</div>
    <div class="sheet-h">Roster <span class="count-pill">${roster.length}</span></div>
    <div class="friend-list" id="invite-roster">${roster.map(r => `
      <div class="friend-row" data-player="${esc(r.player_id)}">
        <div class="friend-main"><span class="friend-name">${esc(r.display_name)}</span><span class="friend-user">@${esc(r.username)}</span></div>
        <div class="pickup-btns">${rosterChip(r)}</div>
      </div>`).join('')}</div>`);
}

async function actInvite(act, ds, el, data) {
  if (act === 'invite-send') { await BE.inviteToPickup(data.pickupId, ds.player); sheetFlash('Invited ✓'); }
  else if (act === 'invite-cancel') { await BE.cancelInvitation(data.pickupId, ds.player); sheetFlash('Invitation cancelled.'); }
  else return;
  state.mineFresh = false;
  await renderInvitePanel(data);
}

/* ---- Profile and standing ----------------------------------------------------------------- */
const skillPips = (n) => '●'.repeat(Number(n) || 0) + '○'.repeat(5 - (Number(n) || 0));

async function renderProfilePanel() {
  const entry = topSheet();
  setBody(entry, LOADING);
  const [row, st] = await Promise.all([BE.myProfile(true).catch(() => null), BE.myStanding().catch(() => null)]);
  if (row) state.me = row;
  const m = state.me || {};
  const s = st || {};
  const tile = (n, label) => `<div class="stand-tile"><div class="stand-num">${st ? esc(n) : '—'}</div><div class="stand-label">${label}</div></div>`;
  setBody(entry, `
    <div class="prof-head">
      <div class="prof-name">${esc(m.display_name || '—')}</div>
      <div class="prof-user">@${esc(m.username || '')}${m.skill ? ` · <span class="pips" title="skill ${esc(m.skill)} of 5">${skillPips(m.skill)}</span>` : ''}</div>
    </div>
    <div class="stand-grid" id="standing">
      ${tile(s.games, 'games')}${tile(s.wins, 'wins')}${tile(s.mvps, '⭐ MVP')}
      <div class="stand-tile accent"><div class="stand-num">${st ? esc(s.goat_score) : '—'}</div><div class="stand-label">score <button type="button" class="info-btn" data-act="formula" aria-label="How the score is computed" aria-expanded="false">ⓘ</button></div></div>
    </div>
    <div class="stand-formula hidden" id="stand-formula">provisional formula: 2 per win, 3 per MVP</div>
    ${st ? '' : `<div class="pickup-form-note">Standing unavailable right now.</div>`}
    <div id="acct" class="acct">${accountHtml()}</div>`);
}

// The account rows (M4, FR-61). Anonymous session: "Keep this account" (link an email; the uid and
// everything on it stay) and "Played before? Sign in" (a magic link switches this device to the
// account it names). Sign out is hidden for an anonymous session because it would lose the profile.
// Permanent account: the email and a two-tap Sign out.
function accountHtml() {
  const pending = BE.pendingEmail();
  if (!BE.isAnonymous()) {
    const email = BE.userEmail();
    return `
      <div class="sheet-h">Account</div>
      <div class="acct-row"><span class="acct-email" title="${esc(email || '')}">✉ ${esc(email || '—')}</span>${confirmBtn('signout', 'me', 'Sign out', 'ghost', 'data-id')}</div>
      ${pending ? `<div class="pickup-form-note">New email ${esc(pending)} · confirm it from that inbox.</div>` : ''}`;
  }
  return `
    <div class="sheet-h">Keep this account</div>
    <form id="keep-form" class="acct-form">
      <input type="email" name="email" required placeholder="you@example.com" aria-label="Email" autocomplete="email">
      <button type="submit" class="pk-btn">Keep</button>
    </form>
    <div class="pickup-form-note">${pending ? `Sent to ${esc(pending)} · confirm it from that inbox. ` : ''}An email keeps this profile across devices · no password. Signing out of an anonymous profile loses it.</div>
    <div class="sheet-h">Played before? Sign in</div>
    <form id="signin-form" class="acct-form">
      <input type="email" name="email" required placeholder="the email you kept" aria-label="Email" autocomplete="email">
      <button type="submit" class="pk-btn ghost">Send link</button>
    </form>
    <div class="pickup-form-note">A sign-in link lands in that inbox and switches this device to that account.</div>`;
}

function repaintAccount() {
  const el = document.getElementById('acct');
  if (el && topSheet() && topSheet().kind === 'profile') el.innerHTML = accountHtml();
}

async function actProfile(act, ds, el) {
  if (act === 'formula') {
    const f = document.getElementById('stand-formula');
    if (!f) return;
    f.classList.toggle('hidden');
    el.setAttribute('aria-expanded', String(!f.classList.contains('hidden')));
    return;
  }
  if (act === 'signout') {
    if (!ds.sure) { state.confirm = armKey('signout', 'me'); return repaintAccount(); }
    await BE.signOut(); // SIGNED_OUT → afterAuthChange clears the page's private state
  }
}

async function submitProfile(form) {
  const email = String(new FormData(form).get('email') || '').trim();
  if (form.id === 'keep-form') {
    await BE.linkEmail(email);
    sheetFlash(`Check ${email} to confirm.`);
    repaintAccount();
  } else if (form.id === 'signin-form') {
    sheetFlash(await sendSignInLink(email));
  }
}

/* ---- Wiring: header buttons, delegation on #sheet, Escape ------------------------------- */
function wireSheet() {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  const on = (id, kind) => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => toggleSheet(kind)); };
  on('mine-btn', 'mine'); on('friends-btn', 'friends'); on('me-btn', 'profile');

  sheet.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !sheet.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'close') return closeSheet();
    if (act === 'back') return popSheet();
    const top = topSheet();
    if (!top) return;
    if (!el.dataset.sure) state.confirm = null;
    try { await PANELS[top.kind].act(act, el.dataset, el, top.data); }
    catch (err) { sheetFlash(err.message || 'That did not work.', true); }
  });
  sheet.addEventListener('input', (e) => { if (e.target && e.target.id === 'friend-q') onFriendQuery(e.target.value); });
  sheet.addEventListener('submit', async (e) => {
    e.preventDefault();
    const top = topSheet();
    if (!top || !PANELS[top.kind].submit) return;
    try { await PANELS[top.kind].submit(e.target, top.data); }
    catch (err) { sheetFlash(err.message || 'That did not work.', true); }
  });

  // Escape closes the top layer only: the top panel, else the inbox.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (topSheet()) { e.preventDefault(); popSheet(); return; }
    if (state.inboxOpen) { state.inboxOpen = false; renderInbox(); return; }
    if (document.getElementById('detail-panel').classList.contains('open')) closeDetail();
  });
}

/* ============================================================
   REALTIME (M4) — one channel while it is honest, polling otherwise
   "· live" rides the data-source line only while the channel reports
   SUBSCRIBED. Events refresh the open court's pickups, the Mine list,
   the courts' counts and the inbox; the inbox poll stretches to 5 min.
   CHANNEL_ERROR, TIMED_OUT, CLOSED or no realtime at all → the v1.2.0
   polling (inbox 60 s, courts 5 min) and no claim on the face.
   ============================================================ */
function rtLive() { return state.rt.status === 'SUBSCRIBED'; }

// Re-read courts_live (other people's reports and pickup counts) and repaint.
async function refreshCourts() {
  if (!live()) return;
  try {
    const rows = await BE.fetchCourts();
    const byId = {};
    rows.forEach(r => { byId[r.id] = normaliseCourt(r); });
    COURTS = COURTS.map(c => byId[c.id] || c);
    renderAll();
  } catch (e) { console.warn('Refresh failed', e); }
}

// Inbox: every 60 s, every 5 min while subscribed (events carry it). Courts: every 5 min either
// way — court_reports is not in the publication (0005), so reports arrive by poll.
function setPolling(subscribed) {
  const rt = state.rt;
  clearInterval(rt.pollInbox); clearInterval(rt.pollCourts);
  rt.inboxEvery = subscribed ? 300000 : 60000;
  rt.pollInbox = setInterval(refreshInbox, rt.inboxEvery);
  rt.pollCourts = setInterval(refreshCourts, 300000);
  renderDataSource();
}

// Coalesce a burst of events into one refresh per kind.
function rtKick(kind, fn) {
  clearTimeout(state.rt.kicks[kind]);
  state.rt.kicks[kind] = setTimeout(() => {
    state.rt.kicks[kind] = null;
    Promise.resolve().then(fn).catch(e => console.warn('Refresh failed', e));
  }, 250);
}

function onRtPickups() {
  rtKick('pickups', async () => {
    state.mineFresh = false;
    const top = topSheet();
    if (top && top.kind === 'mine') renderMinePanel().catch(() => {});
    refreshCourtPanel();
    await refreshCourts();
  });
}
function onRtInbox() { rtKick('inbox', refreshInbox); }

function stopRealtime() {
  const rt = state.rt;
  if (rt.unsub) { try { rt.unsub(); } catch (e) { /* already gone */ } }
  rt.unsub = null; rt.status = null; rt.uid = null;
  setPolling(false);
}

async function startRealtime() {
  const rt = state.rt;
  stopRealtime();
  if (!live() || !BE.subscribe) return;
  const seq = ++rt.seq;
  try {
    const s = await BE.getSession();
    if (seq !== rt.seq) return;
    rt.uid = s && s.user ? s.user.id : null;
    rt.unsub = BE.subscribe({
      onPickups: onRtPickups,
      onNotifications: onRtInbox,
      onStatus: (status, err) => {
        if (seq !== rt.seq) return;          // a retired channel's CLOSED never paints over the new one
        const was = rt.status;
        rt.status = status;
        if (status === 'SUBSCRIBED') {
          setPolling(true);
          if (was) { rtKick('pickups', refreshCourts); rtKick('inbox', refreshInbox); } // catch up after a reconnect
        } else {
          if (err) console.warn('Realtime', status, err);
          setPolling(false);
        }
      }
    });
    if (!rt.unsub) setPolling(false);       // the client has no realtime: polling, no claim
  } catch (e) {
    console.warn('Realtime unavailable; polling', e);
    rt.status = null;
    setPolling(false);
  }
}

/* ============================================================
   ACCOUNT EVENTS (M4, FR-61)
   SIGNED_IN · TOKEN_REFRESHED · USER_UPDATED · SIGNED_OUT reload the
   profile, inbox, Mine, the open court's pickups and the channel. A
   sign-in or confirmation link lands here with the session in the hash;
   supabase-js consumes it, this file ignores it and cleans it.
   ============================================================ */
const AUTH_EVENTS = new Set(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'SIGNED_OUT']);
const AUTH_HASH = /^#(access_token|refresh_token|expires_in|expires_at|token_type|type|provider_token|provider_refresh_token|error|error_code|error_description)=/;

function onAuthChange(event, session) {
  if (!AUTH_EVENTS.has(event)) return;
  // auth-js awaits its listeners inside its own lock; defer so nothing here re-enters the client there.
  setTimeout(() => afterAuthChange(event, session).catch(e => console.warn('Auth refresh failed', e)), 0);
}

async function afterAuthChange(event, session) {
  const uid = session && session.user ? session.user.id : null;
  if (!uid) {
    state.me = null; state.inbox = []; state.mine = {}; state.minePickups = []; state.myVotes = {};
    state.friends = { fresh: false, edges: [], incoming: [], list: [], query: '', results: [] };
    if (state.inboxOpen) { state.inboxOpen = false; renderInbox(); }
    closeSheet();
  } else {
    state.me = await BE.myProfile(true).catch(() => null);
    await syncAnonymousFlag();
  }
  state.mineFresh = false; state.friends.fresh = false;
  await refreshInbox();                      // also the header buttons and the friends badge
  refreshCourtPanel();                       // the open court's pickups; an open form survives (renderPickups)
  const top = topSheet();
  if (top && top.kind === 'mine') renderMinePanel().catch(() => {});
  if (top && top.kind === 'profile') {
    repaintAccount();
    if (event === 'SIGNED_IN' && !BE.isAnonymous() && BE.userEmail()) sheetFlash('Email confirmed ✓');
  }
  if (uid !== state.rt.uid || !rtLive()) await startRealtime();   // the channel follows the session
  cleanAuthHash();
}

// The confirmation click made the user permanent; the profile row learns it on the next upsert
// (upsert_profile in 0002 reads the JWT's is_anonymous claim).
async function syncAnonymousFlag() {
  const me = state.me;
  if (!me || !me.is_anonymous || BE.isAnonymous()) return;
  try { state.me = await BE.upsertProfile(me.username, me.display_name, me.skill); }
  catch (e) { console.warn('Could not refresh is_anonymous', e); }
}

// An #error=… hash (an expired link) is shown in one line; a token hash is supabase-js's to read.
function authHashNotice() {
  const params = new URLSearchParams(location.hash.slice(1));
  const desc = params.get('error_description') || params.get('error');
  if (!desc) return;
  authNotice(params.get('error_code') === 'otp_expired' ? 'Sign-in link expired · send a new one' : `Sign-in link: ${desc}`);
}

// Clean an auth hash (or the bare '#' supabase-js leaves) so a reload or a share does not replay it.
function cleanAuthHash() {
  if (AUTH_HASH.test(location.hash) || (location.hash === '' && location.href.endsWith('#'))) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function authNotice(text) {
  const el = document.getElementById('auth-notice');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

/* ============================================================
   DEEP LINK  (#pickup=<token>)
   ============================================================ */
async function openSharedPickup() {
  if (AUTH_HASH.test(location.hash)) {
    // A sign-in or confirmation link, not a pickup. supabase-js reads it (detectSessionInUrl) and the
    // SIGNED_IN event does the rest; wait for the client, surface an error, clean the hash.
    try { if (BE) await BE.getSession(); } catch (e) { /* nothing consumed it */ }
    authHashNotice();
    cleanAuthHash();
    return;
  }
  const m = location.hash.match(/^#pickup=([A-Za-z0-9_-]{8,64})$/);
  if (!m) return;
  if (!live()) { console.warn('Shared pickup link ignored: no backend configured.'); return; }
  try {
    const p = await BE.pickupByToken(m[1]);
    if (!p) { authNotice('That pickup link is no longer valid.'); return; }   // the sidebar line: no panel is open on a cold load
    state.highlightPickup = p.id;
    state.highlightCourt = p.court_id;
    state.highlightShown = false;
    selectCourt(p.court_id, { fly: true });
  } catch (e) {
    console.warn('Could not resolve the shared pickup', e);
  }
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
function wireEvents() {
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  // Phones: tier and status filters fold behind one toggle (v1.3.4); desktop shows them always via CSS.
  const more = document.getElementById('filters-more');
  if (more) more.addEventListener('click', () => {
    const rest = document.getElementById('filters-rest');
    const open = !rest.classList.contains('open');
    rest.classList.toggle('open', open);
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Fewer filters ▴' : 'More filters ▾';
  });
  document.getElementById('detail-backdrop').addEventListener('click', closeDetail);

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const group = chip.dataset.filter;
      const value = chip.dataset.value;
      state.filters[group] = value;

      document.querySelectorAll(`.chip[data-filter="${group}"]`).forEach(c => {
        c.classList.remove('active', 'active-accent', 'active-green');
        c.setAttribute('aria-pressed', 'false');
      });

      const activeClass = group === 'tier' ? 'active-accent'
                         : group === 'status' ? 'active-green'
                         : 'active';
      chip.classList.add('active', activeClass);
      chip.setAttribute('aria-pressed', 'true');

      renderAll();
    });
  });

  const inboxBtn = document.getElementById('inbox-btn');
  if (inboxBtn) {
    // One header layer at a time: the bell closes an open sheet (toggleSheet closes the inbox), so
    // the dropdown is never painted under a sheet and Escape closes the layer the player sees.
    inboxBtn.addEventListener('click', () => { if (topSheet()) closeSheet(); state.inboxOpen = !state.inboxOpen; renderInbox(); });
  }

  wireSheet();
  window.addEventListener('hashchange', openSharedPickup);
}

function updateTime() {
  const now = new Date();
  const opts = { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true };
  document.getElementById('current-time').textContent = now.toLocaleString('en-US', opts).toUpperCase();
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
async function boot() {
  try {
    // Before the first read: a magic link's SIGNED_IN can fire while the courts are still loading.
    if (BE) { try { BE.onAuthChange(onAuthChange); } catch (e) { console.warn('Auth events unavailable', e); } }
    const [courts, slams] = await Promise.all([fetchCourts(), fetchSlams()]);
    COURTS = courts;
    GRAND_SLAMS = slams;
    hydrateReportsIntoCourts();
    applyTheme();
    renderDataSource();
    state.dataReady = true;

    wireEvents();
    updateTime();
    setInterval(updateTime, 30000);
    setInterval(applyTheme, 3600000);
    setInterval(renderAll, 600000);

    if (state.mapReady) buildMap();
    else { renderList(); renderStats(); } // partial render before map ready

    if (live()) {
      refreshInbox().then(syncAnonymousFlag);
      setPolling(false);            // inbox 60 s, courts 5 min until the channel says SUBSCRIBED
      startRealtime();
      window.addEventListener('pagehide', stopRealtime);
      window.addEventListener('pageshow', (e) => { if (e.persisted) startRealtime(); });
      openSharedPickup();
    }
  } catch (err) {
    console.error('Boot failed:', err);
    document.getElementById('map-loading').textContent = 'Failed to load court data. Check console.';
  }
}

// Map-key warning: if maps script hasn't fired callback in 5s, show banner
setTimeout(() => {
  if (!state.mapReady) {
    document.getElementById('key-warning')?.classList.add('shown');
    document.getElementById('map-loading')?.classList.add('hidden');
  }
}, 5000);

document.addEventListener('DOMContentLoaded', boot);
