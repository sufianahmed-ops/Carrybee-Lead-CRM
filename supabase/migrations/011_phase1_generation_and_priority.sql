-- Phase 1: lead generation labels, new priority order, and a real assign date for the new-lead backlog.
-- Safe and reversible: no rows are deleted; the only data write is the assign_date backfill below.

-- 1. Cutover date: leads registered on or after 1 November 2026 are New generation.
--    (14 November 2026 is the day the new team starts working; it is not the label boundary.)
insert into public.app_settings(key,value,description)
values('LQT_CUTOVER_DATE','2026-11-01','Leads registered on or after this date are New generation; earlier ones are Old book')
on conflict (key) do update set value=excluded.value, description=excluded.description;

-- 2. Backfill assign_date = registration_date + 1 for never-assigned self-registered New leads.
--    Their first-contact clock never started, so 773 leads looked on-time while sitting 6-9 days.
--    Existing assign dates are never touched, and leads with no registration date are skipped.
with touched as (
  update public.leads l
     set assign_date = l.registration_date + 1,
         last_updated = now()
   where l.assigned_to is null
     and l.assign_date is null
     and l.source = 'Self Registered'
     and l.registration_date is not null
     and not exists (select 1 from public.call_logs c where c.lead_id = l.id)
  returning l.id
)
select count(*) as leads_backfilled from touched;

