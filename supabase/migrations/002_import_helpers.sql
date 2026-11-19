-- Service-role-only helper used after importing legacy CB-000001 style IDs.
create or replace function public.sync_lead_sequence() returns bigint
language plpgsql security definer set search_path=public as $$
declare highest bigint;
begin
  select coalesce(max((regexp_match(lead_id,'([0-9]+)$'))[1]::bigint),0) into highest from public.leads;
  perform setval('public.lead_number_seq',greatest(highest,1),highest>0);
  return highest;
end $$;
revoke all on function public.sync_lead_sequence() from public;
revoke all on function public.sync_lead_sequence() from authenticated;
grant execute on function public.sync_lead_sequence() to service_role;
