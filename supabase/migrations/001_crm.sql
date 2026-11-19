-- Carrybee Lead CRM: primary Postgres schema, derived workflow view and transactional RPCs.
-- Apply with the Supabase SQL editor or `supabase db push`.

create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function public.crm_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Dhaka')::date $$;

create or replace function public.normalize_phone(raw text) returns text
language plpgsql immutable as $$
declare digits text; candidate text;
begin
  digits := regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g');
  if length(digits) < 10 then return null; end if;
  candidate := '0' || right(digits, 10);
  if candidate ~ '^01[3-9][0-9]{8}$' then return candidate; end if;
  return null;
end $$;

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text not null,
  email citext unique,
  team text not null check (team in ('LQT','Incubation','Management')),
  role text not null default 'Agent',
  active boolean not null default true,
  employee_id text unique,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value text not null,
  description text not null default ''
);

create table public.list_values (
  category text not null,
  value text not null,
  sort_order integer not null default 0,
  primary key (category, value)
);

create table public.lead_sources (
  source text primary key,
  funnel text not null
);

create table public.status_rules (
  status text primary key,
  stage text not null,
  tab text not null,
  is_final boolean not null default false,
  set_by text not null,
  needs_next_date boolean not null default false,
  reason_required boolean not null default false,
  allowed_reasons text[] not null default '{}',
  meaning text not null default ''
);

create table public.call_scripts (
  point_number integer primary key,
  talking_point text not null,
  script_text text not null default ''
);

create sequence public.lead_number_seq start 1;
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  source text not null default '',
  phone text not null default '',
  phone_clean text not null default '',
  business_id text not null default '',
  business_name text not null default '',
  merchant_name text not null default '',
  email text not null default '',
  fb_link text not null default '',
  product_category text not null default '',
  parcel_volume text not null default '',
  zone text not null default '',
  area text not null default '',
  existing_courier text not null default '',
  assigned_to uuid references public.team_members(id) on delete set null,
  assign_date date,
  registration_date date,
  sheet_notes text not null default '',
  incubation_agent uuid references public.team_members(id) on delete set null,
  handover_booked_time timestamptz,
  handover_note text not null default '',
  first_trip_date date,
  first_trip_cid text not null default '',
  onboarded_form text not null default '',
  pickup_miss text not null default '',
  last_updated timestamptz not null default now(),
  last_updated_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.prepare_lead() returns trigger
language plpgsql as $$
begin
  if new.lead_id is null or btrim(new.lead_id) = '' then
    new.lead_id := 'CB-' || lpad(nextval('public.lead_number_seq')::text, 6, '0');
  end if;
  new.phone_clean := coalesce(public.normalize_phone(new.phone), '');
  new.business_id := btrim(coalesce(new.business_id, ''));
  return new;
end $$;
create trigger prepare_lead before insert or update of lead_id, phone, business_id on public.leads
for each row execute function public.prepare_lead();

create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  log_order bigint generated always as identity,
  log_id text not null unique default ('LG-' || replace(gen_random_uuid()::text, '-', '')),
  logged_at timestamptz not null default now(),
  call_time timestamptz not null default now(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  phone text not null default '',
  agent_id uuid references public.team_members(id) on delete set null,
  agent_name text not null default '',
  team text not null default '',
  event_type text not null default 'Call',
  status text not null default '',
  reason text not null default '',
  channel text not null default '',
  points_covered integer[] not null default '{}',
  next_date date,
  note text not null default '',
  entry_source text not null default 'CRM'
);

create index leads_phone_clean_idx on public.leads(phone_clean);
create index leads_business_id_idx on public.leads(business_id) where business_id <> '';
create index leads_assigned_to_idx on public.leads(assigned_to);
create index leads_incubation_agent_idx on public.leads(incubation_agent);
create index leads_assign_date_idx on public.leads(assign_date);
create unique index call_logs_log_order_idx on public.call_logs(log_order);
create index call_logs_lead_time_idx on public.call_logs(lead_id, call_time desc, log_order desc);
create index call_logs_status_idx on public.call_logs(status) where status <> '';
create index call_logs_event_idx on public.call_logs(event_type, call_time);
create index call_logs_agent_day_idx on public.call_logs(agent_id, call_time);
create index call_logs_points_gin_idx on public.call_logs using gin(points_covered);

