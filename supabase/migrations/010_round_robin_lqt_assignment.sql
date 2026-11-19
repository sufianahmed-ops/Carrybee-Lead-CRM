-- Assign unassigned Self Registered leads across active LQT agents in the chosen order.
-- The entire call is atomic: a stale or invalid selection rolls back every assignment.
create or replace function public.round_robin_assign_lqt(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 me public.team_members%rowtype;
 target public.team_members%rowtype;
 l public.leads%rowtype;
 public_lead_id text;
 agent_ids uuid[];
 lead_number integer := 0;
 assigned_count integer := 0;
begin
 select * into me from public.team_members
 where auth_user_id=auth.uid() and active and role~*'lead|admin';
 if me.id is null then
  raise exception 'Only a Team Lead or Admin can assign leads.';
 end if;

 select array_agg(chosen.agent_id::uuid order by chosen.ordinality)
 into agent_ids
 from jsonb_array_elements_text(coalesce(p->'agentIds','[]'::jsonb))
 with ordinality as chosen(agent_id,ordinality);

 if agent_ids is null or cardinality(agent_ids)=0 then
  raise exception 'Choose at least one LQT agent.';
 end if;
 if (select count(distinct id) from unnest(agent_ids) as ids(id)) <> cardinality(agent_ids) then
  raise exception 'Choose each LQT agent only once.';
 end if;
 if exists (
  select 1 from unnest(agent_ids) as ids(id)
  left join public.team_members tm on tm.id=ids.id
  where tm.id is null or not tm.active or tm.team<>'LQT'
 ) then
  raise exception 'Round robin assignment allows active LQT agents only.';
 end if;

 for public_lead_id in
  select jsonb_array_elements_text(coalesce(p->'leadIds','[]'::jsonb))
 loop
  lead_number := lead_number + 1;
  select * into l from public.leads where lead_id=public_lead_id for update;
  if l.id is null then
   raise exception 'Lead % was not found. Refresh and try again.',public_lead_id;
  end if;
  if l.source<>'Self Registered' or l.registration_date is null then
   raise exception 'Lead % is not eligible for new LQT assignment.',public_lead_id;
  end if;
  if l.assigned_to is not null then
   raise exception 'Lead % is already assigned. Refresh and try again.',public_lead_id;
  end if;

  select * into target from public.team_members
  where id=agent_ids[((lead_number-1)%cardinality(agent_ids))+1];
  update public.leads
  set assigned_to=target.id,
      assign_date=coalesce(l.assign_date,crm_today()),
      last_updated=now(),
      last_updated_by=me.id
  where id=l.id;
  insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,note)
  values(l.id,l.phone_clean,me.id,me.name,me.team,'Reassign','Assigned To: - → '||target.name||' (Round Robin)');
  assigned_count := assigned_count + 1;
 end loop;

 return jsonb_build_object('ok',true,'assigned',assigned_count,'agents',cardinality(agent_ids));
end $$;

revoke all on function public.round_robin_assign_lqt(jsonb) from public;
grant execute on function public.round_robin_assign_lqt(jsonb) to authenticated;
