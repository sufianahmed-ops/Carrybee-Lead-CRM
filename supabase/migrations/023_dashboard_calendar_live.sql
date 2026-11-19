-- 023_dashboard_calendar_live.sql — extend dashboard_stats for calendar range + keep backward compat
create or replace function public.dashboard_stats(p_days integer default 30, p_from date default null, p_to date default null)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with
-- resolve period: if p_from/p_to given, use them; else last p_days from crm_today()
win as (
  select
    coalesce(p_from, crm_today() - (greatest(p_days,1)-1)) as from_day,
    coalesce(p_to, crm_today()) as to_day
),
today as (select crm_today() as d),
daily as (
  select cl.call_time::date as day,
         count(*) filter (where cl.team='LQT')::int lqt,
         count(*) filter (where cl.team='Incubation')::int inc
  from public.call_logs cl, win
  where cl.event_type='Call' and cl.call_time::date >= win.from_day and cl.call_time::date <= win.to_day
  group by 1
),
agg as (
  select agent_id, call_time::date as day, count(*)::int n
  from public.call_logs, today
  where event_type='Call' and call_time::date >= today.d - 29
  group by 1,2
),
owner as (
  select assigned_to,
    count(*) filter (where is_final='No' and lead_generation='New' and stage='LQT')::int new_open,
    count(*) filter (where is_final='No' and lead_generation='Old' and stage='LQT')::int old_open,
    count(*) filter (where is_final='No' and stage<>'LQT')::int inc_open,
    count(*) filter (where is_final='No' and priority=1)::int late_new,
    count(*) filter (where is_final='No' and due_state='Due Today')::int due_today
  from public.lead_list_snapshot
  group by assigned_to
),
book as (
  select
    count(*) filter (where is_final='No')::int open_all,
    count(*) filter (where is_final='No' and lead_generation='New' and stage='LQT')::int new_open,
    count(*) filter (where is_final='No' and lead_generation='Old' and stage='LQT')::int old_open,
    count(*) filter (where is_final='No' and stage='Incubation')::int inc_open,
    count(*) filter (where is_final='No' and due_state='Overdue')::int overdue,
    count(*) filter (where is_final='No' and due_state='Due Today')::int due_today,
    count(*) filter (where is_final='No' and assigned_to is null)::int unassigned,
    count(*) filter (where is_final='No' and priority=1)::int late_new,
    count(*) filter (where is_final='No' and lead_generation='Old' and stage='LQT' and total_calls=0)::int old_never_called,
    count(*) filter (where is_final='No' and current_status='Qualified')::int handover_inbox,
    count(*) filter (where current_status='1st Trip Complete')::int in_care,
    count(*) filter (where is_final='No' and lead_generation='New' and stage='LQT' and total_calls=0)::int new_never_called,
    count(*) filter (where current_status='New' and is_final='No')::int f_new,
    count(*) filter (where tab='Follow Up' and is_final='No')::int f_follow,
    count(*) filter (where current_status='Qualified')::int f_qualified,
    count(*) filter (where current_status='Onboarded (complete profile)')::int f_onboarded,
    count(*) filter (where current_status='1st Trip Complete')::int f_trip,
    count(*) filter (where current_status='Care Completed')::int f_care
  from public.lead_list_snapshot
),
agent as (
  select tm.id, tm.name, tm.team, tm.role,
    coalesce(o.new_open,0) new_open, coalesce(o.old_open,0) old_open, coalesce(o.inc_open,0) inc_open,
    coalesce(o.late_new,0) late_new, coalesce(o.due_today,0) due_today,
    coalesce((select sum(a.n) from agg a where a.agent_id=tm.id and a.day=crm_today()),0)::int calls_today,
    coalesce((select sum(a.n) from agg a where a.agent_id=tm.id and a.day >= crm_today()-6),0)::int calls_7d,
    coalesce((select sum(a.n) from agg a where a.agent_id=tm.id),0)::int calls_30d,
    (select max(a.day) from agg a where a.agent_id=tm.id) as last_call
  from public.team_members tm
  left join owner o on o.assigned_to = tm.id
  where tm.active and tm.team <> 'Management'
),
act as (
  select
    (select count(*) from public.call_logs, today where event_type='Call' and call_time::date=today.d)::int today,
    (select count(*) from public.call_logs, today where event_type='Call' and call_time::date=today.d-1)::int yesterday,
    (select round(count(*)/7.0,1) from public.call_logs, today where event_type='Call' and call_time::date >= today.d-6)::numeric avg7
)
select jsonb_build_object(
  'totals',(select jsonb_build_object('open_all',open_all,'new_open',new_open,'old_open',old_open,'inc_open',inc_open,'overdue',overdue,'due_today',due_today,'unassigned',unassigned,'late_new',late_new,'old_never_called',old_never_called,'handover_inbox',handover_inbox,'in_care',in_care,'new_never_called',new_never_called) from book),
  'activity',(select to_jsonb(act) from act),
  'daily',(select coalesce(jsonb_agg(to_jsonb(daily) order by day),'[]'::jsonb) from daily),
  'agents',(select coalesce(jsonb_agg(to_jsonb(agent) order by name),'[]'::jsonb) from agent),
  'funnel',(select jsonb_build_array(
     jsonb_build_object('bucket','New (no call yet)','n',f_new),
     jsonb_build_object('bucket','Contacted / Follow up','n',f_follow),
     jsonb_build_object('bucket','Qualified','n',f_qualified),
     jsonb_build_object('bucket','Onboarded','n',f_onboarded),
     jsonb_build_object('bucket','1st Trip Complete','n',f_trip),
     jsonb_build_object('bucket','Care Completed','n',f_care)) from book),
  'period', (select jsonb_build_object('from_day',from_day,'to_day',to_day) from win)
);
$function$;
-- keep old signature via overload is already default args; grant
grant execute on function public.dashboard_stats(integer, date, date) to authenticated, service_role;
