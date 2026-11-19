-- Extensions used by the external 15-minute backup schedule.
-- No job is scheduled here: enable it only after a manual Google backup succeeds.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
