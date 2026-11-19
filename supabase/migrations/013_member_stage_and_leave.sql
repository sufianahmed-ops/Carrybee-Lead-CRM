-- Stage per person, plus a "not in today" flag.
--
-- Why: team membership and the stage a person works in are different things.
-- Mahmudul and Ebrahim sit in the Incubation team but work the LQT stage. The
-- rotation has to follow the stage, and a person who is off sick must be able to
-- drop out for a day without being deactivated or losing their leads.
alter table public.team_members add column if not exists stage text;
alter table public.team_members add column if not exists on_leave boolean not null default false;

-- Existing values: keep the LQT team on LQT, keep the rest on Incubation.
update public.team_members set stage = case when team = 'LQT' then 'LQT' else 'Incubation' end where stage is null;

-- The two people the rosters disagree about (they work LQT while sitting in the
-- Incubation team). Confirm or change this in Team & system after applying.
update public.team_members set stage = 'LQT' where name in ('Md.Mahmudul Hasan','MD.Ebrahim Emu');

create or replace function public.set_member_leave(p jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare me public.team_members%rowtype; m public.team_members%rowtype;
begin
  select * into me from public.team_members where auth_user_id=auth.uid() and active and role~*'lead|admin';
  if me.id is null then raise exception 'Only a Team Lead or Admin can change availability.'; end if;
  select * into m from public.team_members where id=(p->>'memberId')::uuid;
  if m.id is null then raise exception 'Unknown team member.'; end if;
  update public.team_members set on_leave=coalesce((p->>'onLeave')::boolean, not on_leave) where id=m.id;
  return jsonb_build_object('ok',true,'member',m.name,'on_leave',(select on_leave from public.team_members where id=m.id));
end $$;
revoke all on function public.set_member_leave(jsonb) from public;
grant execute on function public.set_member_leave(jsonb) to authenticated;
