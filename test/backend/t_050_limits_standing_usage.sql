-- 0006: limits, deletable players, standing rules, the measure of real use (owner, 2026-11-07;
-- working/2026-11-07-limits-usage-next-tier.md). Fresh players (cccccccc-…); earlier files' state stays.
-- The audit's probes (working/2026-11-07-audit-probes.sql) flip here: P1 deletion, P2 farm, P3 stranger
-- fan-out, P4 pickup flood, P5 report flood.
\set ON_ERROR_STOP on

-- ---------- Reports: one session covers at most 3 different courts an hour (P5) ----------
begin;
select test.login('cccccccc-0000-0000-0000-000000000001', true);
select public.submit_report('memorial-park-sm', 'open');
select public.submit_report('mar-vista-rec', 'open');
select public.submit_report('griffith-riverside', 'toss');
select test.expect_error($$select public.submit_report('rancho-cienega', 'full')$$, 'report_limit', 'a fourth court within the hour is refused');
commit;
begin;
update public.court_reports set created_at = created_at - interval '16 minutes' where reporter_id = 'cccccccc-0000-0000-0000-000000000001';
select test.login('cccccccc-0000-0000-0000-000000000001', true);
select test.check((select status from public.submit_report('memorial-park-sm', 'full')) = 'full', 'one of the same three courts again after 15 minutes');
select test.expect_error($$select public.submit_report('rancho-cienega', 'full')$$, 'report_limit', 'still no fourth court within the hour');
commit;
begin;
update public.court_reports set created_at = created_at - interval '61 minutes' where reporter_id = 'cccccccc-0000-0000-0000-000000000001';
select test.login('cccccccc-0000-0000-0000-000000000001', true);
select test.check((select status from public.submit_report('rancho-cienega', 'full')) = 'full', 'a fourth court once the hour has passed');
commit;
begin;
select test.anon();
select test.expect_error($$select public.submit_report('memorial-park-sm', 'open')$$, '42501', 'anon has no execute on submit_report');
commit;

-- ---------- Pickups: at most 5 open, 10 created in 24 hours (P4) ----------
begin;
select test.login('cccccccc-0000-0000-0000-000000000002', true);
select public.upsert_profile('limit_org', 'Limit Org');
do $$ declare i int; begin
  for i in 1..5 loop perform public.create_pickup('memorial-park-sm', 'tennis', now() + (i || ' hours')::interval, 4); end loop;
end $$;
select test.expect_error($$select public.create_pickup('memorial-park-sm', 'tennis', now() + interval '6 hours', 4)$$, 'too_many_open_pickups', 'a sixth open pickup is refused');
commit;
begin;
select test.login('cccccccc-0000-0000-0000-000000000002', true);
do $$ declare v uuid; i int; begin
  for i in 1..5 loop
    select id into v from public.pickups where organiser_id = auth.uid() and status = 'open' order by starts_at limit 1;
    perform public.cancel_pickup(v);
    perform public.create_pickup('memorial-park-sm', 'tennis', now() + ((10 + i) || ' hours')::interval, 4);
  end loop;
end $$;
select test.check((select count(*) from public.pickups where organiser_id = auth.uid()) = 10, 'cancelling makes room: ten created');
select public.cancel_pickup((select id from public.pickups where organiser_id = auth.uid() and status = 'open' order by starts_at limit 1));
select test.expect_error($$select public.create_pickup('memorial-park-sm', 'tennis', now() + interval '20 hours', 4)$$, 'pickup_limit', 'an eleventh in 24 hours is refused, even with room');
commit;

