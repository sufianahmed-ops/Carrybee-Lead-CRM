-- Deterministic insertion ordering for rapid consecutive events and imported ties.
alter table public.call_logs add column if not exists log_order bigint generated always as identity;
create unique index if not exists call_logs_log_order_idx on public.call_logs(log_order);
drop index if exists public.call_logs_lead_time_idx;
create index call_logs_lead_time_idx on public.call_logs(lead_id,call_time desc,log_order desc);
-- After applying this, redeploy the lead_details view from 001_crm.sql; its latest-status,
-- handover-accept and handover-return lookups order by call_time desc, log_order desc.
