-- Phase 2 — October-scoped round robin, move off Sazzad, CNR reset, daily cap.
--
-- Design rules agreed with management:
--   * the cutover lives on `assign_date`: leads assigned on/after 1 Nov 2026 stay
--     where they are permanently, whatever their registration date.
--   * option (a): only old book leads *worked in October* are movable.
--   * new (LQT) leads are never touched by Phase 2 — new work outranks old debt.
--   * every function is dry-run first: p_dry_run => true (the default) writes nothing.
--
-- These functions never touch the row-level `leads` update path used by the CRM
-- editor, so they skip the statement-timeout pressure of the live view.

-- 1 ── settings the view and later phases read -------------------------------
insert into public.app_settings(key, value)
values ('CNR_RESET_FROM', '2026-11-15')
on conflict (key) do update set value = excluded.value;

insert into public.app_settings(key, value)
values ('DAILY_ASSIGN_CAP', '0')   -- 0 = no cap yet (Phase 3 turns this on: 25–30)
on conflict (key) do nothing;

-- 2 ── CNR reset awareness in the live view --------------------------------
-- cnr_count is what drives "Silent Leads"; a reset means only CNR attempts made
-- on/after CNR_RESET_FROM count. Rewrite the view definition surgically so any
-- other logic in it is preserved exactly.
do $$
declare
  def   text;
  n     int;
  pk    text := 'public.lead_details';
begin
  select pg_get_viewdef('public.lead_details'::regclass, false) into def;
  select (select coalesce((select value from public.app_settings where key='CNR_RESET_FROM'),'1900-01-01'))::date into strict n from (select 1) x;
  -- only patch the CNR counter; skip if already patched
  if position($t$(cl.status = 'CNR'::text) AND (cl.call_time >= $t$ in def) = 0 then
    execute 'create or replace view ' || pk || ' as ' || replace(
      def,
      $a$(count(*) FILTER (WHERE (cl.status = 'CNR'::text)))::integer AS cnr_count$a$,
      $b$(count(*) FILTER (WHERE (cl.status = 'CNR'::text) AND (cl.call_time >= $c$ || quote_literal(n::text) || $d$::timestamptz)))::integer AS cnr_count$b$
    );
  end if;
end $$;

-- 3 ── who is movable -------------------------------------------------------
create or replace function public.phase2_candidates(p_agent uuid default null, p_limit int default 200)
returns table (
  id uuid, lead_id text, business_name text, phone_clean text,
  assigned_to uuid, owner text, assign_date date, registration_date date,
  last_call_date date, cnr_count int, tab text
)
language sql stable security definer set search_path = public as $$
  select s.id, s.lead_id, s.business_name, s.phone_clean,
         s.assigned_to, s.assigned_to_name, s.assign_date, s.registration_date,
         s.last_call_date, s.cnr_count, s.tab
  from public.lead_list_snapshot s
  where s.is_final = 'No'
    and s.lead_generation = 'Old'
    and s.stage = 'LQT'
    and s.last_call_date between date '2026-10-01' and date '2026-10-31'   -- option (a)
    and coalesce(s.assign_date, date '1900-01-01') < date '2026-11-01'      -- cutover
    and s.assigned_to is not null
    and (p_agent is null or s.assigned_to = p_agent)
  order by s.last_call_date, s.id
  limit greatest(least(coalesce(p_limit, 200), 5000), 0);   -- 5000 keeps PostgREST-free
                                                          -- callers honest; dashboard reads use 1000
$$;

-- 4 ── the October-scoped round robin --------------------------------------
create or replace function public.phase2_round_robin(
  p jsonb,
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me public.team_members%rowtype;
  agents uuid[];
  agent_count int;
  cap int := coalesce((p->>'dailyCap')::int, 0);
  moved_today int := 0;
  l record;
  target public.team_members%rowtype;
  seq int := 0;
  planned int := 0;
  preview jsonb := '[]'::jsonb;
  assigned_ids uuid[] := '{}';
begin
  select * into me from public.team_members
  where auth_user_id = auth.uid() and active and role ~* 'lead|admin';
  if me.id is null then raise exception 'Only a Team Lead or Admin can run the Phase 2 round robin.'; end if;

  select array_agg(x::uuid order by ord) into agents
  from jsonb_array_elements_text(coalesce(p->'agentIds','[]'::jsonb)) with ordinality t(x, ord);
  if agents is null or cardinality(agents) = 0 then raise exception 'Choose at least one LQT agent.'; end if;
  if cardinality(agents) <> cardinality(array(select distinct unnest(agents))) then
    raise exception 'Choose each LQT agent only once.';
  end if;
  if exists (
    select 1 from unnest(agents) ids(id) left join public.team_members tm on tm.id = ids.id
    where tm.id is null or not tm.active or tm.team <> 'LQT'
  ) then raise exception 'The Phase 2 round robin is for active LQT agents only.'; end if;
  agent_count := cardinality(agents);

  if cap > 0 then
    select count(*) into moved_today from public.call_logs
    where event_type = 'Reassign' and (call_time at time zone 'Asia/Dhaka')::date = crm_today()
      and note like 'Phase 2 round robin%';
    if moved_today >= cap then
      return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'moved', 0,
        'skipped_cap', true, 'cap', cap, 'already_today', moved_today, 'plan', '[]'::jsonb);
    end if;
  end if;

  for l in
    select * from public.phase2_candidates(null, 100000)
     where id = any (select jsonb_array_elements_text(coalesce(p->'leadIds','[]'::jsonb))::uuid)
     order by last_call_date, id
  loop
    seq := seq + 1;
    target := null;
    select * into target from public.team_members where id = agents[((seq-1) % agent_count) + 1];
    planned := planned + 1;
    if jsonb_array_length(preview) < 50 then
      preview := preview || jsonb_build_object(
        'lead_id', l.lead_id, 'business', l.business_name, 'from', l.owner,
        'to', target.name, 'rotation_pos', ((seq-1) % agent_count) + 1,
        'last_call', l.last_call_date, 'cnr', l.cnr_count);
    end if;
    if not p_dry_run then
      update public.leads
         set assigned_to = target.id, assign_date = crm_today(),
             last_updated = now(), last_updated_by = me.id
       where id = l.id;
      insert into public.call_logs(lead_id, phone, agent_id, agent_name, team, event_type, note)
      values (l.id, l.phone_clean, me.id, me.name, me.team, 'Reassign',
              'Phase 2 round robin: ' || coalesce(l.owner,'(none)') || ' → ' || target.name);
      assigned_ids := assigned_ids || l.id;
    end if;
    if cap > 0 and not p_dry_run and (moved_today + planned) >= cap then exit; end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'moved', planned, 'agents', agent_count,
    'cap', cap, 'already_today', moved_today, 'preview', preview);