create table public.backup_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  message text not null default '',
  leads_count integer not null default 0,
  calls_count integer not null default 0,
  triggered_by text not null default 'cron'
);

-- Initial configuration (editable later in Supabase, and included in every sheet backup).
insert into public.app_settings(key,value,description) values
 ('FIRST_CONTACT_DAYS','1','1st call due this many days after Assign Date'),
 ('CNR_GAP_DAYS','1','Days between CNR retries'),
 ('CNR_MAX','3','CNRs before Silent Leads'),
 ('MAX_TOUCHES','3','LQT touches per lead'),
 ('FU1_DAYS','3','Default 1st follow-up after 1st contact'),
 ('FU1_MAX','7','Latest 1st follow-up after 1st contact'),
 ('FU2_DAYS','7','Default 2nd follow-up after 1st contact'),
 ('FU2_MAX','10','Latest 2nd follow-up after 1st contact'),
 ('FINAL_SLA_DAYS','20','Days to Qualified or a final status'),
 ('TRIP_DAYS','10','Days from handover accept to 1st trip'),
 ('CARE_DAYS','30','Care period from 1st trip'),
 ('INC_GAP_DAYS','2','Default incubation next-call gap'),
 ('HANDOVER_CALL_MIN','15','Minutes allowed around booked handover call'),
 ('ENFORCE_POINTS','TRUE','Require every talking point before Qualified'),
 ('QUALIFY_REQUIRED','Business ID, Product Category, Parcel Volume, Zone, Area','Fields required before Qualified'),
 ('BID_REQUIRED_STATUSES','Qualified, Onboarded (complete profile), 1st Trip Complete','Statuses requiring Business ID'),
 ('LEAD_ID_PREFIX','CB','Lead ID prefix'),
 ('ORGANIC_SHEET_ID','1euc0MnR8oFIunbHI8PAzONKPHidxbYHX4OEC-IVDirk','Organic source sheet'),
 ('LEGACY_CUTOFF','2026-11-04','Organic registrations through this date are not auto-imported');

insert into public.lead_sources(source,funnel) values
 ('Self Registered','Organic'),('Inbound','Organic'),('Facebook (Social)','Paid Funnel'),
 ('LeadGen','Paid Funnel'),('Cold Call','Outbound');

insert into public.list_values(category,value,sort_order) values
 ('Source','Self Registered',1),('Source','Inbound',2),('Source','Facebook (Social)',3),('Source','LeadGen',4),('Source','Cold Call',5),
 ('Zone','ISD',1),('Zone','OSD',2),('Zone','RSD',3),('Zone','N/A',4),
 ('Existing Courier','Steadfast',1),('Existing Courier','Pathao',2),('Existing Courier','RedX',3),('Existing Courier','2nd Gen',4),('Existing Courier','Multiple',5),('Existing Courier','None',6),
 ('Product Category','Clothing',1),('Product Category','Beauty',2),('Product Category','Gadgets / Electronics',3),('Product Category','Home decor / Gifts',4),('Product Category','Food',5),('Product Category','Footwear / Bags',6),('Product Category','Baby products',7),('Product Category','Various items',8),('Product Category','Other',9),
 ('Parcel Volume','None yet',1),('Parcel Volume','Under 10 / month',2),('Parcel Volume','10–50 / month',3),('Parcel Volume','50–150 / month',4),('Parcel Volume','150–600 / month',5),('Parcel Volume','600+ / month',6),
 ('Channel','Phone call',1),('Channel','WhatsApp',2),('Channel','Messenger',3),('Channel','Other',4),
 ('Yes/No','Yes',1),('Yes/No','No',2);

