-- 0006 — signals that cost something, players who can be deleted, standing that resists farming, and the
-- measure of real use (owner, 2026-11-07; working/2026-11-07-limits-usage-next-tier.md). Additive except
-- where that note's deprecation section says otherwise: pickups.organiser_id becomes nullable (set null
-- when the organiser is deleted) and player_standing is replaced with the same columns.
--
-- Identity is free (anonymous sign-in), so these rules make each fake cost time and sessions; they do not
-- make faking impossible. Every number is here and only here.

-- ---------------------------------------------------------------------------------------------
-- Reports: one session covers at most 3 different courts per rolling hour (audit probe P5: ten sessions
-- turned 18 of 18 public courts Full). The 15-minute rule per court is unchanged.
-- ---------------------------------------------------------------------------------------------
create or replace function public.submit_report(p_court_id text, p_status public.report_status)
returns public.court_reports
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  v_tier public.court_tier;
  v_row  public.court_reports;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  select tier into v_tier from public.courts where id = p_court_id and is_active;
  if not found then
    raise exception 'unknown_court' using errcode = 'P0002';
  end if;
  if v_tier = 'private' then
    raise exception 'private_court' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.court_reports
    where court_id = p_court_id and reporter_id = v_uid
      and created_at > now() - interval '15 minutes'
  ) then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = 'One report per court per device every 15 minutes.';
  end if;
  if (select count(distinct court_id) from public.court_reports
      where reporter_id = v_uid and court_id <> p_court_id
        and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'report_limit' using errcode = 'P0001',
      hint = 'Reports from one device cover at most 3 courts an hour.';
  end if;
  insert into public.court_reports (court_id, reporter_id, status)
  values (p_court_id, v_uid, p_status)
  returning * into v_row;
  return v_row;
end $$;
-- 0001 revoked only from PUBLIC; Supabase's default privileges had granted anon too (the function's own
-- auth check refused it). Now the grant says what the comment always said.
revoke all on function public.submit_report(text, public.report_status) from public, anon, authenticated;
grant execute on function public.submit_report(text, public.report_status) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Pickups: an organiser has at most 5 open pickups and creates at most 10 in 24 hours (audit P4: one
-- session put 50 pickups on one court).
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_pickup(
  p_court_id text, p_sport public.sport, p_starts_at timestamptz, p_capacity integer, p_note text default null)
returns public.pickups
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := public.require_profile();
  v_court  public.courts;
  v_pickup public.pickups;