end $$;

-- 5 ── move every remaining lead off one owner (Sazzad) --------------------
create or replace function public.phase2_move_off(
  p_from uuid,
  p jsonb,
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me public.team_members%rowtype;
  agents uuid[]; agent_count int; seq int := 0; planned int := 0; found int := 0;
  target public.team_members%rowtype; l record; preview jsonb := '[]'::jsonb;
  from_name text;
begin
  select * into me from public.team_members
  where auth_user_id = auth.uid() and active and role ~* 'lead|admin';
  if me.id is null then raise exception 'Only a Team Lead or Admin can move leads.'; end if;
  select name into from_name from public.team_members where id = p_from;
  if from_name is null then raise exception 'The source owner was not found.'; end if;

  select array_agg(x::uuid order by ord) into agents
  from jsonb_array_elements_text(coalesce(p->'agentIds','[]'::jsonb)) with ordinality t(x, ord);
  if agents is null or cardinality(agents) = 0 then raise exception 'Choose at least one LQT agent.'; end if;
  if exists (
    select 1 from unnest(agents) ids(id) left join public.team_members tm on tm.id = ids.id
    where tm.id is null or not tm.active or tm.team <> 'LQT'
  ) then raise exception 'Destination agents must be active LQT agents.'; end if;
  agent_count := cardinality(agents);

  for l in
    select s.id, s.lead_id, s.business_name, s.phone_clean, s.last_call_date
    from public.lead_list_snapshot s
    where s.is_final = 'No' and s.assigned_to = p_from
      and coalesce(s.assign_date, date '1900-01-01') < date '2026-11-01'
    order by s.last_call_date nulls last, s.id
  loop
    found := found + 1;
    seq := seq + 1;
    target := null;
    select * into target from public.team_members where id = agents[((seq-1) % agent_count) + 1];
    planned := planned + 1;
    if jsonb_array_length(preview) < 50 then
      preview := preview || jsonb_build_object('lead_id', l.lead_id, 'business', l.business_name, 'to', target.name);
    end if;
    if not p_dry_run then
      update public.leads
         set assigned_to = target.id, assign_date = crm_today(),
             last_updated = now(), last_updated_by = me.id
       where id = l.id;
      insert into public.call_logs(lead_id, phone, agent_id, agent_name, team, event_type, note)
      values (l.id, l.phone_clean, me.id, me.name, me.team, 'Reassign',
              'Phase 2 move off ' || from_name || ' → ' || target.name);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'from', from_name,
    'found', found, 'moved', planned, 'agents', agent_count, 'preview', preview);
end $$;

-- 6 ── what Phase 2 would do, in one number set ---------------------------
create or replace function public.phase2_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cutover', '2026-11-01',
    'cnr_reset_from', (select coalesce(value,'') from public.app_settings where key='CNR_RESET_FROM'),
    'movable_oct_worked', (select count(*) from public.phase2_candidates(null, 1000000)),
    'protected_assigned_nov', (select count(*) from public.lead_list_snapshot
        where is_final='No' and lead_generation='Old' and assign_date >= date '2026-11-01'),
    'old_open_total', (select count(*) from public.lead_list_snapshot
        where is_final='No' and lead_generation='Old'),
    'by_owner', (select coalesce(jsonb_agg(x order by x->>'old_open' desc),'[]'::jsonb) from (
        select jsonb_build_object('owner', assigned_to_name, 'old_open', count(*),
               'movable', count(*) filter (where last_call_date between date '2026-10-01' and date '2026-10-31'
                                             and coalesce(assign_date, date '1900-01-01') < date '2026-11-01'))
        from public.lead_list_snapshot
        where is_final='No' and lead_generation='Old' and assigned_to is not null
        group by assigned_to_name) t(x))
  );
$$;

revoke all on function public.phase2_candidates(uuid,int) from public, anon;
revoke all on function public.phase2_round_robin(jsonb,boolean) from public, anon;
revoke all on function public.phase2_move_off(uuid,jsonb,boolean) from public, anon;
revoke all on function public.phase2_summary() from public, anon;
grant execute on function public.phase2_candidates(uuid,int) to authenticated;
grant execute on function public.phase2_round_robin(jsonb,boolean) to authenticated;
grant execute on function public.phase2_move_off(uuid,jsonb,boolean) to authenticated;
grant execute on function public.phase2_summary() to authenticated;
