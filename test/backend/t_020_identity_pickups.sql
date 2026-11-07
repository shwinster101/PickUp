-- M2: identity and pickups (FOUNDATION FR-61–64, FR-80–88, FR-100–101).
-- Players: A organiser, B, C; D has a session but no profile.
\set ON_ERROR_STOP on
select test.set('A', 'bbbbbbbb-0000-0000-0000-000000000001');
select test.set('B', 'bbbbbbbb-0000-0000-0000-000000000002');
select test.set('C', 'bbbbbbbb-0000-0000-0000-000000000003');
select test.set('D', 'bbbbbbbb-0000-0000-0000-000000000004');

-- Profiles
begin;
select test.login(test.get('A')::uuid);
select test.expect_error($$select public.create_pickup('memorial-park-sm', 'tennis', now() + interval '2 hours', 4)$$, 'profile_required', 'a pickup needs a profile');
select test.expect_error($$select public.upsert_profile('Bad Name!', 'Ash')$$, 'invalid_username', 'the username is validated');
select test.check((select username from public.upsert_profile('Ash_56', 'Ashwin')) = 'ash_56', 'A creates a profile; username lowercased');
select test.check((select is_anonymous from public.profiles where id = auth.uid()) = false, 'a non-anonymous session is recorded as such');
select test.expect_error($$insert into public.profiles (id, username, display_name) values (auth.uid(), 'x', 'y')$$, '42501', 'no direct insert into profiles');
commit;

begin;
select test.login(test.get('B')::uuid);
select test.expect_error($$select public.upsert_profile('ASH_56', 'Someone')$$, 'username_taken', 'usernames are unique case-insensitively');
select test.check((select username from public.upsert_profile('bsmith', 'B Smith', null, 3)) = 'bsmith', 'B creates a profile with a skill');
update public.profiles set display_name = 'Bee Smith' where id = auth.uid();
select test.check((select display_name from public.profiles where id = auth.uid()) = 'Bee Smith', 'B edits own display name directly');
do $$
declare n integer;
begin
  update public.profiles set display_name = 'hacked' where id = test.get('A')::uuid;
  get diagnostics n = row_count;
  perform test.check(n = 0, 'B cannot edit A''s profile (0 rows)');
end $$;
commit;

begin;
select test.login(test.get('C')::uuid);
select test.check((select username from public.upsert_profile('cjones', 'C Jones')) = 'cjones', 'C creates a profile');
commit;

-- Creating a pickup: the rules
begin;
select test.login(test.get('A')::uuid);
select test.expect_error($$select public.create_pickup('westchester-tennis', 'pickleball', now() + interval '2 hours', 4)$$, 'sport_not_at_court', 'the sport must be offered at the court');
select test.expect_error($$select public.create_pickup('memorial-park-sm', 'tennis', now() - interval '1 hour', 4)$$, 'starts_in_past', 'the start cannot be in the past');
select test.expect_error($$select public.create_pickup('memorial-park-sm', 'tennis', now() + interval '40 days', 4)$$, 'too_far_ahead', 'the start cannot be more than 30 days out');
select test.expect_error($$select public.create_pickup('memorial-park-sm', 'tennis', now() + interval '2 hours', 1)$$, '23514', 'capacity below 2 is refused');
select test.expect_error($$select public.create_pickup('nope', 'tennis', now() + interval '2 hours', 4)$$, 'unknown_court', 'an unknown court is refused');
do $$
declare v_id text;
begin
  select id into v_id from public.courts where tier = 'private' limit 1;
  perform test.expect_error(format($f$select public.create_pickup(%L, 'tennis', now() + interval '2 hours', 4)$f$, v_id), 'private_court', 'no pickups at private courts');
end $$;
select test.set('p1', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() + interval '2 hours', 2, '  Doubles, bring balls  ')));
select test.check((select note from public.pickups where id = test.get('p1')::uuid) = 'Doubles, bring balls', 'the note is trimmed');
select test.check((select status from public.my_pickups where id = test.get('p1')::uuid) = 'open', 'the organiser sees the pickup as open in my_pickups');
select test.check((select my_status from public.my_pickups where id = test.get('p1')::uuid) = 'owner', 'the organiser is the owner attendee');
select test.set('t1', (select share_token from public.my_pickups where id = test.get('p1')::uuid));
select test.check(length(test.get('t1')) = 16, 'a share token was minted');
select test.check((select joined_count from public.open_pickups where id = test.get('p1')::uuid) = 1, 'the organiser counts toward capacity');
select test.check((select open_pickup_count from public.courts_live where id = 'memorial-park-sm') = 1, 'the court shows one open pickup');
select test.expect_error($$select public.leave_pickup(test.get('p1')::uuid)$$, 'organiser_cannot_leave', 'the organiser cannot leave');
select test.expect_error($$insert into public.pickups (court_id, organiser_id, sport, starts_at, capacity) values ('memorial-park-sm', auth.uid(), 'tennis', now(), 4)$$, '42501', 'no direct insert into pickups');
select test.expect_error($$update public.pickups set capacity = 30 where id = test.get('p1')::uuid$$, '42501', 'no direct update of pickups');
select test.expect_error($$insert into public.pickup_attendees (pickup_id, player_id, status) values (test.get('p1')::uuid, auth.uid(), 'joined')$$, '42501', 'no direct insert into attendees');
commit;

