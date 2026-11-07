-- Audit probes (2026-11-07, working/2026-11-07-audit.md). THROWAWAY DATABASE ONLY: needs the test shim's
-- test.login(), so it cannot run against the real project. Each probe uses only what a browser holding the
-- public anon key can do (anonymous sessions and the RPCs), catches refusals and reports what got through,
-- so the same file reads the schema before and after a rule lands.
--
--   out=$(KEEP=1 bash test/backend/run.sh | grep '^KEEP'); eval "$(echo "$out" | sed 's/^KEEP //; s/ /\n/g' | sed 's/^/export /')"
--   psql -h "$PGHOST" -p "$PGPORT" -U postgres -d opencourt_test -X -q -f working/2026-11-07-audit-probes.sql 2>&1 | grep RESULT
--   runuser -u ubuntu -- "$PGBIN/pg_ctl" -D "$PGDATA" stop -m immediate; rm -rf "$WORK"     # (as root; else pg_ctl stop)
--
-- Results: see the table in working/2026-11-07-limits-usage-next-tier.md (migrations 0001–0005 at bb15634,
-- then with 0006). The first audit run (P1–P5 before 0006) is quoted in working/2026-11-07-audit.md.
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
    raise notice 'P1 RESULT: user deleted';
  exception when others then
    raise notice 'P1 RESULT: delete of auth user refused: % (%)', sqlerrm, sqlstate;
  end;
end $$;

-- ---------- P2: standing farm — one person, three anonymous sock puppets, ten instant "games" ----------
do $$
declare
  f uuid := 'aaaaaaaa-0000-0000-0000-00000000f000';
  s uuid[] := array['aaaaaaaa-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-00000000f002','aaaaaaaa-0000-0000-0000-00000000f003']::uuid[];
  i int; j int; pid uuid; made int := 0; t0 timestamptz := clock_timestamp();
begin
  perform test.login(f, true);  perform public.upsert_profile('farmer', 'Farmer');
  for j in 1..3 loop perform test.login(s[j], true); perform public.upsert_profile('sock' || j, 'Sock ' || j); end loop;
  for i in 1..10 loop
    begin
      perform test.login(f, true);
      pid := (public.create_pickup('memorial-park-sm', 'tennis', now() - interval '1 minute', 4, 'farm')).id;
      for j in 1..3 loop perform test.login(s[j], true); perform public.join_pickup(pid); end loop;
      perform test.login(f, true);
      perform public.record_result(pid, array[f, s[1]], array[s[2], s[3]], array[6], array[0], 1);
      perform public.vote_mvp(pid, s[1]);
      for j in 1..3 loop perform test.login(s[j], true); perform public.vote_mvp(pid, f); end loop;
      made := made + 1;
    exception when others then null;
    end;
  end loop;
  perform test.admin();
  raise notice 'P2 RESULT: % games recorded in % ms; farmer standing: %', made, round(extract(epoch from clock_timestamp() - t0) * 1000),
    (select row_to_json(x) from (select games, wins, mvps, goat_score from public.player_standing where player_id = f) x);
end $$;

-- ---------- P3: a stranger fans out friend requests and invitations to every profile ----------
do $$
declare x uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; pid uuid; r record; n_before int; n_after int; k int := 0; q int := 0;
begin
  perform test.admin(); select count(*) into n_before from public.notifications;
  perform test.login(x, true); perform public.upsert_profile('stranger', 'Stranger');
  pid := (public.create_pickup('memorial-park-sm', 'tennis', now() + interval '2 hours', 30, 'spam')).id;
  for r in select id from public.profiles where id <> x loop
    begin perform public.send_friend_request(r.id); q := q + 1; exception when others then null; end;
    begin perform public.invite_to_pickup(pid, r.id); k := k + 1; exception when others then null; end;
  end loop;
  perform test.admin(); select count(*) into n_after from public.notifications;
  raise notice 'P3 RESULT: to % profiles, none of them friends: % friend requests and % invitations got through (% notifications)',
    (select count(*) - 1 from public.profiles), q, k, n_after - n_before;
end $$;

-- ---------- P4: one session floods a court with pickups ----------
do $$
declare x uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; i int; made int := 0;
begin
  perform test.login(x, true);
  for i in 1..50 loop
    begin perform public.create_pickup('griffith-riverside', 'tennis', now() + (i || ' minutes')::interval, 2); made := made + 1;
    exception when others then null; end;
  end loop;
  perform test.admin();
  raise notice 'P4 RESULT: % of 50 pickups created; courts_live.open_pickup_count on griffith-riverside = %', made,
    (select open_pickup_count from public.courts_live where id = 'griffith-riverside');
end $$;

-- ---------- P5: how many fresh anonymous sessions does it take to mark every public court Full? ----------
-- Each new session starts where the last stopped, so no court is reported twice.
do $$
declare
  courts text[] := array(select id from public.courts where tier <> 'private' order by id);
  n int := cardinality(courts); i int := 0; c int := 1; ok boolean;
begin
  while c <= n and i < 30 loop
    i := i + 1;
    perform test.login(('aaaaaaaa-0000-0000-0000-0000000005' || lpad(i::text, 2, '0'))::uuid, true);
    ok := true;
    while ok and c <= n loop
      begin perform public.submit_report(courts[c], 'full'); c := c + 1;
      exception when others then ok := false; end;
    end loop;
  end loop;
  perform test.admin();
  raise notice 'P5 RESULT: % anonymous sessions marked % of % public courts Full', i,
    (select count(*) from public.courts_live where tier <> 'private' and last_reported_availability->>'status' = 'full'), n;
end $$;