-- ---------- Invitations: mutual friends only (P3) ----------
begin;
select test.login('cccccccc-0000-0000-0000-000000000003', true);
select public.upsert_profile('inv_org', 'Inv Org');
select test.set('inv_p', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() + interval '3 hours', 4)));
commit;
begin; select test.login('cccccccc-0000-0000-0000-000000000004', true); select public.upsert_profile('inv_guest', 'Inv Guest'); commit;
begin;
select test.login('cccccccc-0000-0000-0000-000000000003', true);
select test.expect_error(format($$select public.invite_to_pickup(%L, %L)$$, test.get('inv_p'), 'cccccccc-0000-0000-0000-000000000004'), 'invite_friends_only', 'a stranger cannot be invited');
select public.send_friend_request('cccccccc-0000-0000-0000-000000000004');
select test.expect_error(format($$select public.invite_to_pickup(%L, %L)$$, test.get('inv_p'), 'cccccccc-0000-0000-0000-000000000004'), 'invite_friends_only', 'a pending request is not a friendship');
commit;
begin; select test.login('cccccccc-0000-0000-0000-000000000004', true); select public.accept_friend_request('cccccccc-0000-0000-0000-000000000003'); commit;
begin;
select test.login('cccccccc-0000-0000-0000-000000000003', true);
select test.check((select status from public.invite_to_pickup(test.get('inv_p')::uuid, 'cccccccc-0000-0000-0000-000000000004')) = 'invited', 'a friend can be invited');
commit;

