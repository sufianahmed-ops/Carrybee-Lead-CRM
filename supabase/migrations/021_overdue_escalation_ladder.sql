-- 021_overdue_escalation_ladder.sql — overdue >2d escalation to Lead/Admin with 24h dedup

insert into app_settings(key,value) values
  ('ESCALATION_ENABLED','true'),
  ('ESCALATION_OVERDUE_DAYS','2'),
  ('ESCALATION_MIN_COUNT','5'),
  ('ESCALATION_DEDUP_HOURS','24')
on conflict (key) do nothing;

create table if not exists public.escalation_tracker (
  member_id uuid primary key references public.team_members(id) on delete cascade,
  last_escalated_at timestamptz not null,
  last_overdue_count int not null,
  updated_at timestamptz not null default now()
);
alter table public.escalation_tracker enable row level security;
drop policy if exists escalation_tracker_select on public.escalation_tracker;
create policy escalation_tracker_select on public.escalation_tracker for select to authenticated using (true);

create or replace function public.check_overdue_escalations()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enabled boolean;
  v_days int;
  v_min int;
  v_dedup int;
  v_cutoff_date date;
  r record;
  v_managers uuid[];
  v_notified int := 0;
  v_result jsonb := '[]'::jsonb;
  v_title text;
  v_body text;
begin
  select (value ilike 'true' or value='1') into v_enabled from app_settings where key='ESCALATION_ENABLED';
  if v_enabled is null then v_enabled := true; end if;
  if not v_enabled then return jsonb_build_object('ok', true, 'action','disabled'); end if;

  select coalesce(nullif(value,'')::int,2) into v_days from app_settings where key='ESCALATION_OVERDUE_DAYS';
  select coalesce(nullif(value,'')::int,5) into v_min from app_settings where key='ESCALATION_MIN_COUNT';
  select coalesce(nullif(value,'')::int,24) into v_dedup from app_settings where key='ESCALATION_DEDUP_HOURS';
  v_cutoff_date := crm_today() - v_days;

  select array_agg(id) into v_managers from team_members where active and (is_main_admin or role ilike '%admin%' or role ilike '%lead%');
  if v_managers is null then v_managers := '{}'; end if;

  for r in
    select tm.id as member_id, tm.name as member_name, count(*)::int as overdue_cnt
    from team_members tm
    join lead_list_snapshot s on s.current_owner = tm.name
    where s.due_state='Overdue'
      and s.next_due_date <= v_cutoff_date
      and s.is_final='No'
      and tm.active
    group by tm.id, tm.name
    having count(*) >= v_min
  loop
    if exists (select 1 from escalation_tracker et where et.member_id=r.member_id and et.last_escalated_at > now() - (v_dedup || ' hours')::interval) then
      continue;
    end if;
    v_title := 'Escalation: ' || r.member_name || ' has ' || r.overdue_cnt || ' leads overdue >' || v_days || 'd';
    v_body := r.member_name || ' has ' || r.overdue_cnt || ' leads with next_due_date ≤ ' || v_cutoff_date || ' (overdue >' || v_days || ' days). '
              || 'Check Old book / Follow Up, stage=' || (select coalesce(stage,'LQT') from team_members where id=r.member_id) || '. Auto-assigned today: '
              || (select count(*) from leads where assigned_to=r.member_id and assign_date=crm_today()) || '. Consider lending help or re-assigning.';

    insert into notifications(member_id, kind, title, body, lead_ref)
    select unnest(v_managers), 'overdue_escalate', v_title, v_body, null;

    if not (r.member_id = any(v_managers)) then
      insert into notifications(member_id, kind, title, body)
      values (r.member_id, 'overdue_nudge', 'You have ' || r.overdue_cnt || ' leads overdue >' || v_days || 'd',
              'Your overdue >' || v_days || 'd count is ' || r.overdue_cnt || '. Please clear Follow Up / CNR, or ask Lead to lend help.');
    end if;

    insert into escalation_tracker(member_id, last_escalated_at, last_overdue_count, updated_at)
    values (r.member_id, now(), r.overdue_cnt, now())
    on conflict (member_id) do update set last_escalated_at=excluded.last_escalated_at, last_overdue_count=excluded.last_overdue_count, updated_at=now();

    v_notified := v_notified + 1;
    v_result := v_result || jsonb_build_object('member', r.member_name, 'overdue', r.overdue_cnt);
  end loop;
  return jsonb_build_object('ok', true, 'checked', (select count(*) from team_members where active), 'escalated_agents', v_notified, 'details', v_result, 'cutoff', v_cutoff_date, 'min', v_min);
end
$function$;

grant execute on function public.check_overdue_escalations() to authenticated, service_role;
