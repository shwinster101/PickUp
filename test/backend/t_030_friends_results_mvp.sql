-- M3: friends, results, MVP, standing (FOUNDATION FR-70–72, FR-90–95). Continues t_020's players.
\set ON_ERROR_STOP on
select test.set('E', 'bbbbbbbb-0000-0000-0000-000000000005');

-- Friend requests: send → accept (the 2021 flow)
begin;
select test.login(test.get('A')::uuid);
select test.check(public.send_friend_request(test.get('B')::uuid) = 'pending_out', 'A asks B');
select test.expect_error(format($$select public.send_friend_request(%L)$$, test.get('B')), 'already_requested', 'A cannot ask twice');
select test.check(public.friend_status(test.get('B')::uuid) = 'pending_out', 'A sees pending_out');
select test.expect_error(format($$select public.send_friend_request(%L)$$, test.get('A')), 'cannot_friend_self', 'nobody friends themselves');
select test.expect_error(format($$select public.send_friend_request(%L)$$, test.get('D')), 'unknown_player', 'no request to a session without a profile');
select test.expect_error($$insert into public.friendships (requester_id, addressee_id) values (auth.uid(), test.get('C')::uuid)$$, '42501', 'no direct insert into friendships');
commit;

begin;
select test.login(test.get('B')::uuid);
select test.check(public.friend_status(test.get('A')::uuid) = 'pending_in', 'B sees pending_in');
select test.check(exists (select 1 from public.incoming_friend_requests() where id = test.get('A')::uuid), 'A is in B''s incoming requests');
select test.check((select count(*) from public.my_notifications where kind = 'friend_request' and actor_username = 'ash_56') = 1, 'B was notified');
select public.accept_friend_request(test.get('A')::uuid);
select test.check(public.friend_status(test.get('A')::uuid) = 'friends', 'after accepting they are friends');
select test.check(public.are_friends(test.get('A')::uuid, test.get('B')::uuid), 'are_friends is symmetric');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.check(exists (select 1 from public.my_friends() where id = test.get('B')::uuid), 'A lists B as a friend');
select test.check((select count(*) from public.my_notifications where kind = 'friend_accepted' and actor_username = 'bsmith') = 1, 'A was told B accepted');
commit;

-- reject
begin; select test.login(test.get('C')::uuid); select public.send_friend_request(test.get('A')::uuid); commit;
begin;
select test.login(test.get('A')::uuid);
select public.reject_friend_request(test.get('C')::uuid);
select test.check(public.friend_status(test.get('C')::uuid) = 'none', 'rejected request is gone');
select test.expect_error(format($$select public.reject_friend_request(%L)$$, test.get('C')), 'no_request', 'rejecting twice reports no request');
commit;
begin;
select test.login(test.get('C')::uuid);
select test.check((select count(*) from public.my_notifications where kind = 'friend_rejected') = 1, 'C was told');
commit;

-- cancel my own request
begin;
select test.login(test.get('C')::uuid);
select public.send_friend_request(test.get('B')::uuid);
select public.cancel_friend_request(test.get('B')::uuid);
select test.check(public.friend_status(test.get('B')::uuid) = 'none', 'cancelled request is gone');
select test.expect_error(format($$select public.cancel_friend_request(%L)$$, test.get('B')), 'no_request', 'cancelling twice reports no request');
commit;

-- mutual requests complete the friendship
begin; select test.login(test.get('B')::uuid); select public.send_friend_request(test.get('C')::uuid); commit;
begin;
select test.login(test.get('C')::uuid);
select test.check(public.send_friend_request(test.get('B')::uuid) = 'friends', 'a reverse request completes the friendship');
commit;

