-- 019_sync_health_monitoring.sql — heartbeat for Apps Script daily sync (08:00 Dhaka)
-- Fixes \"sync dies silent\" — no row = no alert. Provides sync_health() + check_sync_and_notify() + cron.

insert into app_settings(key,value) values
  ('SYNC_MAX_AGE_HOURS','26'),
  ('SYNC_EXPECTED_HOUR_DHAKA','8'),
  ('SYNC_ALERT_DEDUP_HOURS','6')
on conflict (key) do nothing;

create index if not exists idx_sheet_sync_runs_completed_at on sheet_sync_runs(completed_at desc);
create index if not exists idx_sheet_sync_runs_status on sheet_sync_runs(status);

create or replace function public.sync_health()
returns jsonb
language sql stable
set search_path to 'public'
as $$
  with last_ok as (
    select completed_at from sheet_sync_runs where status='success' order by completed_at desc nulls last limit 1
  ),
  last_any as (
    select completed_at, status, error_count, message from sheet_sync_runs order by id desc limit 1
  ),
  cfg as (
    select coalesce((select nullif(value,'')::int from app_settings where key='SYNC_MAX_AGE_HOURS'),26) as max_age,
           coalesce((select nullif(value,'')::int from app_settings where key='SYNC_EXPECTED_HOUR_DHAKA'),8) as expected_hour
  )
  select jsonb_build_object(
    'last_success_at', (select completed_at from last_ok),
    'last_any_at', (select completed_at from last_any),
    'last_status', (select status from last_any),
    'last_error_count', (select error_count from last_any),
    'last_message', (select left(message,400) from last_any),
    'hours_since_success', case when (select completed_at from last_ok) is null then null else extract(epoch from (now() - (select completed_at from last_ok)))/3600 end,
    'checked_at', now(),
    'max_age_hours', (select max_age from cfg),
    'expected_hour_dhaka', (select expected_hour from cfg),
    'today_dhaka', (now() at time zone 'Asia/Dhaka')::date,
    'last_success_date_dhaka', ((select completed_at from last_ok) at time zone 'Asia/Dhaka')::date,
    'is_stale', case
      when (select completed_at from last_ok) is null then true
      when ((now() at time zone 'Asia/Dhaka')::date > ((select completed_at from last_ok) at time zone 'Asia/Dhaka')::date
            and extract(hour from (now() at time zone 'Asia/Dhaka')) >= ((select expected_hour from cfg)+2))
        then true
      when extract(epoch from (now() - (select completed_at from last_ok)))/3600 > (select max_age from cfg) then true
      else false end
  )
$$;

create or replace function public.sync_health_status()
returns text
language sql stable
as $$
  select case
    when (sync_health()->>'is_stale')::boolean then 'stale'
    when (sync_health()->>'last_status') in ('failed','partial') then 'failed'
    else 'ok' end
$$;

create or replace function public.check_sync_and_notify()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h jsonb;
  v_is_stale boolean;
  v_hours_since numeric;
  v_last_status text;
  v_last_at timestamptz;
  v_last_any_at timestamptz;
  v_err_count int;
  v_title text;
  v_body text;
  v_kind text;
  v_dedup_hours int;
  v_existing int;
  v_recipients uuid[];
begin
  h := public.sync_health();
  v_is_stale := coalesce((h->>'is_stale')::boolean, false);
  v_hours_since := (h->>'hours_since_success')::numeric;
  v_last_status := h->>'last_status';
  v_last_at := (h->>'last_success_at')::timestamptz;
  v_last_any_at := (h->>'last_any_at')::timestamptz;
  v_err_count := coalesce((h->>'last_error_count')::int,0);
  v_dedup_hours := coalesce((select nullif(value,'')::int from app_settings where key='SYNC_ALERT_DEDUP_HOURS'),6);

  if v_is_stale then
    v_kind := 'sync_stale';
    v_title := 'Sync missing — no success since ' || coalesce(to_char(v_last_at at time zone 'Asia/Dhaka','DD Mon HH24:MI'), 'never');
    v_body := 'Daily sync expected at 08:00 Dhaka. Hours since last success: ' || coalesce(round(v_hours_since,1)::text,'?') ||
            '. Check: Apps Script trigger (08:00), CRON_SECRET in Vercel, sheet tab names, and Sync_Log tab for errors.';
  elsif v_last_status in ('failed','partial') and v_last_any_at is not null and (now() - v_last_any_at) < interval '2 hours' and v_err_count > 0 then
    v_kind := 'sync_failed';
    v_title := 'Sync ' || v_last_status || ' — ' || v_err_count || ' error(s)';
    v_body := coalesce(h->>'last_message','No message') || ' — Check sheet_sync_runs id ' || coalesce((select max(id)::text from sheet_sync_runs),'');
  else
    return jsonb_build_object('ok', true, 'action', 'none', 'health', h);
  end if;

  select count(*) into v_existing from public.notifications
  where notifications.kind = v_kind
  and notifications.created_at > now() - (v_dedup_hours || ' hours')::interval;

  if v_existing > 0 then
    return jsonb_build_object('ok', true, 'action', 'suppressed_dedup', 'existing', v_existing, 'kind', v_kind, 'health', h);
  end if;

  select array_agg(id) into v_recipients
  from team_members
  where active and (is_main_admin or role ilike '%admin%' or role ilike '%lead%');

  if v_recipients is null or array_length(v_recipients,1) is null then
    return jsonb_build_object('ok', false, 'error', 'no admin/lead recipients', 'health', h);
  end if;

  insert into public.notifications(member_id, kind, title, body)
  select unnest(v_recipients), v_kind, v_title, v_body;

  return jsonb_build_object('ok', true, 'action', 'notified', 'recipients', array_length(v_recipients,1), 'kind', v_kind, 'title', v_title, 'health', h);
end
$function$;

grant execute on function public.sync_health() to anon, authenticated;
grant execute on function public.sync_health_status() to anon, authenticated;
grant execute on function public.check_sync_and_notify() to authenticated, service_role;