-- 3. Rebuild the view with lead_generation and the new priority order.
create or replace view public.lead_details with (security_invoker=true) as
with cfg as (
  select
   coalesce((select value::int from public.app_settings where key='FIRST_CONTACT_DAYS'),1) first_days,
   coalesce((select value::int from public.app_settings where key='CNR_GAP_DAYS'),1) cnr_gap,
   coalesce((select value::int from public.app_settings where key='CNR_MAX'),3) cnr_max,
   coalesce((select value::int from public.app_settings where key='MAX_TOUCHES'),3) max_touches,
   coalesce((select value::int from public.app_settings where key='FU1_DAYS'),3) fu1_days,
   coalesce((select value::int from public.app_settings where key='FU1_MAX'),7) fu1_max,
   coalesce((select value::int from public.app_settings where key='FU2_DAYS'),7) fu2_days,
   coalesce((select value::int from public.app_settings where key='FU2_MAX'),10) fu2_max,
   coalesce((select value::int from public.app_settings where key='FINAL_SLA_DAYS'),20) final_sla,
   coalesce((select value::int from public.app_settings where key='TRIP_DAYS'),10) trip_days,
   coalesce((select value::int from public.app_settings where key='CARE_DAYS'),30) care_days,
   coalesce((select value::int from public.app_settings where key='INC_GAP_DAYS'),2) inc_gap,
   coalesce((select value::int from public.app_settings where key='HANDOVER_CALL_MIN'),15) handover_min
), care_by_business as (
 select cp.business_id,min(cp.first_order_date) first_order_date
 from public.care_period_reports cp
 join public.leads l on l.business_id=cp.business_id and l.business_id<>''
 group by cp.business_id
 having count(distinct l.id)=1
), base as (
 select l.*, c.*,
  cb.first_order_date,
  a.name assigned_to_name, i.name incubation_agent_name, s.funnel,
  coalesce(st.total_calls,0) total_calls, coalesce(st.lqt_touches,0) lqt_touches,
  coalesce(st.incubation_calls,0) incubation_calls, coalesce(st.cnr_count,0) cnr_count,
  st.first_contact_time, st.last_call_time, coalesce(st.points,'{}'::int[]) points,
  ls.status last_status, ls.call_time last_status_time, ls.reason last_reason,
  ls.next_date last_next_date, ls.note last_note,
  ha.call_time handover_accepted_time, hr.note handover_return_note,
  exists(select 1 from public.call_logs x where x.lead_id=l.id and x.entry_source='Legacy') has_legacy_bool
 from public.leads l
 cross join cfg c
 left join care_by_business cb on cb.business_id=l.business_id
 left join public.team_members a on a.id=l.assigned_to
 left join public.team_members i on i.id=l.incubation_agent
 left join public.lead_sources s on s.source=l.source
 left join lateral (
   select
    count(*) filter(where cl.event_type='Call')::int total_calls,
    count(*) filter(where cl.event_type='Call' and cl.team<>'Incubation')::int lqt_touches,
    count(*) filter(where cl.event_type='Call' and cl.team='Incubation')::int incubation_calls,
    count(*) filter(where cl.status='CNR')::int cnr_count,
    min(cl.call_time) filter(where cl.event_type='Call') first_contact_time,
    max(cl.call_time) filter(where cl.event_type='Call') last_call_time,
    (select coalesce(array_agg(distinct pt order by pt),'{}'::int[]) from public.call_logs pc cross join lateral unnest(pc.points_covered) pt where pc.lead_id=l.id and pc.event_type='Call') points
   from public.call_logs cl where cl.lead_id=l.id
 ) st on true
 left join lateral (
   select cl.status,cl.call_time,cl.reason,cl.next_date,cl.note from public.call_logs cl
   where cl.lead_id=l.id and cl.status<>'' order by cl.call_time desc,cl.log_order desc limit 1
 ) ls on true
 left join lateral (
   select cl.call_time from public.call_logs cl where cl.lead_id=l.id and cl.event_type='Handover Accept'
   order by cl.call_time desc,cl.log_order desc limit 1
 ) ha on true
 left join lateral (
   select cl.note from public.call_logs cl where cl.lead_id=l.id and cl.event_type='Handover Return'
   order by cl.call_time desc,cl.log_order desc limit 1
 ) hr on true
), stat as (
 select b.*,
  case
   when last_status is null then 'New'
   when last_status='CNR' and cnr_count>=cnr_max then 'Silent Leads'
   when last_status='1st Trip Complete' and first_order_date is not null and crm_today()>=first_order_date+care_days then 'Care Completed'
   else last_status end current_status,
  (first_contact_time at time zone 'Asia/Dhaka')::date first_contact_date,
  (last_call_time at time zone 'Asia/Dhaka')::date last_call_date,
  (last_status_time at time zone 'Asia/Dhaka')::date last_status_date,
  (handover_accepted_time at time zone 'Asia/Dhaka')::date handover_accepted_date,
  (select count(*) from public.leads dp where dp.phone_clean=b.phone_clean and b.phone_clean<>'') duplicate_count
 from base b
), j as (
 select st.*, r.stage,r.tab,r.is_final,
  case when incubation_agent is not null and r.stage<>'LQT' then incubation_agent_name else assigned_to_name end current_owner,
  case when handover_accepted_date is not null then handover_accepted_date+trip_days end trip_deadline,
  case when first_order_date is not null then first_order_date+care_days end care_end_date,
  handover_booked_time + make_interval(mins=>handover_min) handover_call_due
 from stat st left join public.status_rules r on r.status=st.current_status
), due as (
 select j.*,
  case when is_final then null
   when current_status='New' then assign_date+first_days
   when current_status='CNR' then last_status_date+cnr_gap
   when current_status='Qualified' then coalesce((handover_booked_time at time zone 'Asia/Dhaka')::date,last_status_date)
   when last_next_date is not null then last_next_date
   when current_status='1st Trip Complete' then care_end_date
   else last_status_date+1 end next_due_date,
  case when stage='LQT' and lqt_touches>=max_touches-1 then 'Yes' else '' end must_close_next_call,
  case when stage='LQT' then
    case when lqt_touches=0 then crm_today()+fu1_days when lqt_touches=1 and first_contact_date is not null then first_contact_date+fu2_days end
   when stage='Incubation' then crm_today()+inc_gap end raw_next_default,
  case when stage='LQT' then
    case when lqt_touches=0 then crm_today()+fu1_max when lqt_touches=1 and first_contact_date is not null then first_contact_date+fu2_max end
   when current_status='1st Trip Complete' then care_end_date
   when stage='Incubation' and trip_deadline is not null and trip_deadline>=crm_today() then trip_deadline end next_date_max,
  case when stage='Incubation' and first_trip_date is null and trip_deadline is not null and crm_today()>trip_deadline then 'Overdue' else '' end trip_overdue,
  case when stage='LQT' and assign_date is not null and crm_today()>assign_date+final_sla then 'Breached' else '' end sla_breach,
  case when assign_date is null then '' when first_contact_date is null and crm_today()>assign_date+first_days then 'Late'
   when first_contact_date>assign_date+first_days then 'Late' else '' end first_contact_late,
  case when handover_call_due is not null and stage in ('Handover','Incubation') then
   case when incubation_calls>0 then 'Done' when now()>handover_call_due then 'Overdue' else 'Pending' end else '' end handover_call_state
 from j
), final_calc as (
 select d.*,
  case when raw_next_default is null then null when raw_next_default<=crm_today() then crm_today()+1 else raw_next_default end next_date_default,
  case when is_final then 'Closed' when next_due_date is null then '' when next_due_date<crm_today() then 'Overdue'
   when next_due_date=crm_today() then 'Due Today' else 'Upcoming' end due_state,
  case when current_status='1st Trip Complete' and care_end_date is not null then care_end_date-crm_today() end care_days_left,
  case when stage='LQT' then coalesce(handover_return_note,'') else '' end return_reason,
  case when has_legacy_bool then 'Yes' else '' end has_legacy,
  case when current_status in ('Onboarded (complete profile)','1st Trip Complete','Care Completed') or first_trip_date is not null then 'Yes' else '' end in_onboarding_tracker,
  case when not is_final and business_id='' then 'Missing' else '' end missing_business_id,
  case when duplicate_count>1 then 'Duplicate' else '' end duplicate_phone,
  -- Phase 1: is this lead born under the new LQT model (on/after the cutover) or is it old book?
  case when registration_date >= (select value::date from public.app_settings where key='LQT_CUTOVER_DATE')
   then 'New' else 'Old' end lead_generation
 from due d
)
select id,lead_id,source,funnel,phone,phone_clean,business_id,business_name,merchant_name,email,fb_link,
 product_category,parcel_volume,zone,area,existing_courier,assigned_to,assigned_to_name,assign_date,registration_date,
 sheet_notes,incubation_agent,incubation_agent_name,handover_booked_time,handover_note,first_trip_date,first_trip_cid,
 onboarded_form,pickup_miss,last_updated,last_updated_by,created_at,
 total_calls,lqt_touches,incubation_calls,cnr_count,points,cardinality(points) points_covered,
 first_contact_date,last_call_date,last_status,last_status_date,last_reason,last_next_date,last_note,
 current_status,stage,tab,case when is_final then 'Yes' else 'No' end is_final,current_owner,
 handover_accepted_date,trip_deadline,care_end_date,care_days_left,next_due_date,due_state,must_close_next_call,
 next_date_default,next_date_max,first_contact_late,sla_breach,trip_overdue,handover_call_due,handover_call_state,
 missing_business_id,return_reason,has_legacy,in_onboarding_tracker,duplicate_phone,
 -- Phase 1 priority order: work owed now to a live merchant beats a doomed call on an old lead.
 -- 0 handover overdue | 1 NEW first call overdue | 2 NEW due today/earlier | 3 NEW fresh | 4 OLD | 5 rest
 case when is_final then 9 when current_status='Qualified' then 6
  when handover_call_state='Overdue' and stage='Incubation' then 0
  when lead_generation='New' and stage='LQT' and current_status='New' and first_contact_late='Late' then 1
  when lead_generation='New' and stage='LQT' and due_state in ('Overdue','Due Today') then 2
  when lead_generation='New' and stage='LQT' then 3
  when lead_generation='Old' and stage='LQT' then 4
  else 5 end priority,
 case when is_final then '' else regexp_replace(
   case when lead_generation='New' and stage='LQT' and current_status='New' and first_contact_late='Late'
     then 'NEW not called yet · ' else '' end ||
   case when sla_breach<>'' then 'SLA breached · ' else '' end ||
   case when first_contact_late<>'' then '1st contact late · ' else '' end ||
   case when trip_overdue<>'' then 'Trip overdue · ' else '' end ||
   case when handover_call_state='Overdue' then 'Handover call overdue · ' else '' end ||
   case when stage='LQT' and lqt_touches>=max_touches and current_status<>'CNR' then 'Final status needed · ' else '' end ||
   case when duplicate_phone<>'' then 'Duplicate phone · ' else '' end,'( · )$','') end alert,
 first_order_date,
 -- appended last: CREATE OR REPLACE VIEW may only add columns at the end
 lead_generation
from final_calc;



grant select on public.lead_details to authenticated;