begin
  select * into v_court from public.courts where id = p_court_id and is_active;
  if not found then
    raise exception 'unknown_court' using errcode = 'P0002';
  end if;
  if v_court.tier = 'private' then
    raise exception 'private_court' using errcode = 'P0001';
  end if;
  if not (p_sport = any (v_court.sports)) then
    raise exception 'sport_not_at_court' using errcode = 'P0001';
  end if;
  if p_starts_at < now() - interval '15 minutes' then
    raise exception 'starts_in_past' using errcode = 'P0001';
  end if;
  if p_starts_at > now() + interval '30 days' then
    raise exception 'too_far_ahead' using errcode = 'P0001';
  end if;
  if (select count(*) from public.pickups where organiser_id = v_uid and status = 'open') >= 5 then
    raise exception 'too_many_open_pickups' using errcode = 'P0001', hint = 'At most 5 open pickups at a time.';
  end if;
  if (select count(*) from public.pickups where organiser_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'pickup_limit' using errcode = 'P0001', hint = 'At most 10 new pickups in 24 hours.';
  end if;
  insert into public.pickups (court_id, organiser_id, sport, starts_at, capacity, note)
  values (p_court_id, v_uid, p_sport, p_starts_at, p_capacity, nullif(btrim(p_note), ''))
  returning * into v_pickup;
  insert into public.pickup_attendees (pickup_id, player_id, status, joined_at)
  values (v_pickup.id, v_uid, 'owner', now());
  perform public.log_event('PICKUP_CREATED', v_pickup.id, jsonb_build_object('court_id', p_court_id, 'sport', p_sport));
  return v_pickup;
end $$;
revoke all on function public.create_pickup(text, public.sport, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.create_pickup(text, public.sport, timestamptz, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Invitations go to mutual friends only (FOUNDATION US-E4 "invite friends"; the Invite panel already
-- lists friends; audit P3: a stranger invited every profile). Organiser checks use `is distinct from`
-- from here on, because an organiser can now be empty (below).
-- ---------------------------------------------------------------------------------------------
create or replace function public.invite_to_pickup(p_pickup_id uuid, p_player_id uuid)
returns public.pickup_attendees
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_profile();
  v_p   public.pickups;
  v_row public.pickup_attendees;
begin
  select * into v_p from public.pickups where id = p_pickup_id for update;
  if not found then
    raise exception 'unknown_pickup' using errcode = 'P0002';
  end if;
  if v_p.organiser_id is distinct from v_uid then
    raise exception 'not_organiser' using errcode = '42501';
  end if;
  if v_p.status <> 'open' then
    raise exception 'pickup_not_open' using errcode = 'P0001';
  end if;
  if p_player_id = v_uid then
    raise exception 'cannot_invite_self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_player_id) then
    raise exception 'unknown_player' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.pickup_attendees where pickup_id = p_pickup_id and player_id = p_player_id) then
    raise exception 'already_attendee' using errcode = 'P0001';
  end if;
  if not public.are_friends(v_uid, p_player_id) then
    raise exception 'invite_friends_only' using errcode = 'P0001', hint = 'Add them as a friend first.';
  end if;
  insert into public.pickup_attendees (pickup_id, player_id, status, invited_by)
  values (p_pickup_id, p_player_id, 'invited', v_uid) returning * into v_row;
  perform public.notify(p_player_id, 'invitation', v_uid, p_pickup_id);
  perform public.log_event('PLAYER_INVITED', p_pickup_id, jsonb_build_object('player_id', p_player_id));
  return v_row;
end $$;
revoke all on function public.invite_to_pickup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_to_pickup(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Friend requests: at most 10 an hour, 20 unanswered at once, and none to someone who declined you in
-- the last 7 days. Completing a friendship the other player started is never limited. The hourly count
-- reads the friend_request notifications the function itself writes.
-- ---------------------------------------------------------------------------------------------
create index if not exists notifications_actor_kind_idx on public.notifications (actor_id, kind, created_at desc);

create or replace function public.send_friend_request(p_addressee uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_profile();
begin
  if p_addressee = v_uid then
    raise exception 'cannot_friend_self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_addressee) then
    raise exception 'unknown_player' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.friendships where requester_id = v_uid and addressee_id = p_addressee) then
    raise exception 'already_requested' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.friendships where requester_id = p_addressee and addressee_id = v_uid) then
    if exists (select 1 from public.notifications
               where recipient_id = v_uid and actor_id = p_addressee and kind = 'friend_rejected'
                 and created_at > now() - interval '7 days') then
      raise exception 'request_declined_recently' using errcode = 'P0001';
    end if;
    if (select count(*) from public.notifications
        where actor_id = v_uid and kind = 'friend_request' and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'friend_request_limit' using errcode = 'P0001';
    end if;
    if (select count(*) from public.friendships f
        where f.requester_id = v_uid
          and not exists (select 1 from public.friendships r where r.requester_id = f.addressee_id and r.addressee_id = v_uid)) >= 20 then
      raise exception 'too_many_pending_requests' using errcode = 'P0001';
    end if;
  end if;
  insert into public.friendships (requester_id, addressee_id) values (v_uid, p_addressee);
  if exists (select 1 from public.friendships where requester_id = p_addressee and addressee_id = v_uid) then
    perform public.notify(p_addressee, 'friend_accepted', v_uid, null);
    return 'friends';
  end if;
  perform public.notify(p_addressee, 'friend_request', v_uid, null);
  return 'pending_out';
end $$;
revoke all on function public.send_friend_request(uuid) from public, anon, authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- A player can be deleted (audit P1: pickups_organiser_id_fkey refused it). Their finished games stay
-- in everyone else's record with an empty organiser; their open or running pickups are cancelled first
-- and the players told. An organiser-less pickup can only be cancelled or closed.
-- ---------------------------------------------------------------------------------------------
alter table public.pickups alter column organiser_id drop not null;
alter table public.pickups drop constraint pickups_organiser_id_fkey;
alter table public.pickups add constraint pickups_organiser_id_fkey
  foreign key (organiser_id) references public.profiles (id) on delete set null;
alter table public.pickups add constraint pickups_organiser_or_finished
  check (organiser_id is not null or status in ('cancelled', 'closed'));

create or replace function public.before_profile_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id from public.pickups
           where organiser_id = old.id and status in ('open', 'in_progress') for update loop
    update public.pickups set status = 'cancelled' where id = r.id;
    insert into public.notifications (recipient_id, kind, pickup_id)
    select a.player_id, 'cancelled', r.id from public.pickup_attendees a
    where a.pickup_id = r.id and a.player_id <> old.id;
    insert into public.event_log (actor_id, kind, pickup_id, payload)
    values (old.id, 'PICKUP_CANCELLED', r.id, jsonb_build_object('reason', 'organiser_deleted'));
  end loop;
  return old;
end $$;
revoke all on function public.before_profile_delete() from public, anon, authenticated;
create trigger profiles_before_delete before delete on public.profiles
  for each row execute function public.before_profile_delete();

-- The remaining organiser-only functions, unchanged but for `is distinct from` (an empty organiser must
-- never match: `null <> uid` is null, and plpgsql reads that as false).
create or replace function public.cancel_pickup(p_pickup_id uuid)
returns public.pickups
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_profile();
  v_p   public.pickups;
  r     record;
begin
  select * into v_p from public.pickups where id = p_pickup_id for update;
  if not found then
    raise exception 'unknown_pickup' using errcode = 'P0002';
  end if;
  if v_p.organiser_id is distinct from v_uid then
    raise exception 'not_organiser' using errcode = '42501';
  end if;
  if v_p.status not in ('open', 'in_progress') then
    raise exception 'pickup_not_open' using errcode = 'P0001';
  end if;
  update public.pickups set status = 'cancelled' where id = p_pickup_id returning * into v_p;
  for r in select player_id from public.pickup_attendees where pickup_id = p_pickup_id and player_id <> v_uid loop
    perform public.notify(r.player_id, 'cancelled', v_uid, p_pickup_id);
  end loop;
  perform public.log_event('PICKUP_CANCELLED', p_pickup_id, null);
  return v_p;
end $$;
revoke all on function public.cancel_pickup(uuid) from public, anon, authenticated;
grant execute on function public.cancel_pickup(uuid) to authenticated;

create or replace function public.cancel_invitation(p_pickup_id uuid, p_player_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_profile();
  v_p   public.pickups;
begin
  select * into v_p from public.pickups where id = p_pickup_id for update;
  if not found then
    raise exception 'unknown_pickup' using errcode = 'P0002';
  end if;
  if v_p.organiser_id is distinct from v_uid then
    raise exception 'not_organiser' using errcode = '42501';
  end if;
  delete from public.pickup_attendees
  where pickup_id = p_pickup_id and player_id = p_player_id and status = 'invited';
  if not found then
    raise exception 'no_invitation' using errcode = 'P0002';
  end if;
  perform public.log_event('INVITATION_CANCELLED', p_pickup_id, jsonb_build_object('player_id', p_player_id));
end $$;
revoke all on function public.cancel_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_invitation(uuid, uuid) to authenticated;

create or replace function public.record_result(
  p_pickup_id uuid, p_team1 uuid[], p_team2 uuid[],
  p_team1_scores integer[], p_team2_scores integer[], p_winning_team integer)
returns public.pickups
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_profile();
  v_p   public.pickups;
  v_members uuid[] := array_cat(p_team1, p_team2);
  v_n   integer;
  r     record;
begin
  select * into v_p from public.pickups where id = p_pickup_id for update;
  if not found then
    raise exception 'unknown_pickup' using errcode = 'P0002';
  end if;
  if v_p.organiser_id is distinct from v_uid then
    raise exception 'not_organiser' using errcode = '42501';
  end if;
  if v_p.status = 'open' and v_p.starts_at <= now() then
    update public.pickups set status = 'in_progress' where id = p_pickup_id;
    v_p.status := 'in_progress';
  end if;
  if v_p.status <> 'in_progress' then
    raise exception 'pickup_not_in_progress' using errcode = 'P0001';
  end if;
  if p_winning_team is null or p_winning_team not in (1, 2) then
    raise exception 'bad_winner' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_team1, '{}')) < 1 or cardinality(coalesce(p_team2, '{}')) < 1 then
    raise exception 'teams_required' using errcode = '22023';
  end if;
  if cardinality(p_team1_scores) < 1 or cardinality(p_team1_scores) <> cardinality(p_team2_scores) then
    raise exception 'bad_scores' using errcode = '22023', hint = 'One score per set for each team.';
  end if;
  if exists (select 1 from unnest(array_cat(p_team1_scores, p_team2_scores)) s where s is null or s < 0 or s > 99) then
    raise exception 'bad_scores' using errcode = '22023';
  end if;
  select count(distinct m) into v_n from unnest(v_members) m;
  if v_n <> cardinality(v_members) then
    raise exception 'player_in_both_teams' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_members) m
    where not exists (select 1 from public.pickup_attendees a
                      where a.pickup_id = p_pickup_id and a.player_id = m and a.status in ('owner', 'joined'))
  ) then
    raise exception 'member_not_attendee' using errcode = '22023';
  end if;

  insert into public.pickup_teams (pickup_id, team_no, set_scores)
  values (p_pickup_id, 1, p_team1_scores), (p_pickup_id, 2, p_team2_scores);
  update public.pickup_attendees set team_no = 1 where pickup_id = p_pickup_id and player_id = any (p_team1);
  update public.pickup_attendees set team_no = 2 where pickup_id = p_pickup_id and player_id = any (p_team2);
  delete from public.pickup_attendees where pickup_id = p_pickup_id and status = 'invited';
  update public.pickups set status = 'closed', ends_at = now(), winning_team_no = p_winning_team
  where id = p_pickup_id returning * into v_p;

  for r in select player_id from public.pickup_attendees where pickup_id = p_pickup_id and status in ('owner', 'joined') loop
    insert into public.notifications (recipient_id, kind, actor_id, pickup_id) values (r.player_id, 'vote_mvp', v_uid, p_pickup_id);
  end loop;
  perform public.log_event('RESULT_RECORDED', p_pickup_id,
    jsonb_build_object('team1', p_team1, 'team2', p_team2, 'scores', jsonb_build_array(p_team1_scores, p_team2_scores), 'winner', p_winning_team));
  return v_p;