-- ---------- Friend requests: 10 an hour, 20 unanswered, 7 days after a decline (P3) ----------
begin;
do $$ declare i int; begin
  for i in 1..25 loop
    perform test.login(('cccccccc-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid, true);
    perform public.upsert_profile('fr_target_' || i, 'Target ' || i);
  end loop;
end $$;
commit;
begin;
select test.login('cccccccc-0000-0000-0000-000000000005', true);
select public.upsert_profile('fr_asker', 'Asker');
do $$ declare i int; begin
  for i in 1..10 loop perform public.send_friend_request(('cccccccc-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid); end loop;
end $$;
select test.expect_error($$select public.send_friend_request('cccccccc-0000-0000-0001-000000000011')$$, 'friend_request_limit', 'an eleventh request within the hour is refused');
commit;
begin;
update public.notifications set created_at = created_at - interval '61 minutes'
where actor_id = 'cccccccc-0000-0000-0000-000000000005' and kind = 'friend_request';
select test.login('cccccccc-0000-0000-0000-000000000005', true);
do $$ declare i int; begin
  for i in 11..20 loop perform public.send_friend_request(('cccccccc-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid); end loop;
end $$;
select test.check((select count(*) from public.friendships where requester_id = auth.uid()) = 20, 'an hour later ten more fit');
commit;
begin;
update public.notifications set created_at = created_at - interval '61 minutes'
where actor_id = 'cccccccc-0000-0000-0000-000000000005' and kind = 'friend_request';
select test.login('cccccccc-0000-0000-0000-000000000005', true);
select test.expect_error($$select public.send_friend_request('cccccccc-0000-0000-0001-000000000021')$$, 'too_many_pending_requests', '20 unanswered requests stop a 21st');
commit;
begin; select test.login('cccccccc-0000-0000-0001-000000000022', true); select public.send_friend_request('cccccccc-0000-0000-0000-000000000005'); commit;
begin;
select test.login('cccccccc-0000-0000-0000-000000000005', true);
select test.check(public.send_friend_request('cccccccc-0000-0000-0001-000000000022') = 'friends', 'completing a friendship the other player started is never limited');
commit;
begin; select test.login('cccccccc-0000-0000-0001-000000000024', true); select public.send_friend_request('cccccccc-0000-0000-0001-000000000025'); commit;
begin; select test.login('cccccccc-0000-0000-0001-000000000025', true); select public.reject_friend_request('cccccccc-0000-0000-0001-000000000024'); commit;
begin;
select test.login('cccccccc-0000-0000-0001-000000000024', true);
select test.expect_error($$select public.send_friend_request('cccccccc-0000-0000-0001-000000000025')$$, 'request_declined_recently', 'no new request for 7 days after a decline');
commit;
begin;
update public.notifications set created_at = created_at - interval '8 days'
where recipient_id = 'cccccccc-0000-0000-0001-000000000024' and kind = 'friend_rejected';
select test.login('cccccccc-0000-0000-0001-000000000024', true);
select test.check(public.send_friend_request('cccccccc-0000-0000-0001-000000000025') = 'pending_out', 'after 7 days they may ask again');
commit;

-- ---------- Standing: 20 minutes a game, 3 counted games a day, MVPs only on counted games (P2) ----------
begin;
do $$
declare
  f uuid := 'cccccccc-0000-0000-0002-000000000000';
  s uuid[] := array['cccccccc-0000-0000-0002-000000000001', 'cccccccc-0000-0000-0002-000000000002', 'cccccccc-0000-0000-0002-000000000003']::uuid[];
  i int; j int; pid uuid;
begin
  perform test.login(f, true); perform public.upsert_profile('farmer2', 'Farmer');
  for j in 1..3 loop perform test.login(s[j], true); perform public.upsert_profile('sock2_' || j, 'Sock ' || j); end loop;
  for i in 1..4 loop                                  -- the audit's farm: start a minute ago, record at once
    perform test.login(f, true);
    pid := (public.create_pickup('memorial-park-sm', 'tennis', now() - interval '1 minute', 4, 'farm')).id;
    for j in 1..3 loop perform test.login(s[j], true); perform public.join_pickup(pid); end loop;
    perform test.login(f, true);
    perform public.record_result(pid, array[f, s[1]], array[s[2], s[3]], array[6], array[0], 1);
    perform public.vote_mvp(pid, s[1]);
    for j in 1..3 loop perform test.login(s[j], true); perform public.vote_mvp(pid, f); end loop;
  end loop;
end $$;
select test.check((select (games, wins, mvps, goat_score) from public.player_standing where username = 'farmer2') = (0, 0, 0, 0), 'games recorded a minute after their start earn nothing');
commit;
begin;
do $$
declare
  f uuid := 'cccccccc-0000-0000-0002-000000000000';
  s uuid[] := array['cccccccc-0000-0000-0002-000000000001', 'cccccccc-0000-0000-0002-000000000002', 'cccccccc-0000-0000-0002-000000000003']::uuid[];
  i int; j int; pid uuid;
begin
  for i in 1..4 loop                                  -- four real games on 15 January (Los Angeles)
    perform test.login(f, true);
    pid := (public.create_pickup('memorial-park-sm', 'tennis', now() + interval '1 hour', 4, 'proper')).id;
    for j in 1..3 loop perform test.login(s[j], true); perform public.join_pickup(pid); end loop;
    perform test.admin();
    update public.pickups set starts_at = timestamptz '2026-01-15 09:00:00 America/Los_Angeles' + (i || ' hours')::interval where id = pid;
    perform test.login(f, true);
    perform public.record_result(pid, array[f, s[1]], array[s[2], s[3]], array[6], array[0], 1);
    perform public.vote_mvp(pid, s[1]);
    for j in 1..3 loop perform test.login(s[j], true); perform public.vote_mvp(pid, f); end loop;
  end loop;
end $$;
select test.check((select (games, wins, mvps, goat_score) from public.player_standing where username = 'farmer2') = (3, 3, 3, 15), 'four real games on one day: three count (3 wins, 3 MVPs → 15)');
select test.check((select (games, wins, mvps) from public.player_standing where username = 'sock2_1') = (3, 3, 0), 'the teammate: three counted games, three wins, no MVP');
commit;
begin;
select test.anon();
select test.expect_error($$select count(*) from public.player_standing$$, '42501', 'anon cannot read standing (signed-in players only)');
commit;

-- ---------- Deleting a player who organised games (P1) ----------
begin;
select test.login('cccccccc-0000-0000-0003-000000000001', true);
select public.upsert_profile('del_org', 'Del Org');
select test.set('del_open', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() + interval '2 hours', 4)));
select test.set('del_done', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() + interval '1 hour', 2)));
commit;
begin;
select test.login('cccccccc-0000-0000-0003-000000000002', true);
select public.upsert_profile('del_mate', 'Del Mate');
select public.join_pickup(test.get('del_open')::uuid);
select public.join_pickup(test.get('del_done')::uuid);
commit;
begin;
update public.pickups set starts_at = now() - interval '1 hour' where id = test.get('del_done')::uuid;
select test.login('cccccccc-0000-0000-0003-000000000001', true);
select public.record_result(test.get('del_done')::uuid, array['cccccccc-0000-0000-0003-000000000002']::uuid[], array['cccccccc-0000-0000-0003-000000000001']::uuid[], array[6], array[3], 1);
commit;
begin;
delete from auth.users where id = 'cccccccc-0000-0000-0003-000000000001';
select test.check(not exists (select 1 from public.profiles where id = 'cccccccc-0000-0000-0003-000000000001'), 'a player who organised games can be deleted');
select test.check((select (status, organiser_id) from public.pickups where id = test.get('del_open')::uuid) is not distinct from ('cancelled'::public.pickup_status, null::uuid), 'their open pickup is cancelled, its organiser empty');
select test.check((select (status, winning_team_no, organiser_id) from public.pickups where id = test.get('del_done')::uuid) is not distinct from ('closed'::public.pickup_status, 1::smallint, null::uuid), 'their finished game stays, its organiser empty');
select test.check(exists (select 1 from public.notifications where recipient_id = 'cccccccc-0000-0000-0003-000000000002' and kind = 'cancelled' and pickup_id = test.get('del_open')::uuid), 'the joined player is told the pickup is cancelled');
select test.check((select (games, wins) from public.player_standing where username = 'del_mate') = (1, 1), 'the other player keeps the win');
commit;
begin;
select test.login('cccccccc-0000-0000-0003-000000000002', true);
select test.expect_error(format($$select public.cancel_pickup(%L)$$, test.get('del_open')), 'not_organiser', 'nobody is the organiser of an organiser-less pickup');
select test.expect_error(format($$select public.cancel_invitation(%L, %L)$$, test.get('del_open'), 'cccccccc-0000-0000-0003-000000000002'), 'not_organiser', 'nobody cancels its invitations');
commit;
begin;
select test.expect_error(format($$update public.pickups set status = 'open' where id = %L$$, test.get('del_open')), '23514', 'an organiser-less pickup cannot be reopened');
commit;

-- ---------- The measure of real use ----------
begin;
select test.check((select count(*) from metrics.usage_weekly) = 12, 'usage_weekly lists 12 Los Angeles weeks');
select test.check((select count(*) from metrics.usage_weekly where partial) = 1, 'one of them is the week in progress');
select test.check((select real_games from metrics.usage_weekly where partial) >= 1 and (select reporters from metrics.usage_weekly where partial) >= 1, 'this week has real games and reporters');
select test.set('real_before', (select real_games::text from metrics.usage_weekly where partial));
commit;
begin;
select test.login('cccccccc-0000-0000-0004-000000000001', true); select public.upsert_profile('proof_a', 'Proof A');
select test.set('proof_p', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now(), 4, 'two-browsers abc123')));
commit;
begin; select test.login('cccccccc-0000-0000-0004-000000000002', true); select public.upsert_profile('proof_b', 'Proof B'); select public.join_pickup(test.get('proof_p')::uuid); commit;
begin;
select test.check((select real_games::text from metrics.usage_weekly where partial) = test.get('real_before'), 'a game of the two-browser proof is not real use');
commit;
begin;
select test.login('cccccccc-0000-0000-0004-000000000003', true); select public.upsert_profile('the_owner', 'Owner');
select test.set('own_p', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now(), 4, 'Doubles')));
commit;
begin; select test.login('cccccccc-0000-0000-0004-000000000004', true); select public.upsert_profile('a_friend', 'Friend'); select public.join_pickup(test.get('own_p')::uuid); commit;
begin;
select test.check((select real_games from metrics.usage_weekly where partial) = test.get('real_before')::int + 1, 'the owner and a friend count while the owner is not excluded');
insert into metrics.exclusions (player_id, reason) values ('cccccccc-0000-0000-0004-000000000003', 'owner');
select test.check((select real_games::text from metrics.usage_weekly where partial) = test.get('real_before'), 'with the owner excluded, one real player is not a real game');
select test.check((select count(*) from metrics.phase5_gate) = 1 and (select gate_met from metrics.phase5_gate) = false, 'the Phase 5 gate reads not met');
commit;
begin;
select test.login('cccccccc-0000-0000-0004-000000000004', true);
select test.expect_error($$select count(*) from metrics.usage_weekly$$, '42501', 'a signed-in player cannot read the usage measure');
commit;
begin;
select test.anon();
select test.expect_error($$select count(*) from metrics.exclusions$$, '42501', 'anon cannot read the exclusions');
commit;