-- remove
begin;
select test.login(test.get('A')::uuid);
select public.remove_friend(test.get('B')::uuid);
select test.check(public.friend_status(test.get('B')::uuid) = 'none', 'removed friend is gone both ways');
select test.expect_error(format($$select public.remove_friend(%L)$$, test.get('B')), 'not_friends', 'removing twice reports not friends');
select test.check((select count(*) from public.friendships) = 0, 'A sees no edges once none involve A (B–C''s two edges are invisible to A)');
commit;

-- search (parameterised; 2021 interpolated SQL)
begin;
select test.login(test.get('A')::uuid);
select test.check((select count(*) from public.search_players('bs')) = 1, 'prefix search finds bsmith');
select test.check((select username from public.search_players('BS') limit 1) = 'bsmith', 'search is case-insensitive');
select test.check((select count(*) from public.search_players('%')) = 0, 'wildcards are literal');
select test.check((select count(*) from public.search_players('a')) = 0, 'one character returns nothing');
select test.check((select count(*) from public.search_players('jones')) = 1, 'display names match anywhere');
select test.check((select count(*) from public.search_players($q$'; drop table profiles; --$q$)) = 0, 'injection text is just text');
commit;

-- Results. p4: A (owner), B, C joined; started by the clock.
begin;
select test.login(test.get('A')::uuid);
select test.set('p4', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() - interval '5 minutes', 4)));
commit;
-- A game takes time (0006: a result counts toward standing 20+ minutes after the start): p4 began 35 minutes ago.
begin; update public.pickups set starts_at = now() - interval '35 minutes' where id = test.get('p4')::uuid; commit;
begin; select test.login(test.get('B')::uuid); select public.join_pickup(test.get('p4')::uuid); commit;
begin; select test.login(test.get('C')::uuid); select public.join_pickup(test.get('p4')::uuid); commit;
begin; select test.check(public.start_due_pickups() >= 1, 'the clock starts p4'); commit;

begin;
select test.login(test.get('B')::uuid);
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], array[%L]::uuid[], array[6], array[4], 1)$$, test.get('p4'), test.get('B'), test.get('C')), 'not_organiser', 'only the organiser records the result');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], array[%L]::uuid[], array[6,6], array[4], 1)$$, test.get('p4'), test.get('A'), test.get('B')), 'bad_scores', 'one score per set for each team');
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], array[%L]::uuid[], array[6], array[4], 1)$$, test.get('p4'), test.get('A'), test.get('A')), 'player_in_both_teams', 'a player cannot be on both teams');
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], array[%L]::uuid[], array[6], array[4], 1)$$, test.get('p4'), test.get('A'), test.get('D')), 'member_not_attendee', 'team members must be attendees');
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], array[%L]::uuid[], array[6], array[4], 3)$$, test.get('p4'), test.get('A'), test.get('B')), 'bad_winner', 'the winner is team 1 or 2');
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], '{}'::uuid[], array[6], array[4], 1)$$, test.get('p4'), test.get('A')), 'teams_required', 'both teams need a player');
select test.check((select status from public.record_result(test.get('p4')::uuid,
  array[test.get('A'), test.get('B')]::uuid[], array[test.get('C')]::uuid[], array[6, 4], array[3, 6], 1)) = 'closed', 'A records the result; the pickup closes');
select test.check((select winning_team_no from public.pickups where id = test.get('p4')::uuid) = 1, 'team 1 won');
select test.check((select count(*) from public.pickup_roster(test.get('p4')::uuid) where team_no = 1) = 2
             and (select team_no from public.pickup_roster(test.get('p4')::uuid) where username = 'cjones') = 2, 'team membership is recorded on the roster');
select test.check((select count(*) from public.pickup_teams where pickup_id = test.get('p4')::uuid) = 2
             and (select set_scores from public.pickup_teams where pickup_id = test.get('p4')::uuid and team_no = 2) = array[3, 6], 'set scores are stored per team');