insert into public.status_rules(status,stage,tab,is_final,set_by,needs_next_date,reason_required,allowed_reasons,meaning) values
 ('New','LQT','New Leads',false,'System',false,false,'{}','Assigned, not called yet'),
 ('Contacted — Interested','LQT','Follow Up',false,'LQT',true,false,string_to_array('Decision Pending,Busy — Will Talk Later,New Business,Will Start Soon,Business Not Started Yet',','),'Spoke to merchant; interested'),
 ('1st Follow Up Need','LQT','Follow Up',false,'LQT',true,false,string_to_array('Decision Pending,Busy — Will Talk Later,New Business,Will Start Soon,Business Not Started Yet',','),'Needs 1st follow-up'),
 ('2nd Follow Up Need','LQT','Follow Up',false,'LQT',true,false,string_to_array('Decision Pending,Busy — Will Talk Later,New Business,Will Start Soon,Business Not Started Yet',','),'Needs 2nd follow-up'),
 ('CNR','LQT','CNR',false,'LQT',false,true,string_to_array('CNR — Didn''t Pick Up Call,CNR — Unreachable Number,Busy — Will Talk Later',','),'Call not received'),
 ('Qualified','Handover','Handover Inbox',false,'LQT',false,false,'{}','Waiting for Incubation'),
 ('Awaiting 1st Trip','Incubation','Incubation Queue',false,'Incubation',true,false,string_to_array('Decision Pending,Busy — Will Talk Later,New Business,Will Start Soon,Business Not Started Yet,CNR — Didn''t Pick Up Call,CNR — Unreachable Number',','),'Working to first trip'),
 ('Onboarded (complete profile)','Incubation','Incubation Queue',false,'Incubation',true,false,string_to_array('Decision Pending,Busy — Will Talk Later,New Business,Will Start Soon,Business Not Started Yet,CNR — Didn''t Pick Up Call,CNR — Unreachable Number',','),'Profile complete; no trip'),
 ('1st Trip Complete','Incubation','Care Period',false,'Incubation',true,false,string_to_array('1st Trip Done,Care — Happy,Care — Needs Growth Support,Care — Service Issue,CNR — Didn''t Pick Up Call',','),'Care period running'),
 ('Silent Leads','Final','Silent Leads',true,'System',false,false,'{}','Automatic after CNR limit'),
 ('Not Interested','Final','Not Interested',true,'Both',false,true,string_to_array('Other,Decision Pending',','),'Merchant declined'),
 ('Ineligible','Final','Ineligible',true,'Both',false,true,string_to_array('C2C,Restricted Product,Mistakenly Opened Account,Duplicate Business Profile,Duplicate Account,Other',','),'Cannot be served'),
 ('Blocked','Final','Blocked',true,'Both',false,true,string_to_array('Pickup Unavailable,Other',','),'Blocked'),
 ('Managed by KAM','Final','Managed by KAM',true,'Both',false,false,string_to_array('KAM Lead',','),'Merchant has a KAM'),
 ('Follow Up - Cold','Final','Follow Up - Cold',true,'LQT',false,false,string_to_array('Decision Pending',','),'No decision after last touch'),
 ('Managed by ACQ','Final','Managed by ACQ',true,'Both',false,false,string_to_array('Other',','),'Handled by ACQ'),
 ('Care Completed','Final','Care Completed',true,'System',false,false,'{}','Automatic after care period');

insert into public.call_scripts(point_number,talking_point) values
 (1,'About our company'),(2,'Price plan'),(3,'USP'),(4,'Offers (if any)'),
 (5,'Payment methods'),(6,'Store creation process'),(7,'Service communication');

