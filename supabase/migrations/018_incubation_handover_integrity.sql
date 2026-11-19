-- 018 · Incubation handover integrity (Request 17)
-- Applied to production 2026-11-16 in four migrations:
--   incubation_hold_stage_and_auto_accept · auto_accept_on_first_incubation_call
--   callback_hold_works_in_any_stage_v3   · hold_flag_follows_the_tick_not_the_status
--
-- Why: LQT → Incubation delivery itself was sound (27 of 29 qualified leads were in
-- Incubation with a named owner), but three things around it were wrong.
--
-- 1) "Lead asked for a later call" moved the lead BACK to LQT.
--    log_call rewrote the logged status to CALLBACK_STATUS ('1st Follow Up Need'), an
--    LQT status, so an Incubation agent's call pulled the lead out of Incubation and
--    re-owned it to an LQT agent (happened to CB-000053). The rewrite is now confined to
--    the stage the agent is working in: the configured parking status is used only when
--    its stage matches, otherwise another parking status of the same stage, otherwise the
--    agent's own outcome is kept. The wait is still honoured through next_date + held_back.
--
-- 2) The trip clock never started when the agent skipped "Accept handover".
--    14 of the 29 handovers had no Handover Accept event, so handover_accepted_date was
--    empty and the TRIP_DAYS deadline / trip-overdue alert never fired. New trigger
--    trg_auto_accept_handover records the acceptance on the first Incubation call (the
--    same moment the agent actually started work), and the 14 existing leads were
--    backfilled the same way.
--
-- 3) Parking only worked for LQT statuses.
--    lead_details gated the hold on status_rules.callback_hold, which is only set for the
--    LQT statuses, and required the parked date to still be in the future. An Incubation
--    lead ticked "Lead asked for a later call" therefore stayed Overdue. Now the tick
--    itself (call_logs.held_back, written only when the agent ticks the box) is the
--    evidence: held_status is true for every status, and a parked lead is Upcoming until
--    it is worked again.
--
-- The applied SQL lives in the migration history. This file is the record; re-running it
-- is safe (create or replace / drop trigger if exists / delete the backfill block once the
-- notes are present).

create or replace function public.log_call(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; l public.leads%rowtype; d public.lead_details%rowtype;
 r public.status_rules%rowtype; prof jsonb; merged jsonb; pts int[];
 nd date; booked timestamptz; required_field text; required_missing text[] := '{}';
 acting text; late_ok boolean; late_max int; hb boolean; hb_rule public.status_rules%rowtype; log_status text; log_note text;
begin
  select * into me from public.team_members where auth_user_id=auth.uid() and active;
  if me.id is null then raise exception 'Your CRM membership is inactive or not linked.'; end if;
  acting := public.current_acting_stage(me.id);
  select * into l from public.leads where lead_id=p->>'leadId' for update;
  if l.id is null then raise exception 'Lead % was not found. Refresh and try again.',p->>'leadId'; end if;
  select * into d from public.lead_details where id=l.id;
  select * into r from public.status_rules where status=p->>'status';
  if r.status is null then raise exception 'Unknown status.'; end if;
  if r.set_by in ('System','') or not (me.role~*'lead|admin' or r.set_by='Both' or r.set_by=acting or r.set_by=me.team) then
    raise exception 'Your team cannot set "%".',r.status;
  end if;
  if coalesce(p->>'reason','')<>'' and cardinality(r.allowed_reasons)>0 and not (p->>'reason'=any(r.allowed_reasons)) then
    raise exception 'The selected reason is not valid for %.',r.status;
  end if;
  if r.reason_required and coalesce(p->>'reason','')='' then raise exception 'Choose a reason for %.',r.status; end if;
  late_ok := coalesce((select value from public.app_settings where key='CALLBACK_OVERRIDE'),'TRUE')='TRUE';
  late_max := coalesce((select value::int from public.app_settings where key='CALLBACK_MAX_DAYS'),90);
  hb := coalesce((p->>'heldBack')::boolean,false) and late_ok;
  nd := nullif(p->>'nextDate','')::date;
  if r.needs_next_date then
    if d.must_close_next_call='Yes' and d.stage='LQT' and not hb then
      raise exception 'This is the last LQT touch. Choose Qualified, CNR or a final status.';
    end if;
    if nd is null then raise exception 'Enter the next follow-up date.'; end if;
    if nd<crm_today() then raise exception 'The next follow-up date cannot be in the past.'; end if;
    if hb then
      if nd>crm_today()+late_max then
        raise exception 'The lead can be put off for at most % days. Enter a date up to %.',late_max,crm_today()+late_max;
      end if;
    elsif d.next_date_max is not null and nd>d.next_date_max then
      raise exception 'The latest allowed next date is %. If the lead asked for a later call, tick "Lead asked for a later call".',d.next_date_max;
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
  log_status := r.status; log_note := coalesce(p->>'note','');
  if hb and r.needs_next_date then
    -- Request 17: a parking status must belong to the stage the agent is working in.
    select * into hb_rule from public.status_rules
     where status=coalesce((select value from public.app_settings where key='CALLBACK_STATUS'),'1st Follow Up Need');
    if hb_rule.status is null or hb_rule.stage<>r.stage then
      select * into hb_rule from public.status_rules
       where callback_hold and stage=r.stage and not is_final and status<>r.status
       order by status limit 1;
    end if;
    if hb_rule.status is not null and hb_rule.stage=r.stage and hb_rule.status<>r.status then
      log_note := 'Outcome: '||r.status||'. Lead asked for a later call. '||log_note;
      log_status := hb_rule.status;
    end if;
  end if;
  insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,status,reason,channel,points_covered,next_date,note,held_back)
   values(l.id,l.phone_clean,me.id,me.name,acting,'Call',log_status,coalesce(p->>'reason',''),coalesce(p->>'channel',''),coalesce(pts,'{}'),
    case when r.needs_next_date then nd end,log_note,hb);
  return jsonb_build_object('ok',true,'leadId',l.lead_id,'acting_stage',acting,'held_back',hb);
end $$;

-- the trip clock starts with the first Incubation call, not with a button
create or replace function public.auto_accept_handover() returns trigger
language plpgsql security definer set search_path=public as $$
declare a_name text;
begin
  if new.event_type <> 'Call' or new.team <> 'Incubation' then return new; end if;
  if (select incubation_agent from public.leads where id = new.lead_id) is null then return new; end if;
  if exists (select 1 from public.call_logs where lead_id = new.lead_id and event_type = 'Handover Accept') then return new; end if;
  select name into a_name from public.team_members where id = (select incubation_agent from public.leads where id = new.lead_id);
  insert into public.call_logs(lead_id, phone, agent_id, agent_name, team, event_type, status, next_date, note, call_time)
  values (new.lead_id, new.phone, new.agent_id, new.agent_name, 'Incubation', 'Handover Accept', 'Awaiting 1st Trip', crm_today(),
          'Handover accepted automatically on the first Incubation call (' || coalesce(a_name,'agent') || ')', new.call_time - interval '1 second');
  return new;
end $$;

drop trigger if exists trg_auto_accept_handover on public.call_logs;
create trigger trg_auto_accept_handover after insert on public.call_logs
 for each row execute function public.auto_accept_handover();
