-- 024_io_disk_fix.sql — FREE tier Disk IO was exhausted (snapshot refreshed every 1-2 min + 12k rows × 13 parallel fetches per login)
-- 1) Throttle snapshot to every 15 min (was every 1-2 min) — cuts IO 7-15×
-- 2) Keep snapshot but frontend now paginates (Fix C) — 50 rows per view, not 12k
-- Safe if job doesn't exist: unschedule is wrapped so it never fails
do $$
declare j record;
begin
  for j in select jobid, jobname from cron.job where command like '%refresh_lead_list_snapshot%' loop
    perform cron.unschedule(j.jobname);
  end loop;
  -- schedule every 15 min — cheap enough for FREE, fresh enough for CRM (plus nudge on save)
  perform cron.schedule('refresh_lead_list_snapshot_15m', '*/15 * * * *', 'select public.refresh_lead_list_snapshot()');
end $$;
-- also lower statement timeout spike protection: refresh is now batched less often