insert into public.team_members(name,team,role,active,employee_id) values
 ('Md.Mahmudul Hasan','Incubation','Agent',true,'CL-86240'),
 ('MD. Zahin Rahman','LQT','Agent',true,'CL-85034'),
 ('Md. shariful Islam Tonoy','LQT','Agent',true,'CL-85037'),
 ('Mohammad Sazzad Haider','Incubation','Agent',true,'CL-86139'),
 ('MD.Ebrahim Emu','Incubation','Agent',true,'CL-84883'),
 ('Eyaliduzzaman Shunucki','Incubation','Agent',true,'CL-85038');

-- Auth helper functions avoid recursive RLS policies.
create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.team_members where auth_user_id = auth.uid() and active limit 1
$$;
create or replace function public.current_member_is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role ~* 'lead|admin' from public.team_members where auth_user_id=auth.uid() and active limit 1),false)
$$;
revoke all on function public.current_member_id() from public;
revoke all on function public.current_member_is_lead() from public;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.current_member_is_lead() to authenticated;

-- One indexed, reusable workflow calculation instead of full-sheet ARRAYFORMULA scans.
create view public.lead_details with (security_invoker=true) as
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
), base as (
 select l.*, c.*,
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
   when last_status='1st Trip Complete' and first_trip_date is not null and crm_today()>first_trip_date+care_days then 'Care Completed'
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
  case when first_trip_date is not null then first_trip_date+care_days end care_end_date,
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
  case when duplicate_count>1 then 'Duplicate' else '' end duplicate_phone
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
 case when is_final then 9 when current_status='Qualified' then 6 when handover_call_state='Overdue' and stage='Incubation' then 0
  when due_state='Overdue' then 1 when current_status='New' then 2 when due_state='Due Today' then 3 else 5 end priority,
 case when is_final then '' else regexp_replace(
   case when sla_breach<>'' then 'SLA breached · ' else '' end ||
   case when first_contact_late<>'' then '1st contact late · ' else '' end ||
   case when trip_overdue<>'' then 'Trip overdue · ' else '' end ||
   case when handover_call_state='Overdue' then 'Handover call overdue · ' else '' end ||
   case when stage='LQT' and lqt_touches>=max_touches and current_status<>'CNR' then 'Final status needed · ' else '' end ||
   case when duplicate_phone<>'' then 'Duplicate phone · ' else '' end,'( · )$','') end alert
from final_calc;

grant select on public.lead_details to authenticated;

-- Friendly call history includes the public Lead ID and preserves imported agent names.
create view public.call_history with (security_invoker=true) as
select cl.id,cl.log_id,cl.logged_at,cl.call_time,l.lead_id public_lead_id,cl.lead_id lead_uuid,
 cl.phone,cl.agent_id,cl.agent_name,cl.team,cl.event_type,cl.status,cl.reason,cl.channel,
 cl.points_covered,cl.next_date,cl.note,cl.entry_source
from public.call_logs cl join public.leads l on l.id=cl.lead_id;
grant select on public.call_history to authenticated;

-- RLS: every authenticated active CRM member can read operational data. All writes go through checked RPCs.
alter table public.team_members enable row level security;
alter table public.app_settings enable row level security;
alter table public.list_values enable row level security;
alter table public.lead_sources enable row level security;
alter table public.status_rules enable row level security;
alter table public.call_scripts enable row level security;
alter table public.leads enable row level security;
alter table public.call_logs enable row level security;
alter table public.backup_runs enable row level security;

create policy team_read on public.team_members for select to authenticated using (public.current_member_id() is not null);
create policy settings_read on public.app_settings for select to authenticated using (public.current_member_id() is not null);
create policy lists_read on public.list_values for select to authenticated using (public.current_member_id() is not null);
create policy sources_read on public.lead_sources for select to authenticated using (public.current_member_id() is not null);
create policy rules_read on public.status_rules for select to authenticated using (public.current_member_id() is not null);
create policy scripts_read on public.call_scripts for select to authenticated using (public.current_member_id() is not null);
create policy leads_read on public.leads for select to authenticated using (public.current_member_id() is not null);
create policy logs_read on public.call_logs for select to authenticated using (public.current_member_id() is not null);
create policy backup_read on public.backup_runs for select to authenticated using (public.current_member_is_lead());

grant select on public.team_members,public.app_settings,public.list_values,public.lead_sources,public.status_rules,public.call_scripts,public.leads,public.call_logs to authenticated;
grant select on public.backup_runs to authenticated;

create or replace function public.log_call(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; l public.leads%rowtype; d public.lead_details%rowtype;
 r public.status_rules%rowtype; prof jsonb; merged jsonb; pts int[]; missing text;
 nd date; booked timestamptz; required_field text; required_missing text[] := '{}';
begin
  select * into me from public.team_members where auth_user_id=auth.uid() and active;
  if me.id is null then raise exception 'Your CRM membership is inactive or not linked.'; end if;
  select * into l from public.leads where lead_id=p->>'leadId' for update;
  if l.id is null then raise exception 'Lead % was not found. Refresh and try again.',p->>'leadId'; end if;
  select * into d from public.lead_details where id=l.id;
  select * into r from public.status_rules where status=p->>'status';
  if r.status is null then raise exception 'Unknown status.'; end if;
  if r.set_by in ('System','') or not (me.role~*'lead|admin' or r.set_by='Both' or r.set_by=me.team) then
    raise exception 'Your team cannot set "%".',r.status;
  end if;
  if coalesce(p->>'reason','')<>'' and cardinality(r.allowed_reasons)>0 and not (p->>'reason'=any(r.allowed_reasons)) then
    raise exception 'The selected reason is not valid for %.',r.status;
  end if;
  if r.reason_required and coalesce(p->>'reason','')='' then raise exception 'Choose a reason for %.',r.status; end if;
  nd := nullif(p->>'nextDate','')::date;
  if r.needs_next_date then
    if d.must_close_next_call='Yes' and d.stage='LQT' then
      raise exception 'This is the last LQT touch. Choose Qualified, CNR or a final status.';
    end if;
    if nd is null then raise exception 'Enter the next follow-up date.'; end if;
    if nd<crm_today() then raise exception 'The next follow-up date cannot be in the past.'; end if;
    if d.next_date_max is not null and nd>d.next_date_max then
      raise exception 'The latest allowed next date is %. Choose an earlier date or a final status.',d.next_date_max;
    end if;
  end if;
  prof := coalesce(p->'profile','{}'::jsonb);
  if prof ? 'Business ID' then l.business_id:=btrim(coalesce(prof->>'Business ID','')); end if;
  if prof ? 'Business Name' then l.business_name:=btrim(coalesce(prof->>'Business Name','')); end if;
  if prof ? 'Merchant Name' then l.merchant_name:=btrim(coalesce(prof->>'Merchant Name','')); end if;
  if prof ? 'Email' then l.email:=btrim(coalesce(prof->>'Email','')); end if;
  if prof ? 'Fb Link' then l.fb_link:=btrim(coalesce(prof->>'Fb Link','')); end if;
  if prof ? 'Product Category' then l.product_category:=btrim(coalesce(prof->>'Product Category','')); end if;
  if prof ? 'Parcel Volume' then l.parcel_volume:=btrim(coalesce(prof->>'Parcel Volume','')); end if;
  if prof ? 'Zone' then l.zone:=btrim(coalesce(prof->>'Zone','')); end if;
  if prof ? 'Area' then l.area:=btrim(coalesce(prof->>'Area','')); end if;
  if prof ? 'Existing Courier' then l.existing_courier:=btrim(coalesce(prof->>'Existing Courier','')); end if;
  if l.business_id<>'' and exists(select 1 from public.leads x where x.business_id=l.business_id and x.id<>l.id) then
    raise exception 'Business ID % is already linked to another lead.',l.business_id;
  end if;
  if exists(select 1 from unnest(string_to_array((select value from public.app_settings where key='BID_REQUIRED_STATUSES'),',')) required_status where btrim(required_status)=r.status)
     and l.business_id='' then raise exception 'Add the Business ID before marking %.',r.status; end if;
  if r.status='Qualified' then
    merged := jsonb_build_object('Business ID',l.business_id,'Product Category',l.product_category,'Parcel Volume',l.parcel_volume,'Zone',l.zone,'Area',l.area);
    foreach required_field in array string_to_array((select value from public.app_settings where key='QUALIFY_REQUIRED'),',') loop
      required_field:=btrim(required_field);
      if coalesce(btrim(merged->>required_field),'')='' then required_missing:=array_append(required_missing,required_field); end if;
    end loop;
    booked:=nullif(p->>'bookedTime','')::timestamptz;
    if booked is null then required_missing:=array_append(required_missing,'booked call time with Incubation'); end if;
    if coalesce(btrim(p->>'handoverNote'),'')='' then required_missing:=array_append(required_missing,'handover note'); end if;
    if coalesce((select value from public.app_settings where key='ENFORCE_POINTS'),'TRUE')='TRUE' then
      select coalesce(array_agg(value::int),'{}'::int[]) into pts from jsonb_array_elements_text(coalesce(p->'points','[]'::jsonb));
      if exists(select 1 from public.call_scripts cs where not cs.point_number=any(coalesce(pts,'{}'::int[])) and not exists(
        select 1 from public.call_logs cl where cl.lead_id=l.id and cl.event_type='Call' and cl.points_covered@>array[cs.point_number])) then
        required_missing:=array_append(required_missing,'all talking points');
      end if;
    end if;
    if cardinality(required_missing)>0 then raise exception 'Cannot mark Qualified. Missing: %.',array_to_string(required_missing,'; '); end if;
    l.handover_booked_time:=booked; l.handover_note:=p->>'handoverNote';
  end if;
  if r.status='1st Trip Complete' and coalesce(p->>'tripDate','')='' and l.first_trip_date is null then raise exception 'Enter the 1st trip date.'; end if;
  if coalesce(p->>'tripDate','')<>'' then l.first_trip_date:=(p->>'tripDate')::date; end if;
  if coalesce(p->>'tripCid','')<>'' then l.first_trip_cid:=p->>'tripCid'; end if;
  if coalesce(p->>'onboardedForm','')<>'' then l.onboarded_form:=p->>'onboardedForm'; end if;
  if coalesce(p->>'pickupMiss','')<>'' then l.pickup_miss:=p->>'pickupMiss'; end if;
  select coalesce(array_agg(value::int),'{}'::int[]) into pts from jsonb_array_elements_text(coalesce(p->'points','[]'::jsonb));
  update public.leads set business_id=l.business_id,business_name=l.business_name,merchant_name=l.merchant_name,email=l.email,
   fb_link=l.fb_link,product_category=l.product_category,parcel_volume=l.parcel_volume,zone=l.zone,area=l.area,
   existing_courier=l.existing_courier,handover_booked_time=l.handover_booked_time,handover_note=l.handover_note,
   first_trip_date=l.first_trip_date,first_trip_cid=l.first_trip_cid,onboarded_form=l.onboarded_form,pickup_miss=l.pickup_miss,
   last_updated=now(),last_updated_by=me.id where id=l.id;
  insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,status,reason,channel,points_covered,next_date,note)
   values(l.id,l.phone_clean,me.id,me.name,me.team,'Call',r.status,coalesce(p->>'reason',''),coalesce(p->>'channel',''),coalesce(pts,'{}'),case when r.needs_next_date then nd end,coalesce(p->>'note',''));
  return jsonb_build_object('ok',true,'leadId',l.lead_id);
end $$;

create or replace function public.update_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; l public.leads%rowtype; prof jsonb:=coalesce(p->'profile','{}'::jsonb); changed text[]:='{}'; k text;
begin
 select * into me from public.team_members where auth_user_id=auth.uid() and active;
 if me.id is null then raise exception 'Your CRM membership is inactive or not linked.'; end if;
 select * into l from public.leads where lead_id=p->>'leadId' for update;
 if l.id is null then raise exception 'Lead not found.'; end if;
 for k in select jsonb_object_keys(prof) loop
  if k not in ('Business ID','Business Name','Merchant Name','Email','Fb Link','Product Category','Parcel Volume','Zone','Area','Existing Courier') then continue; end if;
  changed:=array_append(changed,k);
 end loop;
 if cardinality(changed)=0 then raise exception 'Nothing changed.'; end if;
 if prof ? 'Business ID' then l.business_id:=btrim(coalesce(prof->>'Business ID','')); end if;
 if prof ? 'Business Name' then l.business_name:=btrim(coalesce(prof->>'Business Name','')); end if;
 if prof ? 'Merchant Name' then l.merchant_name:=btrim(coalesce(prof->>'Merchant Name','')); end if;
 if prof ? 'Email' then l.email:=btrim(coalesce(prof->>'Email','')); end if;
 if prof ? 'Fb Link' then l.fb_link:=btrim(coalesce(prof->>'Fb Link','')); end if;
 if prof ? 'Product Category' then l.product_category:=btrim(coalesce(prof->>'Product Category','')); end if;
 if prof ? 'Parcel Volume' then l.parcel_volume:=btrim(coalesce(prof->>'Parcel Volume','')); end if;
 if prof ? 'Zone' then l.zone:=btrim(coalesce(prof->>'Zone','')); end if;
 if prof ? 'Area' then l.area:=btrim(coalesce(prof->>'Area','')); end if;
 if prof ? 'Existing Courier' then l.existing_courier:=btrim(coalesce(prof->>'Existing Courier','')); end if;
 if l.business_id<>'' and exists(select 1 from public.leads x where x.business_id=l.business_id and x.id<>l.id) then raise exception 'Business ID % is already linked to another lead.',l.business_id; end if;
 update public.leads set business_id=l.business_id,business_name=l.business_name,merchant_name=l.merchant_name,email=l.email,
  fb_link=l.fb_link,product_category=l.product_category,parcel_volume=l.parcel_volume,zone=l.zone,area=l.area,existing_courier=l.existing_courier,
  last_updated=now(),last_updated_by=me.id where id=l.id;
 insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,note)
  values(l.id,l.phone_clean,me.id,me.name,me.team,'Profile Update','Updated: '||array_to_string(changed,', '));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.accept_handover(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; target public.team_members%rowtype; l public.leads%rowtype;
 public_lead_id text; skipped text[]:='{}'; st text;
begin
 select * into me from public.team_members where auth_user_id=auth.uid() and active;
 if me.id is null or not(me.role~*'lead|admin' or me.team='Incubation') then raise exception 'Only Incubation or a Team Lead can accept handovers.'; end if;
 select * into target from public.team_members where id=(p->>'agentId')::uuid and active and team='Incubation';
 if target.id is null then raise exception 'Choose an active Incubation team member.'; end if;
 for public_lead_id in select jsonb_array_elements_text(coalesce(p->'leadIds','[]'::jsonb)) loop
  select * into l from public.leads where lead_id=public_lead_id for update;
  if l.id is null then skipped:=array_append(skipped,public_lead_id); continue; end if;
  select current_status into st from public.lead_details where id=l.id;
  if st<>'Qualified' then skipped:=array_append(skipped,public_lead_id); continue; end if;
  update public.leads set incubation_agent=target.id,last_updated=now(),last_updated_by=me.id where id=l.id;
  insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,status,next_date,note)
   values(l.id,l.phone_clean,me.id,me.name,me.team,'Handover Accept','Awaiting 1st Trip',crm_today(),'Handover accepted for '||target.name);
 end loop;
 return jsonb_build_object('ok',true,'skipped',skipped);
