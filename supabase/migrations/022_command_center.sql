-- 022_command_center.sql — Command Center targets + helpers (Phase 1 ships with JS aggregation, Phase 2 will add RPC)
create table if not exists public.dashboard_targets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','LQT','Incubation','person')),
  scope_id uuid references public.team_members(id) on delete cascade,
  metric text not null check (metric in ('registered','contacted','verified','qualified','onboarded','first_trip','activation7','overall_conv')),
  period text not null check (period in ('daily','weekly','monthly')),
  period_date date not null,
  target_value integer not null check (target_value >= 0),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(scope, scope_id, metric, period, period_date)
);
alter table public.dashboard_targets enable row level security;
drop policy if exists targets_read on public.dashboard_targets;
create policy targets_read on public.dashboard_targets for select to authenticated using (true);
drop policy if exists targets_write on public.dashboard_targets;
create policy targets_write on public.dashboard_targets for all to authenticated using (public.current_member_is_lead()) with check (public.current_member_is_lead());

-- default targets (monthly): 1000 onboarded baseline — admin can edit
insert into public.dashboard_targets(scope, metric, period, period_date, target_value)
values
  ('global','registered','monthly', date_trunc('month', crm_today())::date, 2500),
  ('global','contacted','monthly', date_trunc('month', crm_today())::date, 2000),
  ('global','verified','monthly', date_trunc('month', crm_today())::date, 1500),
  ('global','qualified','monthly', date_trunc('month', crm_today())::date, 1200),
  ('global','onboarded','monthly', date_trunc('month', crm_today())::date, 1000),
  ('global','first_trip','monthly', date_trunc('month', crm_today())::date, 800),
  ('global','activation7','monthly', date_trunc('month', crm_today())::date, 600)
on conflict do nothing;

-- helper: verified = profile complete (business_id + 4 required fields)
create or replace function public.is_verified_lead(p_leads_row public.leads) returns boolean
language sql immutable as $$
  select coalesce(btrim(p_leads_row.business_id),'') <> ''
     and coalesce(btrim(p_leads_row.product_category),'') <> ''
     and coalesce(btrim(p_leads_row.parcel_volume),'') <> ''
     and coalesce(btrim(p_leads_row.zone),'') <> ''
     and coalesce(btrim(p_leads_row.area),'') <> ''
$$;

grant select on public.dashboard_targets to authenticated;
grant execute on function public.is_verified_lead(public.leads) to authenticated, service_role;
