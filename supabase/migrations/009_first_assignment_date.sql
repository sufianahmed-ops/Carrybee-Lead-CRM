-- Set Assign Date on the first LQT assignment so first-contact and SLA deadlines work.
-- Existing assignment dates remain unchanged during later reassignment.
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
   update public.leads set assigned_to=target.id,assign_date=coalesce(l.assign_date,crm_today()),last_updated=now(),last_updated_by=me.id where id=l.id;
   insert into public.call_logs(lead_id,phone,agent_id,agent_name,team,event_type,note) values(l.id,l.phone_clean,me.id,me.name,me.team,'Reassign','Assigned To: '||coalesce(old_name,'-')||' → '||target.name);
  end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;