end $$;

create or replace function public.return_handover(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; l public.leads%rowtype; st text;
begin
 select * into me from public.team_members where auth_user_id=auth.uid() and active;
 if me.id is null or not(me.role~*'lead|admin' or me.team='Incubation') then raise exception 'Only Incubation or a Team Lead can return handovers.'; end if;
 if coalesce(btrim(p->>'reason'),'')='' then raise exception 'Write why the handover is returned.'; end if;
 select * into l from public.leads where lead_id=p->>'leadId' for update;
 if l.id is null then raise exception 'Lead not found.'; end if;
 select current_status into st from public.lead_details where id=l.id;
 if st<>'Qualified' then raise exception 'This lead is no longer waiting in the Handover inbox.'; end if;
 insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,status,next_date,note)
  values(l.id,l.phone_clean,me.id,me.name,me.team,'Handover Return','Contacted — Interested',crm_today(),p->>'reason');
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.reassign_leads(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; target public.team_members%rowtype; l public.leads%rowtype; public_lead_id text; old_name text;
begin
 select * into me from public.team_members where auth_user_id=auth.uid() and active and role~*'lead|admin';
 if me.id is null then raise exception 'Only a Team Lead or Admin can reassign leads.'; end if;
 select * into target from public.team_members where id=(p->>'agentId')::uuid and active;
 if target.id is null then raise exception 'Choose an active team member.'; end if;
 for public_lead_id in select jsonb_array_elements_text(coalesce(p->'leadIds','[]'::jsonb)) loop
  select * into l from public.leads where lead_id=public_lead_id for update;
  if l.id is null then continue; end if;
  if target.team='Incubation' then
   select name into old_name from public.team_members where id=l.incubation_agent;
   update public.leads set incubation_agent=target.id,last_updated=now(),last_updated_by=me.id where id=l.id;
   insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,note) values(l.id,l.phone_clean,me.id,me.name,me.team,'Reassign','Incubation Agent: '||coalesce(old_name,'-')||' → '||target.name);
  else
   select name into old_name from public.team_members where id=l.assigned_to;
   update public.leads set assigned_to=target.id,last_updated=now(),last_updated_by=me.id where id=l.id;
   insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,note) values(l.id,l.phone_clean,me.id,me.name,me.team,'Reassign','Assigned To: '||coalesce(old_name,'-')||' → '||target.name);
  end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.add_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; phone text; l public.leads%rowtype;
