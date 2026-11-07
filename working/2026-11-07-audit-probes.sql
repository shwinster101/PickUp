-- Audit probes (2026-11-07, working/2026-11-07-audit.md). THROWAWAY DATABASE ONLY: needs the test shim's
-- test.login(), so it cannot run against the real project. Each probe uses only what a browser holding the
-- public anon key can do: anonymous sessions and the RPCs. When a rule closes a gap, its probe flips.
--
--   out=$(KEEP=1 bash test/backend/run.sh | grep '^KEEP'); eval "$(echo "$out" | sed 's/^KEEP //; s/ /\n/g' | sed 's/^/export /')"
--   psql -h "$PGHOST" -p "$PGPORT" -U postgres -d opencourt_test -X -q -f working/2026-11-07-audit-probes.sql 2>&1 | grep RESULT
--   runuser -u ubuntu -- "$PGBIN/pg_ctl" -D "$PGDATA" stop -m immediate; rm -rf "$WORK"     # (as root; else pg_ctl stop)
--
-- Results on 2026-11-07 (PostgreSQL 16, migrations 0001–0005 + seed at bb15634):
--   P1 delete of auth user refused: ... violates foreign key constraint "pickups_organiser_id_fkey" (23503)
--   P2 farmer standing after 31 ms: {"games":10,"wins":10,"mvps":10,"goat_score":50}
--   P3 one anonymous stranger created 10 notifications (5 invitations) to 5 profiles, none of them friends
--   P4 courts_live.open_pickup_count on griffith-riverside = 50
--   P5 180 reports accepted; public courts whose live status now reads full: 18 of 18
\set ON_ERROR_STOP on
\pset footer off

-- ---------- P1: can the owner delete a user who ever organised a pickup? ----------
begin;
select test.login('aaaaaaaa-0000-0000-0000-00000000d001'::uuid, true);
select public.upsert_profile('del_me', 'Delete Me');
select (public.create_pickup('memorial-park-sm', 'tennis', now() + interval '1 hour', 4)).id is not null as p1_pickup_created;
commit;
do $$ begin
  begin
    delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-00000000d001';
    raise notice 'P1 RESULT: user deleted (no FK block)';
  exception when others then
    raise notice 'P1 RESULT: delete of auth user refused: % (%)', sqlerrm, sqlstate;
  end;
end $$;

-- ---------- P2: standing farm — one person, three anonymous sock puppets, ten "games" ----------
do $$
declare
  f uuid := 'aaaaaaaa-0000-0000-0000-00000000f000';
  s uuid[] := array['aaaaaaaa-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-00000000f002','aaaaaaaa-0000-0000-0000-00000000f003']::uuid[];
  i int; j int; pid uuid; t0 timestamptz := clock_timestamp();
begin
  perform test.login(f, true);  perform public.upsert_profile('farmer', 'Farmer');
  for j in 1..3 loop perform test.login(s[j], true); perform public.upsert_profile('sock' || j, 'Sock ' || j); end loop;
  for i in 1..10 loop
    perform test.login(f, true);
    pid := (public.create_pickup('memorial-park-sm', 'tennis', now() - interval '1 minute', 4, 'farm')).id;
    for j in 1..3 loop perform test.login(s[j], true); perform public.join_pickup(pid); end loop;
    perform test.login(f, true);
    perform public.record_result(pid, array[f, s[1]], array[s[2], s[3]], array[6], array[0], 1);
    perform public.vote_mvp(pid, s[1]);
    for j in 1..3 loop perform test.login(s[j], true); perform public.vote_mvp(pid, f); end loop;
  end loop;
  perform test.admin();
  raise notice 'P2 RESULT: farmer standing after % ms: %', round(extract(epoch from clock_timestamp() - t0) * 1000),
    (select row_to_json(x) from (select games, wins, mvps, goat_score from public.player_standing where player_id = f) x);
end $$;

-- ---------- P3: a stranger fans out friend requests and invitations to every profile ----------
do $$
declare x uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; pid uuid; r record; n_before int; n_after int; k int := 0;
begin
  perform test.admin(); select count(*) into n_before from public.notifications;
  perform test.login(x, true); perform public.upsert_profile('stranger', 'Stranger');
  pid := (public.create_pickup('memorial-park-sm', 'tennis', now() + interval '2 hours', 30, 'spam')).id;
  for r in select id from public.profiles where id <> x loop
    perform public.send_friend_request(r.id);
    begin perform public.invite_to_pickup(pid, r.id); k := k + 1; exception when others then null; end;
  end loop;
  perform test.admin(); select count(*) into n_after from public.notifications;
  raise notice 'P3 RESULT: one anonymous stranger created % notifications (% invitations) to % profiles, none of them friends',
    n_after - n_before, k, (select count(*) - 1 from public.profiles);
end $$;

-- ---------- P4: one session floods a court with pickups ----------
do $$
declare x uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; i int;
begin
  perform test.login(x, true);
  for i in 1..50 loop perform public.create_pickup('griffith-riverside', 'tennis', now() + (i || ' minutes')::interval, 2); end loop;
  perform test.admin();
  raise notice 'P4 RESULT: courts_live.open_pickup_count on griffith-riverside = %',
    (select open_pickup_count from public.courts_live where id = 'griffith-riverside');
end $$;

-- ---------- P5: ten fresh anonymous sessions mark every public court Full ----------
do $$
declare i int; c record; n int := 0;
begin
  for i in 1..10 loop
    perform test.login(('aaaaaaaa-0000-0000-0000-0000000005' || lpad(i::text, 2, '0'))::uuid, true);
    for c in select id from public.courts where tier <> 'private' loop
      begin perform public.submit_report(c.id, 'full'); n := n + 1; exception when others then null; end;
    end loop;
  end loop;
  perform test.admin();
  raise notice 'P5 RESULT: % reports accepted; public courts whose live status now reads full: % of %', n,
    (select count(*) from public.courts_live where tier <> 'private' and last_reported_availability->>'status' = 'full'),
    (select count(*) from public.courts_live where tier <> 'private');
end $$;
