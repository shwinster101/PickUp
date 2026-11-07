/* ============================================================
   OPENCOURT — backend client (Supabase via supabase-js UMD)
   ============================================================
   Thin wrapper over the tables, views and RPC functions defined in
   supabase/migrations/. Every write is an RPC whose rules live in SQL
   under auth.uid(); this file never decides who the caller is.

   Backend.enabled is false when config.js has no URL/key or the
   supabase-js script did not load; app.js then runs in offline mode.

   M4: subscribe() opens one realtime channel (Postgres Changes under
   RLS); onAuthChange() relays auth events; linkEmail / signInWithEmail
   are the account upgrade (keep this account · sign in elsewhere).
   ============================================================ */
(function () {
  const cfg = window.OPENCOURT_CONFIG || {};
  const enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);

  let client = null;
  let session = null;
  let profile = null;

  // Human wording for the error names the SQL functions raise.
  const MESSAGES = {
    auth_required: 'Sign-in failed. Try again.',
    profile_required: 'Pick a name first.',
    rate_limited: 'You already reported this court in the last 15 minutes.',
    private_court: 'Private courts take no reports.',
    unknown_court: 'This court is not in the catalogue.',
    invalid_username: 'Usernames are 3–20 characters: a–z, 0–9, underscore.',
    username_taken: 'That username is taken.',
    invalid_skill: 'Skill is 1 to 5.',
    sport_not_at_court: 'That sport is not played at this court.',
    starts_in_past: 'The start time has passed.',
    too_far_ahead: 'Pickups can be set up to 30 days ahead.',
    pickup_full: 'This pickup is full.',
    pickup_not_open: 'This pickup is no longer open.',
    already_joined: 'You are already in.',
    not_joined: 'You are not in this pickup.',
    organiser_cannot_leave: 'Organisers cancel instead of leaving.',
    not_organiser: 'Only the organiser can do that.',
    no_invitation: 'There is no invitation to answer.',
    already_attendee: 'Already on the roster.',
    unknown_player: 'No such player.',
    cannot_invite_self: 'You are already in your own pickup.',
    unknown_pickup: 'This pickup no longer exists.',
    // M3 — friends (0003: send/accept/reject/cancel/remove)
    cannot_friend_self: 'That is you.',
    already_requested: 'Already asked.',
    no_request: 'No request to answer.',
    already_friends: 'Already friends.',
    not_friends: 'Not friends.',
    // M3 — results (0003: record_result)
    pickup_not_in_progress: 'This pickup has not started, or is already closed.',
    bad_winner: 'Pick the winning team.',
    teams_required: 'Each team needs a player.',
    bad_scores: 'One score per set for each team, 0–99.',
    player_in_both_teams: 'A player is on both teams.',
    member_not_attendee: 'Someone listed is not on the roster.',
    // M3 — MVP (0003: vote_mvp)
    pickup_not_closed: 'The result is not in yet.',
    mvp_already_chosen: 'The MVP is already chosen.',
    not_an_attendee: 'You did not play this one.',
    votee_not_attendee: 'That player was not in this pickup.',
    no_self_vote: 'You cannot vote for yourself.',
    already_voted: 'You already voted.',
    // 0006 — limits (owner, 2026-11-07)
    report_limit: 'Reports from one device cover up to 3 courts an hour.',
    too_many_open_pickups: 'You have 5 open pickups. Cancel one, or wait until one starts.',
    pickup_limit: 'That makes 10 new pickups in a day. Try again tomorrow.',
    invite_friends_only: 'Invite friends only: add them as a friend first.',
    friend_request_limit: 'That makes 10 requests this hour. Try again later.',
    too_many_pending_requests: 'You have 20 unanswered requests. Wait for some answers first.',
    request_declined_recently: 'They declined recently. Try again in a few days.'
  };

  function wrap(e) {
    const raw = (e && (e.message || e.error_description || e.msg)) || String(e || 'error');
    const name = /^[a-z_]+$/.test(raw) ? raw : null;
    const out = new Error(name && MESSAGES[name] ? MESSAGES[name] : raw);
    out.code = name || (e && e.code) || 'error';
    out.hint = e && e.hint;
    return out;
  }

  // Where a sign-in or confirmation link lands: this page, same path (must be in the project's
  // redirect allow list; scripts/provision-supabase.sh adds the Pages URL and localhost).
  const redirectTo = () => location.origin + location.pathname;

  function sb() {
    if (!client) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        // detectSessionInUrl: a magic link or an email-change confirmation returns here with the
        // session in the URL hash (#access_token=…; implicit flow, the supabase-js 2.45.4 default);
        // the client consumes it and clears the hash. app.js ignores such hashes (openSharedPickup).
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  async function rpc(name, args) {
    const { data, error } = await sb().rpc(name, args || {});
    if (error) throw wrap(error);
    return data;
  }
  const one = (d) => (Array.isArray(d) ? d[0] || null : d);

  async function getSession() {
    const { data } = await sb().auth.getSession();
    session = data && data.session;
    return session;
  }

  // Optional bot check before a sign-in (owner, 2026-11-07). Off while config.js has no CAPTCHA_SITE_KEY:
  // no script loads and nothing changes. On: Cloudflare Turnstile issues a token (invisible unless it needs
  // a tap) and every sign-in carries it, as Supabase Auth requires once its CAPTCHA protection is enabled
  // with the matching secret. Order matters: the key here first, the dashboard second; the other order
  // refuses every sign-in (supabase/README.md). Turnstile API: render(el, { sitekey, callback,
  // 'error-callback', 'timeout-callback', appearance }) and remove(id), with ?render=explicit.
  let turnstileLoad = null;
  function loadTurnstile() {
    if (!turnstileLoad) {
      turnstileLoad = new Promise((resolve, reject) => {
        if (window.turnstile) return resolve(window.turnstile);
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('The sign-in check did not start. Try again.')));
        s.onerror = () => { turnstileLoad = null; reject(new Error('The sign-in check could not load. Try again.')); };
        document.head.appendChild(s);
      });
    }
    return turnstileLoad;
  }
  async function captchaToken() {
    if (!cfg.CAPTCHA_SITE_KEY) return undefined;
    const ts = await loadTurnstile();
    return new Promise((resolve, reject) => {
      const box = document.createElement('div');
      box.className = 'captcha-box';
      document.body.appendChild(box);
      let id = null;
      const done = (fn, value) => { try { if (id != null) ts.remove(id); } catch (e) { /* already gone */ } box.remove(); fn(value); };
      id = ts.render(box, {
        sitekey: cfg.CAPTCHA_SITE_KEY, appearance: 'interaction-only',
        callback: (token) => done(resolve, token),
        'error-callback': () => done(reject, new Error('The sign-in check failed. Try again.')),
        'timeout-callback': () => done(reject, new Error('The sign-in check timed out. Try again.'))
      });
    });
  }
  const withCaptcha = async (options) => {
    const token = await captchaToken();
    return token ? Object.assign({}, options, { captchaToken: token }) : options;
  };

  // Anonymous identity on first write (FOUNDATION FR-60); upgradeable to an account later (FR-61).
  async function ensureSession() {
    const s = await getSession();
    if (s) return s;
    const options = await withCaptcha(undefined);
    const { data, error } = await sb().auth.signInAnonymously(options ? { options } : undefined);
    if (error) throw wrap(error);
    session = data.session;
    return session;
  }

  // A returning player on a new device: a magic link to the email they kept (FR-61).
  // signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser } }) per
  // https://supabase.com/docs/reference/javascript/auth-signinwithotp (auth-js 2.65.0 in supabase-js
  // 2.45.4). shouldCreateUser: false — "Sign in" never mints a second account for a typo; an unknown
  // email is refused by the server ("Signups not allowed for otp") and reads so.
  async function signInWithEmail(email) {
    const { error } = await sb().auth.signInWithOtp({
      email, options: await withCaptcha({ emailRedirectTo: redirectTo(), shouldCreateUser: false })
    });
    if (error) {
      if (/signups not allowed/i.test(error.message || '')) throw Object.assign(new Error('No account with that email yet. Keep this one instead.'), { code: 'no_account' });
      throw wrap(error);
    }
    return true;
  }

  // Keep this account: link an email to the current (anonymous) user. Same uid, history kept
  // (FR-61). auth.updateUser({ email }, { emailRedirectTo }) per
  // https://supabase.com/docs/reference/javascript/auth-updateuser; Supabase mails a confirmation
  // link and the user stays anonymous until it is clicked
  // (https://supabase.com/docs/guides/auth/auth-anonymous, "Convert an anonymous user"). The SQL
  // profile's is_anonymous is refreshed from the JWT claim on the next upsert_profile (0002).
  async function linkEmail(email) {
    await ensureSession();
    const { data, error } = await sb().auth.updateUser({ email }, { emailRedirectTo: redirectTo() });
    if (error) throw wrap(error);
    if (data && data.user && session) session.user = data.user;
    return true;
  }

  // This device only: supabase-js 2.45.4 defaults signOut to scope 'global' (every device's refresh
  // tokens revoked); the row reads plainly "Sign out", so it signs out here and nowhere else.
  async function signOut() {
    await sb().auth.signOut({ scope: 'local' });
    session = null; profile = null;
  }

  // Facts about the current session the page shows (never decides with): anonymous or not, the
  // email, and an email awaiting its confirmation click. is_anonymous rides the user object
  // (and the JWT, which the SQL reads); an older server without it reads as anonymous when no
  // email is attached.
  const user = () => (session && session.user) || null;
  const isAnonymous = () => { const u = user(); return !u || (u.is_anonymous == null ? !u.email : u.is_anonymous === true); };
  const userEmail = () => { const u = user(); return (u && u.email) || null; };
  const pendingEmail = () => { const u = user(); return (u && u.new_email) || null; };

  // Auth events, with the cached session kept current. Events (auth-js 2.65.0): INITIAL_SESSION,
  // SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, MFA_CHALLENGE_VERIFIED
  // (https://supabase.com/docs/reference/javascript/auth-onauthstatechange). Returns an unsubscribe.
  function onAuthChange(cb) {
    const { data } = sb().auth.onAuthStateChange((event, s) => {
      session = s || null;
      if (!s) profile = null;
      cb(event, s || null);
    });
    return () => data && data.subscription && data.subscription.unsubscribe();
  }

  // ---- realtime (M4) --------------------------------------------------------------------------
  // One channel on Postgres Changes. The server authorises every event against the subscriber's
  // own role and claims, so the tables' RLS (0002) decides what arrives: pickups to every visitor
  // (public select policy), pickup_attendees to signed-in players, notifications only for rows
  // whose recipient_id = auth.uid() (the filter below narrows the stream server-side as well).
  // court_reports is not published (0005): its RLS lets only the author read a row.
  // API: client.channel(name).on('postgres_changes', { event, schema, table, filter }, cb)
  //   .subscribe((status, err) => …) with status SUBSCRIBED | CHANNEL_ERROR | TIMED_OUT | CLOSED;
  //   client.removeChannel(channel) tears it down. Per
  //   https://supabase.com/docs/guides/realtime/postgres-changes and
  //   https://supabase.com/docs/reference/javascript/subscribe (realtime-js 2.10.2 in supabase-js 2.45.4).
  // Returns an unsubscribe function, or null when the client has no realtime (the page then polls).
  function subscribe({ onPickups, onNotifications, onStatus }) {
    const c = sb();
    if (typeof c.channel !== 'function') return null;
    const uid = (session && session.user && session.user.id) || null;
    const pickups = (payload) => onPickups && onPickups(payload);
    let ch = c.channel('pickups-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pickups' }, pickups);
    if (uid) {
      // pickup_attendees and notifications are readable by the authenticated role only.
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'pickup_attendees' }, pickups)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` },
          (payload) => onNotifications && onNotifications(payload));
    }
    ch.subscribe((status, err) => onStatus && onStatus(status, err));
    return () => { try { c.removeChannel(ch); } catch (e) { /* already torn down */ } };
  }

  // ---- courts and reports (M1) ---------------------------------------------------------------
  async function fetchCourts() {
    const { data, error } = await sb().from('courts_live').select('*').order('name');
    if (error) throw wrap(error);
    return data;
  }

  async function submitReport(courtId, status) {
    await ensureSession();
    return rpc('submit_report', { p_court_id: courtId, p_status: status });
  }

  // ---- identity (M2) ------------------------------------------------------------------------
  async function myProfile(force) {
    if (profile && !force) return profile;
    const s = await getSession();
    if (!s) return null;
    const { data, error } = await sb().from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error) throw wrap(error);
    profile = data;
    return profile;
  }

  async function upsertProfile(username, displayName, skill) {
    await ensureSession();
    profile = one(await rpc('upsert_profile', {
      p_username: username, p_display_name: displayName, p_skill: skill ? Number(skill) : null, p_metro: cfg.METRO || 'LA'
    }));
    return profile;
  }

  // ---- pickups (M2) -------------------------------------------------------------------------
  async function listPickups(courtId) {
    let q = sb().from('open_pickups').select('*').order('starts_at');
    if (courtId) q = q.eq('court_id', courtId);
    const { data, error } = await q;
    if (error) throw wrap(error);
    return data;
  }

  async function myPickups() {
    if (!(await getSession())) return [];
    const { data, error } = await sb().from('my_pickups').select('*').order('starts_at');
    if (error) throw wrap(error);
    return data;
  }

  const createPickup = ({ courtId, sport, startsAt, capacity, note }) =>
    rpc('create_pickup', { p_court_id: courtId, p_sport: sport, p_starts_at: startsAt, p_capacity: capacity, p_note: note || null }).then(one);
  const joinPickup = (id) => rpc('join_pickup', { p_pickup_id: id }).then(one);
  const leavePickup = (id) => rpc('leave_pickup', { p_pickup_id: id });
  const cancelPickup = (id) => rpc('cancel_pickup', { p_pickup_id: id }).then(one);
  const respondToInvitation = (id, accept) => rpc('respond_to_invitation', { p_pickup_id: id, p_accept: !!accept });
  const pickupByToken = (token) => rpc('pickup_by_token', { p_token: token }).then(one);
  const roster = (id) => rpc('pickup_roster', { p_pickup_id: id });

  // ---- inbox (M2) ---------------------------------------------------------------------------
  async function notifications(limit) {
    if (!(await getSession())) return [];
    const { data, error } = await sb().from('my_notifications').select('*').is('read_at', null)
      .order('created_at', { ascending: false }).limit(limit || 20);
    if (error) throw wrap(error);
    return data;
  }
  const markRead = (ids) => rpc('mark_notifications_read', { p_ids: ids });

  // ---- friends (M3; 0003_friends_results_mvp.sql) --------------------------------------------
  // Argument names are the SQL functions' own p_* names; the rules live in SQL under auth.uid().
  const searchPlayers = (q) => rpc('search_players', { p_query: q });
  const friendStatus = (otherId) => rpc('friend_status', { p_other: otherId });            // 'friends' | 'pending_out' | 'pending_in' | 'none'
  const sendFriendRequest = (addresseeId) => rpc('send_friend_request', { p_addressee: addresseeId }); // → 'pending_out' | 'friends'
  const acceptFriendRequest = (requesterId) => rpc('accept_friend_request', { p_requester: requesterId });
  const rejectFriendRequest = (requesterId) => rpc('reject_friend_request', { p_requester: requesterId });
  const cancelFriendRequest = (addresseeId) => rpc('cancel_friend_request', { p_addressee: addresseeId });
  const removeFriend = (otherId) => rpc('remove_friend', { p_other: otherId });
  const myFriends = () => rpc('my_friends');
  const incomingFriendRequests = () => rpc('incoming_friend_requests');

  // My edges in friendships (RLS: rows where I am either side). One read gives every friend_status
  // for a list of players: both directions = friends, mine only = pending_out, theirs only = pending_in.
  async function myFriendEdges() {
    if (!(await getSession())) return [];
    const { data, error } = await sb().from('friendships').select('requester_id,addressee_id');
    if (error) throw wrap(error);
    return data || [];
  }

  // ---- invitations (M2 functions, M3 screens) ------------------------------------------------
  const inviteToPickup = (pickupId, playerId) => rpc('invite_to_pickup', { p_pickup_id: pickupId, p_player_id: playerId }).then(one);
  const cancelInvitation = (pickupId, playerId) => rpc('cancel_invitation', { p_pickup_id: pickupId, p_player_id: playerId });

  // ---- results and MVP (M3) -----------------------------------------------------------------
  // record_result(p_pickup_id uuid, p_team1 uuid[], p_team2 uuid[], p_team1_scores int[], p_team2_scores int[], p_winning_team int) → pickups row
  const recordResult = ({ pickupId, team1, team2, team1Scores, team2Scores, winningTeam }) =>
    rpc('record_result', {
      p_pickup_id: pickupId, p_team1: team1, p_team2: team2,
      p_team1_scores: team1Scores, p_team2_scores: team2Scores, p_winning_team: winningTeam
    }).then(one);
  // vote_mvp(p_pickup_id uuid, p_votee uuid) → true when this vote decided the MVP
  const voteMvp = (pickupId, voteeId) => rpc('vote_mvp', { p_pickup_id: pickupId, p_votee: voteeId });

  // My own votes (RLS: voter_id = auth.uid()), to show "voted" on a closed pickup.
  async function myVotes() {
    if (!(await getSession())) return [];
    const { data, error } = await sb().from('mvp_votes').select('pickup_id,votee_id');
    if (error) throw wrap(error);
    return data || [];
  }

  // Set scores of a closed pickup (pickup_teams is readable by everyone).
  async function pickupTeams(pickupId) {
    const { data, error } = await sb().from('pickup_teams').select('team_no,set_scores').eq('pickup_id', pickupId).order('team_no');
    if (error) throw wrap(error);
    return data || [];
  }

  // player_standing for the current user: games, wins, mvps, goat_score (2 per win, 3 per MVP; provisional, in the view only).
  async function myStanding() {
    const s = await getSession();
    if (!s) return null;
    const { data, error } = await sb().from('player_standing').select('*').eq('player_id', s.user.id).maybeSingle();
    if (error) throw wrap(error);
    return data;
  }

  // Names for a set of player ids (profiles are readable by any authenticated user).
  async function profilesByIds(ids) {
    const list = Array.from(new Set((ids || []).filter(Boolean)));
    if (list.length === 0 || !(await getSession())) return [];
    const { data, error } = await sb().from('profiles').select('id,username,display_name,skill').in('id', list);
    if (error) throw wrap(error);
    return data || [];
  }

  window.Backend = {
    enabled,
    getSession, ensureSession, signInWithEmail, linkEmail, signOut,
    userId: () => (session && session.user && session.user.id) || null,
    isAnonymous, userEmail, pendingEmail, onAuthChange, subscribe,
    fetchCourts, submitReport,
    myProfile, upsertProfile,
    listPickups, myPickups, createPickup, joinPickup, leavePickup, cancelPickup, respondToInvitation, pickupByToken, roster,
    notifications, markRead,
    searchPlayers, friendStatus, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, cancelFriendRequest, removeFriend,
    myFriends, incomingFriendRequests, myFriendEdges,
    inviteToPickup, cancelInvitation,
    recordResult, voteMvp, myVotes, pickupTeams, myStanding, profilesByIds
  };
})();