select test.check((select count(*) from public.my_notifications where pickup_id = test.get('p4')::uuid and kind = 'vote_mvp') = 1, 'the organiser is asked to vote too');
select test.expect_error(format($$select public.record_result(%L, array[%L]::uuid[], array[%L]::uuid[], array[6], array[4], 1)$$, test.get('p4'), test.get('A'), test.get('B')), 'pickup_not_in_progress', 'a result is recorded once');
commit;

begin;
select test.check((select count(*) from public.notifications where pickup_id = test.get('p4')::uuid and kind = 'vote_mvp') = 3, 'every attendee is asked to vote (owner view)');
commit;

-- MVP votes
begin;
select test.login(test.get('E')::uuid);
select public.upsert_profile('eve', 'Eve');
select test.expect_error(format($$select public.vote_mvp(%L, %L)$$, test.get('p4'), test.get('A')), 'not_an_attendee', 'a non-attendee cannot vote');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.expect_error(format($$select public.vote_mvp(%L, %L)$$, test.get('p4'), test.get('A')), 'no_self_vote', 'no self-vote');
select test.expect_error(format($$select public.vote_mvp(%L, %L)$$, test.get('p4'), test.get('E')), 'votee_not_attendee', 'the votee must be an attendee');
select test.check(public.vote_mvp(test.get('p4')::uuid, test.get('B')::uuid) = false, 'the first vote does not decide');
select test.expect_error(format($$select public.vote_mvp(%L, %L)$$, test.get('p4'), test.get('C')), 'already_voted', 'one vote per attendee');
select test.expect_error($$insert into public.mvp_votes (pickup_id, voter_id, votee_id) values (test.get('p4')::uuid, auth.uid(), test.get('C')::uuid)$$, '42501', 'no direct insert into votes');
commit;

begin; select test.login(test.get('B')::uuid); select test.check(public.vote_mvp(test.get('p4')::uuid, test.get('C')::uuid) = false, 'second vote does not decide'); commit;
begin; select test.login(test.get('C')::uuid); select test.check(public.vote_mvp(test.get('p4')::uuid, test.get('B')::uuid) = true, 'the last vote decides'); commit;

begin;
select test.check((select mvp_id from public.pickups where id = test.get('p4')::uuid) = test.get('B')::uuid, 'the MVP is B (2 votes to 1)');
select test.check(exists (select 1 from public.notifications where recipient_id = test.get('B')::uuid and kind = 'you_are_mvp' and pickup_id = test.get('p4')::uuid), 'B is told');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.expect_error(format($$select public.vote_mvp(%L, %L)$$, test.get('p4'), test.get('C')), 'mvp_already_chosen', 'no votes after the MVP is chosen');
select test.check((select (games, wins, mvps, goat_score) from public.player_standing where username = 'bsmith') = (1, 1, 1, 5), 'B''s standing: 1 game, 1 win, 1 MVP → 5');
select test.check((select (games, wins, mvps, goat_score) from public.player_standing where username = 'ash_56') = (1, 1, 0, 2), 'A''s standing: 1 win → 2');
select test.check((select (games, wins, mvps, goat_score) from public.player_standing where username = 'cjones') = (1, 0, 0, 0), 'C''s standing: 1 game, no points');
commit;