end $$;
revoke all on function public.record_result(uuid, uuid[], uuid[], integer[], integer[], integer) from public, anon, authenticated;
grant execute on function public.record_result(uuid, uuid[], uuid[], integer[], integer[], integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Standing (provisional formula unchanged: 2 per win, 3 per MVP). A game counts when its result came at
-- least 20 minutes after its start, and a player has at most 3 counted games per Los Angeles day; an MVP
-- counts only on a counted game (audit P2: three sock puppets farmed 10 wins + 10 MVPs in 31 ms).
-- Readable by signed-in players only: anon had select through Supabase's default privileges.
-- ---------------------------------------------------------------------------------------------
create or replace view public.player_standing as
with played as (
  select a.player_id, p.id as pickup_id, p.starts_at, p.winning_team_no, p.mvp_id, a.team_no,
         (p.starts_at at time zone 'America/Los_Angeles')::date as la_day
  from public.pickup_attendees a
  join public.pickups p on p.id = a.pickup_id
  where a.status in ('owner', 'joined')
    and p.status = 'closed' and p.winning_team_no is not null
    and p.ends_at >= p.starts_at + interval '20 minutes'
), counted as (
  select * from (
    select played.*, row_number() over (partition by player_id, la_day order by starts_at, pickup_id) as nth
    from played
  ) ranked
  where nth <= 3
), games as (
  select player_id,
         count(*)                                      as games,
         count(*) filter (where team_no = winning_team_no) as wins,
         count(*) filter (where mvp_id = player_id)    as mvps
  from counted
  group by player_id
)
select pr.id as player_id, pr.username, pr.display_name, pr.skill,
       coalesce(g.games, 0)::int as games, coalesce(g.wins, 0)::int as wins, coalesce(g.mvps, 0)::int as mvps,
       (coalesce(g.wins, 0) * 2 + coalesce(g.mvps, 0) * 3)::int as goat_score
from public.profiles pr
left join games g on g.player_id = pr.id;
revoke all on public.player_standing from anon, authenticated;
grant select on public.player_standing to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The measure of real use (FOUNDATION §8, Phase 5: "used weekly by people who are not the owner").
-- Owner-only: schema `metrics` is not exposed by the API and grants nothing to anon or authenticated.
-- Read in the SQL editor:  select * from metrics.usage_weekly;  select * from metrics.phase5_gate;
-- A real game: a pickup that started in that Los Angeles week (Monday first), was not cancelled, and
-- had at least 2 players who are neither in metrics.exclusions (the owner, testers) nor proof accounts
-- (anyone on a pickup whose note starts 'two-browsers ', the note test/e2e/two-browsers.cjs writes).
-- ---------------------------------------------------------------------------------------------
create schema if not exists metrics;
revoke all on schema metrics from public;
comment on schema metrics is 'Owner-only measures (0006). Not exposed by the API; read in the SQL editor.';

create table metrics.exclusions (
  player_id  uuid primary key,
  reason     text not null default 'owner',
  created_at timestamptz not null default now()
);
alter table metrics.exclusions enable row level security;
comment on table metrics.exclusions is
  'Players whose activity is not real use. Add yourself: insert into metrics.exclusions (player_id, reason) select id, ''owner'' from public.profiles where username = ''<your username>'';';

create or replace view metrics.excluded_players as
select player_id from metrics.exclusions
union
select a.player_id
from public.pickup_attendees a
join public.pickups p on p.id = a.pickup_id
where p.note like 'two-browsers %';

create or replace view metrics.usage_weekly as
with weeks as (
  select w::date as week
  from generate_series(date_trunc('week', now() at time zone 'America/Los_Angeles') - interval '11 weeks',
                       date_trunc('week', now() at time zone 'America/Los_Angeles'),
                       interval '1 week') w
), game_players as (
  select p.id as pickup_id, p.winning_team_no, a.player_id,
         date_trunc('week', p.starts_at at time zone 'America/Los_Angeles')::date as week
  from public.pickups p
  join public.pickup_attendees a on a.pickup_id = p.id and a.status in ('owner', 'joined')
  where p.status <> 'cancelled' and p.starts_at <= now()
    and not exists (select 1 from metrics.excluded_players x where x.player_id = a.player_id)
), real_games as (
  select pickup_id, week, bool_or(winning_team_no is not null) as has_result
  from game_players
  group by pickup_id, week
  having count(*) >= 2
), reports as (
  select date_trunc('week', r.created_at at time zone 'America/Los_Angeles')::date as week, r.reporter_id
  from public.court_reports r
  where not exists (select 1 from metrics.excluded_players x where x.player_id = r.reporter_id)
), created as (
  select date_trunc('week', p.created_at at time zone 'America/Los_Angeles')::date as week
  from public.pickups p
  where p.organiser_id is null
     or not exists (select 1 from metrics.excluded_players x where x.player_id = p.organiser_id)
)
select w.week,
       w.week = date_trunc('week', now() at time zone 'America/Los_Angeles')::date                       as partial,
       (select count(*) from real_games g where g.week = w.week)::int                                   as real_games,
       (select count(distinct gp.player_id) from game_players gp
          join real_games g on g.pickup_id = gp.pickup_id where g.week = w.week)::int                    as players_in_real_games,
       (select count(*) from real_games g where g.week = w.week and g.has_result)::int                  as real_games_with_result,
       (select count(distinct r.reporter_id) from reports r where r.week = w.week)::int                  as reporters,
       (select count(*) from reports r where r.week = w.week)::int                                       as reports,
       (select count(*) from created c where c.week = w.week)::int                                       as pickups_created
from weeks w
order by w.week desc;
comment on view metrics.usage_weekly is 'Real use per Los Angeles week (Monday first), the newest first; partial = the week in progress.';

create or replace view metrics.phase5_gate as
select count(*) filter (where real_games >= 1)::int       as weeks_with_real_games,
       (count(*) filter (where real_games >= 1) = 4)       as gate_met,
       min(week)                                           as from_week,
       max(week)                                           as to_week
from (select week, real_games from metrics.usage_weekly where not partial order by week desc limit 4) last4;
comment on view metrics.phase5_gate is 'FOUNDATION §8 Phase 5 gate: met when each of the last 4 complete weeks had at least one real game.';

revoke all on all tables in schema metrics from public, anon, authenticated;