-- Join / full / leave
begin;
select test.login(test.get('B')::uuid);
select test.check((select status from public.join_pickup(test.get('p1')::uuid)) = 'joined', 'B joins');
select test.expect_error($$select public.join_pickup(test.get('p1')::uuid)$$, 'already_joined', 'B cannot join twice');
commit;

begin;
select test.login(test.get('C')::uuid);
select test.expect_error($$select public.join_pickup(test.get('p1')::uuid)$$, 'pickup_full', 'C is refused: the pickup is full');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.check((select count(*) from public.my_notifications where kind = 'joined' and actor_username = 'bsmith') = 1, 'the organiser is notified that B joined');
commit;

begin;
select test.login(test.get('B')::uuid);
select public.leave_pickup(test.get('p1')::uuid);
select test.expect_error($$select public.leave_pickup(test.get('p1')::uuid)$$, 'not_joined', 'B cannot leave twice');
commit;

begin;
select test.login(test.get('C')::uuid);
select test.check((select status from public.join_pickup(test.get('p1')::uuid)) = 'joined', 'C joins after B left');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.check((select count(*) from public.my_notifications where kind = 'left' and actor_username = 'bsmith') = 1, 'the organiser is notified that B left');
select test.check((select count(*) from public.pickup_roster(test.get('p1')::uuid)) = 2, 'the roster has two players');
commit;

-- Invitations go to friends only (0006). For this section A is friends with B and C: the edges are
-- seeded by the owner, without notifications, and removed before "Cancel", so t_030 starts the
-- friendship flow from nothing.
begin;
insert into public.friendships (requester_id, addressee_id) values
  (test.get('A')::uuid, test.get('B')::uuid), (test.get('B')::uuid, test.get('A')::uuid),
  (test.get('A')::uuid, test.get('C')::uuid), (test.get('C')::uuid, test.get('A')::uuid);
commit;

-- Invitations
begin;
select test.login(test.get('A')::uuid);
select test.set('p2', (select id::text from public.create_pickup('memorial-park-sm', 'pickleball', now() + interval '3 hours', 4)));
select test.check((select status from public.invite_to_pickup(test.get('p2')::uuid, test.get('B')::uuid)) = 'invited', 'A invites B');
select test.expect_error(format($$select public.invite_to_pickup(%L, %L)$$, test.get('p2'), test.get('B')), 'already_attendee', 'B cannot be invited twice');
select test.expect_error(format($$select public.invite_to_pickup(%L, %L)$$, test.get('p2'), test.get('D')), 'unknown_player', 'a session without a profile cannot be invited');
select test.expect_error(format($$select public.invite_to_pickup(%L, %L)$$, test.get('p2'), test.get('A')), 'cannot_invite_self', 'the organiser cannot invite themselves');
commit;

begin;
select test.login(test.get('C')::uuid);
select test.expect_error(format($$select public.invite_to_pickup(%L, %L)$$, test.get('p2'), test.get('B')), 'not_organiser', 'only the organiser invites');
select test.expect_error($$select public.respond_to_invitation(test.get('p2')::uuid, true)$$, 'no_invitation', 'without an invitation there is nothing to accept');
select test.expect_error(format($$select public.cancel_invitation(%L, %L)$$, test.get('p2'), test.get('B')), 'not_organiser', 'only the organiser cancels invitations');
commit;

begin;
select test.login(test.get('B')::uuid);
select test.check((select count(*) from public.my_notifications where kind = 'invitation' and pickup_id = test.get('p2')::uuid) = 1, 'B has the invitation in the inbox');
select public.respond_to_invitation(test.get('p2')::uuid, true);
select test.check((select my_status from public.my_pickups where id = test.get('p2')::uuid) = 'joined', 'B accepted and is joined');
commit;

begin;
select test.login(test.get('A')::uuid);
select public.invite_to_pickup(test.get('p2')::uuid, test.get('C')::uuid);
commit;

begin;
select test.login(test.get('C')::uuid);
select public.respond_to_invitation(test.get('p2')::uuid, false);
select test.check(not exists (select 1 from public.my_pickups where id = test.get('p2')::uuid), 'C declined and has no row');
commit;