-- Tie-break among the leaders only. p5: A, B, C, E. Votes: A→B, B→A, C→A, E→B → A:2, B:2, C:0, E:0.
begin; select test.login(test.get('A')::uuid); select test.set('p5', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() - interval '5 minutes', 4))); commit;
begin; update public.pickups set starts_at = now() - interval '35 minutes' where id = test.get('p5')::uuid; commit;
begin; select test.login(test.get('B')::uuid); select public.join_pickup(test.get('p5')::uuid); commit;
begin; select test.login(test.get('C')::uuid); select public.join_pickup(test.get('p5')::uuid); commit;
begin; select test.login(test.get('E')::uuid); select public.join_pickup(test.get('p5')::uuid); commit;
begin; select public.start_due_pickups(); commit;
begin;
select test.login(test.get('A')::uuid);
select public.record_result(test.get('p5')::uuid, array[test.get('A'), test.get('B')]::uuid[], array[test.get('C'), test.get('E')]::uuid[], array[6], array[2], 1);
select public.vote_mvp(test.get('p5')::uuid, test.get('B')::uuid);
commit;
begin; select test.login(test.get('B')::uuid); select public.vote_mvp(test.get('p5')::uuid, test.get('A')::uuid); commit;
begin; select test.login(test.get('C')::uuid); select public.vote_mvp(test.get('p5')::uuid, test.get('A')::uuid); commit;
begin; select test.login(test.get('E')::uuid); select test.check(public.vote_mvp(test.get('p5')::uuid, test.get('B')::uuid) = true, 'the fourth vote decides p5'); commit;
begin;
select test.check((select mvp_id from public.pickups where id = test.get('p5')::uuid) in (test.get('A')::uuid, test.get('B')::uuid), 'a tie is broken among the leaders only');
commit;

-- Deadline: p6 closed with one vote of two; 24 h later the vote closes with what it has.
begin; select test.login(test.get('A')::uuid); select test.set('p6', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() - interval '5 minutes', 2))); commit;
begin; update public.pickups set starts_at = now() - interval '35 minutes' where id = test.get('p6')::uuid; commit;
begin; select test.login(test.get('B')::uuid); select public.join_pickup(test.get('p6')::uuid); commit;
begin; select public.start_due_pickups(); commit;
begin;
select test.login(test.get('A')::uuid);
select public.record_result(test.get('p6')::uuid, array[test.get('A')]::uuid[], array[test.get('B')]::uuid[], array[6], array[4], 2);
select test.check(public.vote_mvp(test.get('p6')::uuid, test.get('B')::uuid) = false, 'one of two votes is in');
commit;
begin;
select test.check(public.finalize_due_mvp_votes() = 0, 'nothing is due yet');
-- The whole game moves a day back (start and end), so it still lasted 35 minutes.
update public.pickups set ends_at = ends_at - interval '25 hours', starts_at = starts_at - interval '25 hours' where id = test.get('p6')::uuid;
select test.check(public.finalize_due_mvp_votes() = 1, 'after 24 h the vote closes');
select test.check((select mvp_id from public.pickups where id = test.get('p6')::uuid) = test.get('B')::uuid, 'B is MVP of p6 with the one vote cast');
commit;

-- A game nobody closed expires without a result and never counts.
begin; select test.login(test.get('A')::uuid); select test.set('p7', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() - interval '5 minutes', 2))); commit;
begin;
select public.start_due_pickups();
select test.check(public.expire_stale_pickups() = 0, 'a fresh game does not expire');
update public.pickups set starts_at = now() - interval '25 hours' where id = test.get('p7')::uuid;
select test.check(public.expire_stale_pickups() = 1, 'a 25-hour-old unfinished game expires');
select test.check((select status from public.pickups where id = test.get('p7')::uuid) = 'closed' and (select winning_team_no from public.pickups where id = test.get('p7')::uuid) is null, 'expired: closed, no result');
select test.check((select games from public.player_standing where username = 'ash_56') = 3, 'A''s games count p4, p5, p6 and not the expired p7');
commit;

-- Clients cannot run the schedulers.
begin;
select test.login(test.get('A')::uuid);
select test.expect_error($$select public.finalize_due_mvp_votes()$$, '42501', 'clients cannot finalize votes');
select test.expect_error($$select public.expire_stale_pickups()$$, '42501', 'clients cannot expire games');
select test.expect_error($$select public.finalize_mvp(test.get('p4')::uuid)$$, '42501', 'clients cannot pick an MVP');
select test.expect_error($$select public.notify(auth.uid(), 'joined', null, null)$$, '42501', 'clients cannot write notifications through the helper');
select test.expect_error($$select public.log_event('x', null, null)$$, '42501', 'clients cannot write the event log through the helper');
commit;
