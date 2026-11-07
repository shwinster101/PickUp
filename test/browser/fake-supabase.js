// Injected before the page scripts: a fake supabase-js that mimics the shapes of the views and
// RPCs defined in supabase/migrations/, so the backend-mode UI paths run without a project.
// M2 surface (courts_live, open_pickups, my_pickups, my_notifications, the pickup RPCs) and the
// M3 surface (search_players, friendships, my_friends, incoming_friend_requests, invite/cancel,
// pickup_roster, record_result, vote_mvp, mvp_votes, player_standing, profiles.in()).
// M4 surface: auth.onAuthStateChange (events emitted by signInAnonymously / updateUser / signOut),
// auth.updateUser and auth.signInWithOtp captured in window.__fake.auth, and a realtime channel()
// driven by window.__fakeRealtime: undefined → the client has no channel() at all (the page must
// poll); 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' → the status subscribe() reports.
// Test hooks: __fake.notify(kind) and __fake.someoneJoined() push postgres_changes events;
// __fake.confirmEmail() plays the confirmation click (a new, permanent session arrives).
window.OPENCOURT_CONFIG = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'fake', GOOGLE_MAP_ID: '', METRO: 'LA' };
(function () {
  const me = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';
  const C = '33333333-3333-3333-3333-333333333333';
  const D = '44444444-4444-4444-4444-444444444444';
  let session = null;
  let profile = null;
  // Other players (profiles rows). `me` joins this pool once upsert_profile runs.
  const players = [
    { id: B, username: 'bsmith', display_name: 'B Smith', skill: 3 },
    { id: C, username: 'cjones', display_name: 'C Jones', skill: 4 },
    { id: D, username: 'dlee', display_name: 'D Lee', skill: null }
  ];
  const byId = (id) => (profile && profile.id === id) ? profile : players.find(p => p.id === id) || null;
  const pickups = [{ id: 'p-1', court_id: 'memorial-park-sm', court_name: 'Memorial Park', lat: 34.0263, lng: -118.476, sport: 'tennis',
    starts_at: new Date(Date.now() + 3600e3).toISOString(), capacity: 4, note: 'Doubles', status: 'open',
    organiser_username: 'bsmith', organiser_name: 'B Smith', joined_count: 2, spots_left: 2, created_at: new Date().toISOString() }];
  // my_pickups rows. p-live: mine, started 30 min ago (the clock would have flipped it to in_progress).
  // p-done: B's, closed yesterday with a result, I played; nobody has voted; no MVP yet.
  let mine = [
    { id: 'p-live', court_id: 'memorial-park-sm', court_name: 'Memorial Park', sport: 'tennis', starts_at: new Date(Date.now() - 1800e3).toISOString(), ends_at: null,
      capacity: 4, note: null, status: 'in_progress', share_token: 'livelivelivelive', organiser_id: me, winning_team_no: null, mvp_id: null, my_status: 'owner', my_team_no: null, joined_count: 2 },
    { id: 'p-done', court_id: 'griffith-park-riverside', court_name: 'Griffith Park Riverside', sport: 'pickleball', starts_at: new Date(Date.now() - 86400e3).toISOString(), ends_at: new Date(Date.now() - 82800e3).toISOString(),
      capacity: 4, note: null, status: 'closed', share_token: 'donedonedonedone', organiser_id: B, winning_team_no: 1, mvp_id: null, my_status: 'joined', my_team_no: 1, joined_count: 3 }
  ];
  const rosters = {
    'p-1': [{ player_id: B, status: 'owner', team_no: null }],
    'p-live': [{ player_id: me, status: 'owner', team_no: null }, { player_id: B, status: 'joined', team_no: null }],
    'p-done': [{ player_id: B, status: 'owner', team_no: 1 }, { player_id: me, status: 'joined', team_no: 1 }, { player_id: C, status: 'joined', team_no: 2 }]
  };
  let edges = [];  // friendships: [requester_id, addressee_id]
  const votes = []; // mvp_votes: { pickup_id, voter_id, votee_id }
  let notes = [{ id: 1, kind: 'invitation', created_at: new Date().toISOString(), read_at: null, pickup_id: 'p-1', actor_username: 'bsmith', actor_name: 'B Smith', court_id: 'memorial-park-sm', court_name: 'Memorial Park', pickup_starts_at: pickups[0].starts_at, pickup_sport: 'tennis' }];
  const has = (a, b) => edges.some(e => e[0] === a && e[1] === b);
  const friends = (a, b) => has(a, b) && has(b, a);
  window.__fake = {
    calls: [],
    // Test hook: the other party asks instead (my outgoing request to `username` becomes their incoming one).
    flipToIncoming(username) {
      const p = players.find(x => x.username === username);
      edges = edges.filter(e => !(e[0] === me && e[1] === p.id));
      if (!has(p.id, me)) edges.push([p.id, me]);
      notes.push({ id: notes.length + 1, kind: 'friend_request', created_at: new Date().toISOString(), read_at: null, pickup_id: null, actor_username: p.username, actor_name: p.display_name, court_id: null, court_name: null, pickup_starts_at: null, pickup_sport: null });
    },
    edges: () => edges.slice(), votes: () => votes.slice(), rosters,
    profile: () => profile,
    auth: { updates: [], otps: [], events: [], anon: [] },
    channels: []
  };
  const rosterRows = (id) => (rosters[id] || []).map(r => Object.assign({ username: (byId(r.player_id) || {}).username, display_name: (byId(r.player_id) || {}).display_name || '?', joined_at: null }, r));
  function table(name) {
    const q = { _filters: [], _in: null, _order: null, _limit: null };
    const exec = async () => {
      window.__fake.calls.push('from:' + name);
      if (name === 'courts_live') {
        const res = await fetch('assets/data/courts.json'); const data = await res.json();
        return { data: data.courts.map(c => Object.assign({}, c, { open_pickup_count: c.id === 'memorial-park-sm' ? 1 : 0, recent_report_count: 0 })), error: null };
      }
      if (name === 'profiles') {
        if (q._in && q._in[0] === 'id') return { data: q._in[1].map(byId).filter(Boolean), error: null };
        return { data: profile, error: null };
      }
      if (name === 'open_pickups') { const f = q._filters.find(f => f[0] === 'court_id'); return { data: pickups.filter(p => !f || p.court_id === f[1]), error: null }; }
      if (name === 'my_pickups') return { data: session ? mine : [], error: null };
      if (name === 'my_notifications') return { data: notes.filter(n => !n.read_at), error: null };
      if (name === 'friendships') return { data: edges.filter(e => e[0] === me || e[1] === me).map(e => ({ requester_id: e[0], addressee_id: e[1] })), error: null };
      if (name === 'mvp_votes') return { data: votes.filter(v => v.voter_id === me).map(v => ({ pickup_id: v.pickup_id, votee_id: v.votee_id })), error: null };
      if (name === 'pickup_teams') return { data: [], error: null };
      if (name === 'player_standing') {
        const row = { player_id: me, username: profile && profile.username, display_name: profile && profile.display_name, skill: profile && profile.skill, games: 1, wins: 1, mvps: 0, goat_score: 2 };
        return { data: row, error: null };
      }
      return { data: [], error: { message: 'unknown table ' + name } };
    };
    const chain = {
      select() { return chain; }, order() { return chain; }, limit() { return chain; },
      eq(k, v) { q._filters.push([k, v]); return chain; }, is() { return chain; },
      in(k, v) { q._in = [k, v]; return chain; },
      maybeSingle() { return exec(); },
      then(res, rej) { return exec().then(res, rej); }
    };
    return chain;
  }
  const err = (message) => ({ data: null, error: { message } });
  async function rpc(name, args) {
    window.__fake.calls.push('rpc:' + name + ':' + JSON.stringify(args));
    if (name === 'submit_report') return { data: { id: 1, court_id: args.p_court_id, status: args.p_status, created_at: new Date().toISOString() }, error: null };
    // is_anonymous as 0002 writes it: from the session's claim (false once an email is confirmed).
    if (name === 'upsert_profile') { profile = { id: me, username: args.p_username.toLowerCase(), display_name: args.p_display_name, skill: args.p_skill, is_anonymous: !!(session && session.user.is_anonymous) }; return { data: profile, error: null }; }
    if (name === 'create_pickup') {
      const p = { id: 'p-new', court_id: args.p_court_id, court_name: 'Memorial Park', sport: args.p_sport, starts_at: args.p_starts_at, capacity: args.p_capacity, note: args.p_note, status: 'open', organiser_username: profile.username, organiser_name: profile.display_name, joined_count: 1, spots_left: args.p_capacity - 1, share_token: 'abcdef0123456789' };
      pickups.push(p); mine.push(Object.assign({}, p, { my_status: 'owner', organiser_id: me, winning_team_no: null, mvp_id: null }));
      rosters['p-new'] = [{ player_id: me, status: 'owner', team_no: null }];
      return { data: p, error: null };
    }
    if (name === 'join_pickup') { if (args.p_pickup_id === 'p-1') { pickups[0].joined_count++; pickups[0].spots_left--; mine.push(Object.assign({}, pickups[0], { my_status: 'joined', organiser_id: B })); rosters['p-1'].push({ player_id: me, status: 'joined', team_no: null }); return { data: { status: 'joined' }, error: null }; } return err('pickup_full'); }
    if (name === 'leave_pickup') { mine = mine.filter(m => m.id !== args.p_pickup_id); return { data: null, error: null }; }
    if (name === 'cancel_pickup') { const m = mine.find(x => x.id === args.p_pickup_id); if (m) m.status = 'cancelled'; return { data: { status: 'cancelled' }, error: null }; }
    if (name === 'respond_to_invitation') { notes = notes.filter(n => n.pickup_id !== args.p_pickup_id); if (args.p_accept) mine.push(Object.assign({}, pickups[0], { my_status: 'joined', organiser_id: B })); return { data: null, error: null }; }
    if (name === 'mark_notifications_read') { notes.forEach(n => { if (args.p_ids.includes(n.id)) n.read_at = 'x'; }); return { data: 1, error: null }; }
    if (name === 'pickup_by_token') return { data: args.p_token === 'abcdef0123456789' ? [pickups[0]] : [], error: null };
    // ---- M3 ----
    if (name === 'search_players') {
      const q = String(args.p_query || '').trim().toLowerCase();
      if (q.length < 2) return { data: [], error: null };
      const pool = profile ? players.concat([profile]) : players;
      return { data: pool.filter(p => p.username.startsWith(q) || p.display_name.toLowerCase().includes(q)), error: null };
    }
    if (name === 'friend_status') { const o = args.p_other; return { data: friends(me, o) ? 'friends' : has(me, o) ? 'pending_out' : has(o, me) ? 'pending_in' : 'none', error: null }; }
    if (name === 'send_friend_request') {
      const o = args.p_addressee;
      if (!profile) return err('profile_required');
      if (o === me) return err('cannot_friend_self');
      if (!byId(o)) return err('unknown_player');
      if (has(me, o)) return err('already_requested');
      edges.push([me, o]);
      return { data: has(o, me) ? 'friends' : 'pending_out', error: null };
    }
    if (name === 'accept_friend_request') { const o = args.p_requester; if (!has(o, me)) return err('no_request'); if (!has(me, o)) edges.push([me, o]); return { data: null, error: null }; }
    if (name === 'reject_friend_request') { const o = args.p_requester; if (friends(me, o)) return err('already_friends'); if (!has(o, me)) return err('no_request'); edges = edges.filter(e => !(e[0] === o && e[1] === me)); return { data: null, error: null }; }
    if (name === 'cancel_friend_request') { const o = args.p_addressee; if (friends(me, o)) return err('already_friends'); if (!has(me, o)) return err('no_request'); edges = edges.filter(e => !(e[0] === me && e[1] === o)); return { data: null, error: null }; }
    if (name === 'remove_friend') { const o = args.p_other; if (!friends(me, o)) return err('not_friends'); edges = edges.filter(e => !((e[0] === me && e[1] === o) || (e[0] === o && e[1] === me))); return { data: null, error: null }; }
    if (name === 'my_friends') return { data: players.filter(p => friends(me, p.id)), error: null };
    if (name === 'incoming_friend_requests') return { data: players.filter(p => has(p.id, me) && !has(me, p.id)), error: null };
    if (name === 'pickup_roster') return { data: rosterRows(args.p_pickup_id), error: null };
    if (name === 'invite_to_pickup') {
      const m = mine.find(x => x.id === args.p_pickup_id);
      if (!m) return err('unknown_pickup');
      if (m.organiser_id !== me) return err('not_organiser');
      if (m.status !== 'open') return err('pickup_not_open');
      if (args.p_player_id === me) return err('cannot_invite_self');
      if (!byId(args.p_player_id)) return err('unknown_player');
      if ((rosters[m.id] || []).some(r => r.player_id === args.p_player_id)) return err('already_attendee');
      const row = { pickup_id: m.id, player_id: args.p_player_id, status: 'invited', invited_by: me, team_no: null, joined_at: null };
      rosters[m.id].push({ player_id: row.player_id, status: 'invited', team_no: null });
      return { data: row, error: null };
    }
    if (name === 'cancel_invitation') {
      const r = rosters[args.p_pickup_id] || [];
      const i = r.findIndex(x => x.player_id === args.p_player_id && x.status === 'invited');
      if (i < 0) return err('no_invitation');
      r.splice(i, 1); return { data: null, error: null };
    }
    if (name === 'record_result') {
      const m = mine.find(x => x.id === args.p_pickup_id);
      if (!m) return err('unknown_pickup');
      if (m.organiser_id !== me) return err('not_organiser');
      if (m.status !== 'in_progress' && !(m.status === 'open' && new Date(m.starts_at) <= new Date())) return err('pickup_not_in_progress');
      if (![1, 2].includes(args.p_winning_team)) return err('bad_winner');
      if (!args.p_team1.length || !args.p_team2.length) return err('teams_required');
      if (!args.p_team1_scores.length || args.p_team1_scores.length !== args.p_team2_scores.length) return err('bad_scores');
      const r = rosters[m.id] || [];
      args.p_team1.forEach(id => { const x = r.find(y => y.player_id === id); if (x) x.team_no = 1; });
      args.p_team2.forEach(id => { const x = r.find(y => y.player_id === id); if (x) x.team_no = 2; });
      m.status = 'closed'; m.winning_team_no = args.p_winning_team; m.ends_at = new Date().toISOString();
      return { data: Object.assign({}, m), error: null };
    }
    if (name === 'vote_mvp') {
      const m = mine.find(x => x.id === args.p_pickup_id);
      if (!m) return err('unknown_pickup');
      if (m.status !== 'closed' || m.winning_team_no == null) return err('pickup_not_closed');
      if (m.mvp_id) return err('mvp_already_chosen');
      if (args.p_votee === me) return err('no_self_vote');
      if (votes.some(v => v.pickup_id === m.id && v.voter_id === me)) return err('already_voted');
      votes.push({ pickup_id: m.id, voter_id: me, votee_id: args.p_votee });
      const n = (rosters[m.id] || []).filter(r => r.status !== 'invited').length;
      const decided = votes.filter(v => v.pickup_id === m.id).length >= n;
      if (decided) m.mvp_id = args.p_votee;
      return { data: decided, error: null };
    }
    return err('rate_limited');
  }
  // ---- auth (M4): events and the email upgrade -------------------------------------------------
  let authCb = null;
  const emit = (event) => { window.__fake.auth.events.push(event); if (authCb) setTimeout(() => authCb(event, session), 0); };
  const auth = {
    async getSession() { return { data: { session } }; },
    async signInAnonymously(creds) { window.__fake.auth.anon.push(creds || null); session = { user: { id: me, email: null, new_email: null, is_anonymous: true } }; emit('SIGNED_IN'); return { data: { session }, error: null }; },
    onAuthStateChange(cb) { authCb = cb; setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() { authCb = null; } } } }; },
    async updateUser(attrs, opts) {
      window.__fake.auth.updates.push({ attrs, opts });
      if (!session) return { data: { user: null }, error: { message: 'Auth session missing!' } };
      session.user.new_email = attrs.email;                 // pending until the confirmation click
      emit('USER_UPDATED');
      return { data: { user: session.user }, error: null };
    },
    async signInWithOtp(creds) { window.__fake.auth.otps.push(creds); return { data: { user: null, session: null }, error: null }; },
    async signOut() { session = null; emit('SIGNED_OUT'); return { error: null }; }
  };
  // Test hook: the confirmation link was clicked elsewhere; a new, permanent session arrives here.
  window.__fake.confirmEmail = function () {
    if (!session || !session.user.new_email) return false;
    session.user.email = session.user.new_email; session.user.new_email = null; session.user.is_anonymous = false;
    emit('SIGNED_IN');
    return true;
  };

  // ---- realtime (M4) ----------------------------------------------------------------------------
  const channels = window.__fake.channels;
  function channel(name) {
    const ch = {
      name, handlers: [], status: null, cb: null, removed: false,
      on(type, opts, cb) { ch.handlers.push({ type, opts, cb }); return ch; },
      subscribe(cb) {
        ch.cb = cb;
        const st = window.__fakeRealtime;
        setTimeout(() => { if (ch.removed) return; ch.status = st; cb && cb(st, st === 'SUBSCRIBED' ? undefined : new Error('fake ' + st)); }, 30);
        return ch;
      },
      // realtime-js reports CLOSED to the subscribe callback when a channel is torn down.
      async unsubscribe() { const was = ch.status; ch.removed = true; ch.status = 'CLOSED'; if (was === 'SUBSCRIBED' && ch.cb) ch.cb('CLOSED'); return 'ok'; }
    };
    channels.push(ch);
    window.__fake.calls.push('channel:' + name.replace(/-[a-z0-9]+$/, ''));
    return ch;
  }
  // Test hook: deliver one postgres_changes event to every SUBSCRIBED handler on `table`, honouring a
  // column=eq.value filter the way the server would. Returns the number of handlers reached.
  window.__fake.push = function (table, row, eventType) {
    let n = 0;
    channels.forEach(ch => {
      if (ch.status !== 'SUBSCRIBED') return;
      ch.handlers.forEach(h => {
        if (h.type !== 'postgres_changes' || h.opts.table !== table) return;
        const f = h.opts.filter && h.opts.filter.match(/^(\w+)=eq\.(.+)$/);
        if (f && String(row[f[1]]) !== f[2]) return;
        n++;
        h.cb({ eventType: eventType || 'INSERT', schema: 'public', table, new: row, old: {}, commit_timestamp: new Date().toISOString(), errors: null });
      });
    });
    return n;
  };
  window.__fake.notify = function (kind) {
    const n = { id: notes.length + 1, kind: kind || 'joined', created_at: new Date().toISOString(), read_at: null, pickup_id: 'p-1', actor_username: 'cjones', actor_name: 'C Jones', court_id: 'memorial-park-sm', court_name: 'Memorial Park', pickup_starts_at: pickups[0].starts_at, pickup_sport: 'tennis' };
    notes.push(n);
    return window.__fake.push('notifications', { id: n.id, recipient_id: me, actor_id: C, pickup_id: 'p-1', kind: n.kind, created_at: n.created_at, read_at: null });
  };
  window.__fake.someoneJoined = function () {
    pickups[0].joined_count++; pickups[0].spots_left--;
    rosters['p-1'].push({ player_id: C, status: 'joined', team_no: null });
    return window.__fake.push('pickup_attendees', { pickup_id: 'p-1', player_id: C, status: 'joined', team_no: null });
  };

  window.supabase = { createClient() {
    const client = { from: table, rpc, auth };
    if (window.__fakeRealtime !== undefined) {
      client.channel = channel;
      client.removeChannel = async (ch) => { const i = channels.indexOf(ch); return ch.unsubscribe().then(r => { if (i >= 0) channels[i].removed = true; return r; }); };
    }
    return client;
  } };
})();