begin
 select * into me from public.team_members where auth_user_id=auth.uid() and active and role~*'lead|admin';
 if me.id is null then raise exception 'Only a Team Lead or Admin can add leads.'; end if;
 phone:=public.normalize_phone(p->>'phone');
 if phone is null then raise exception 'Enter a valid mobile number (01XXXXXXXXX).'; end if;
 if exists(select 1 from public.leads where phone_clean=public.normalize_phone(p->>'phone')) then raise exception 'This phone number is already in the CRM.'; end if;
 if coalesce(btrim(p->>'businessId'),'')<>'' and exists(select 1 from public.leads where business_id=btrim(p->>'businessId')) then raise exception 'This Business ID is already linked to a lead.'; end if;
 insert into public.leads(lead_id,source,phone,business_id,business_name,merchant_name,email,assigned_to,assign_date,sheet_notes,last_updated_by)
 values(null,coalesce(p->>'source',''),phone,coalesce(btrim(p->>'businessId'),''),coalesce(p->>'businessName',''),coalesce(p->>'merchantName',''),coalesce(p->>'email',''),
  nullif(p->>'assignedTo','')::uuid,coalesce(nullif(p->>'assignDate','')::date,crm_today()),'Added in CRM by '||me.name,me.id) returning * into l;
 return jsonb_build_object('ok',true,'leadId',l.lead_id);
end $$;

revoke all on function public.log_call(jsonb),public.update_profile(jsonb),public.accept_handover(jsonb),public.return_handover(jsonb),public.reassign_leads(jsonb),public.add_lead(jsonb) from public;
grant execute on function public.log_call(jsonb),public.update_profile(jsonb),public.accept_handover(jsonb),public.return_handover(jsonb),public.reassign_leads(jsonb),public.add_lead(jsonb) to authenticated;
