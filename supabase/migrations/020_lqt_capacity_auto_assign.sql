-- 020_lqt_capacity_auto_assign.sql — capacity-aware auto-assign for New Self Registered leads
-- Desk-skew fix: new cutover-bound LQT leads go to the least-loaded LQT agent (received today / open), respecting cap + on_leave + lending.

insert into app_settings(key,value) values
  ('LQT_AUTO_ASSIGN_ENABLED','true'),
  ('LQT_AUTO_ASSIGN_DAILY_CAP','30'),
  ('LQT_CUTOVER_DATE','2026-11-01')
on conflict (key) do nothing;

-- Eligible LQT agents for today's auto-assign: active, not on_leave, work_stage LQT, not admin/lead, not currently lent away.
create or replace function public.lqt_agents()
returns table(member_id uuid, name text, received_today integer, open_leads integer, last_assigned timestamptz)
language sql stable security definer
set search_path to 'public'
as $function$
  select tm.id, tm.name,
         (select count(*)::int from leads l where l.assigned_to = tm.id and l.assign_date = crm_today()),
         (select count(*)::int from lead_list_snapshot s where s.current_owner = tm.name and s.stage='LQT' and s.is_final='No'),
         (select max(l.assign_date::timestamptz) from leads l where l.assigned_to = tm.id)
    from team_members tm
   where tm.active
     and not coalesce(tm.on_leave,false)
     and public.member_work_stage(tm.id) = 'LQT'
     and not coalesce(tm.is_main_admin,false)
     and coalesce(tm.admin_access,false) = false
     and coalesce(tm.role,'') !~* 'admin'
     and not exists (select 1 from member_lendings ml where ml.member_id=tm.id and ml.active and ml.work_stage <> 'LQT')
   order by 3,4,5 nulls first, tm.name;
$function$;

-- Pick one agent under cap, lowest received_today → open_leads tie-breaker.
create or replace function public.lqt_pick(p_cap integer default null)
returns uuid
language sql stable security definer
set search_path to 'public'
as $function$
  select a.member_id from lqt_agents() a
   where a.received_today < coalesce(p_cap, (select nullif(value,'')::int from app_settings where key='LQT_AUTO_ASSIGN_DAILY_CAP'), 30)
   order by a.received_today, a.open_leads, a.last_assigned nulls first, a.name
   limit 1;
$function$;

-- Trigger: before insert on leads, if New Self Registered ≥ cutover and unassigned, auto-route.
create or replace function public.lqt_auto_assign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_enabled boolean;
  v_cap int;
  v_cutover date;
  v_pick uuid;
begin
  if new.assigned_to is not null then return new; end if;
  select (value ilike 'true' or value='1') into v_enabled from app_settings where key='LQT_AUTO_ASSIGN_ENABLED';
  if coalesce(v_enabled,false) = false then return new; end if;
  if new.registration_date is null then return new; end if;
  select nullif(value,'')::date into v_cutover from app_settings where key='LQT_CUTOVER_DATE';
  if v_cutover is null then v_cutover := '2026-11-01'::date; end if;
  if new.registration_date < v_cutover then return new; end if;
  if new.source is not null and new.source <> '' and new.source <> 'Self Registered' then return new; end if;
  select nullif(value,'')::int into v_cap from app_settings where key='LQT_AUTO_ASSIGN_DAILY_CAP';
  v_cap := coalesce(v_cap, 30);
  v_pick := public.lqt_pick(v_cap);
  if v_pick is null then return new; end if;
  new.assigned_to := v_pick;
  new.assign_date := crm_today();
  new.last_updated := now();
  return new;
end
$function$;

drop trigger if exists trg_lqt_auto_assign on public.leads;
create trigger trg_lqt_auto_assign
before insert on public.leads
for each row execute function public.lqt_auto_assign();

grant execute on function public.lqt_agents() to authenticated, service_role;
grant execute on function public.lqt_pick(integer) to authenticated, service_role;