begin;
select test.login(test.get('A')::uuid);
select public.invite_to_pickup(test.get('p2')::uuid, test.get('C')::uuid);
select public.cancel_invitation(test.get('p2')::uuid, test.get('C')::uuid);
select test.expect_error(format($$select public.cancel_invitation(%L, %L)$$, test.get('p2'), test.get('C')), 'no_invitation', 'cancelling twice reports no invitation');
commit;

begin;
delete from public.friendships
where requester_id in (test.get('A')::uuid, test.get('B')::uuid, test.get('C')::uuid)
  and addressee_id in (test.get('A')::uuid, test.get('B')::uuid, test.get('C')::uuid);
commit;

-- Cancel
begin;
select test.login(test.get('B')::uuid);
select test.expect_error($$select public.cancel_pickup(test.get('p2')::uuid)$$, 'not_organiser', 'B cannot cancel A''s pickup');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.check((select status from public.cancel_pickup(test.get('p2')::uuid)) = 'cancelled', 'A cancels p2');
select test.expect_error($$select public.cancel_pickup(test.get('p2')::uuid)$$, 'pickup_not_open', 'a cancelled pickup cannot be cancelled again');
commit;

begin;
select test.login(test.get('B')::uuid);
select test.check(exists (select 1 from public.my_notifications where kind = 'cancelled' and pickup_id = test.get('p2')::uuid), 'B is told the pickup is cancelled');
select test.expect_error($$select public.join_pickup(test.get('p2')::uuid)$$, 'pickup_not_open', 'nobody can join a cancelled pickup');
select test.check(not exists (select 1 from public.open_pickups where id = test.get('p2')::uuid), 'a cancelled pickup leaves the board');
commit;

-- The clock
begin;
select test.login(test.get('A')::uuid);
select test.set('p3', (select id::text from public.create_pickup('memorial-park-sm', 'tennis', now() - interval '10 minutes', 4)));
commit;

begin;
select test.login(test.get('B')::uuid);
select test.expect_error($$select public.start_due_pickups()$$, '42501', 'clients cannot run the clock');
commit;

begin;
select test.check(public.start_due_pickups() = 1, 'the clock starts the one due pickup');
select test.check((select status from public.pickups where id = test.get('p3')::uuid) = 'in_progress', 'p3 is in progress');
select test.check(exists (select 1 from public.notifications where recipient_id = test.get('A')::uuid and kind = 'enter_result' and pickup_id = test.get('p3')::uuid), 'the organiser is asked to enter the result');
select test.check(public.start_due_pickups() = 0, 'the clock is idempotent');
commit;

begin;
select test.login(test.get('B')::uuid);
select test.expect_error($$select public.join_pickup(test.get('p3')::uuid)$$, 'pickup_not_open', 'nobody can join after the start');
commit;

-- Deep link and board, as an anonymous visitor
begin;
select test.anon();
select test.check((select court_id from public.pickup_by_token(test.get('t1'))) = 'memorial-park-sm', 'anon resolves a share token to its court');
select test.check((select spots_left from public.pickup_by_token(test.get('t1'))) = 0, 'the link shows spots left');
select test.check((select count(*) from public.pickup_by_token('nope')) = 0, 'an unknown token resolves to nothing');
select test.check((select count(*) from public.open_pickups where court_id = 'memorial-park-sm') = 2, 'the board lists p1 (open) and p3 (in progress)');
select test.check((select open_pickup_count from public.courts_live where id = 'memorial-park-sm') = 2, 'courts_live counts both');
select test.expect_error($$select * from public.my_pickups$$, '42501', 'anon has no my_pickups');
select test.expect_error($$select * from public.pickup_roster(test.get('p1')::uuid)$$, '42501', 'anon cannot read a roster');
rollback;

-- Notifications are private
begin;
select test.login(test.get('C')::uuid);
select test.check((select count(*) from public.notifications where recipient_id <> auth.uid()) = 0, 'C sees nobody else''s notifications');
commit;

begin;
select test.login(test.get('A')::uuid);
select test.set('n1', (select min(id)::text from public.my_notifications where read_at is null));
select test.check(public.mark_notifications_read(array[test.get('n1')::bigint]) = 1, 'A marks an own notification read');
select test.check(public.mark_notifications_read(array[test.get('n1')::bigint]) = 0, 'marking it again changes nothing');
commit;

begin;
select test.login(test.get('B')::uuid);
select test.check(public.mark_notifications_read(array[test.get('n1')::bigint]) = 0, 'B cannot mark A''s notification read');
do $$
declare n integer;
begin
  update public.notifications set read_at = now() where id = test.get('n1')::bigint;
  get diagnostics n = row_count;
  perform test.check(n = 0, 'a direct update of another''s notification touches 0 rows');
end $$;
select test.expect_error($$insert into public.notifications (recipient_id, kind) values (auth.uid(), 'joined')$$, '42501', 'no direct insert into notifications');
select test.expect_error($$select * from public.event_log$$, '42501', 'the event log is not readable by clients');
commit;
