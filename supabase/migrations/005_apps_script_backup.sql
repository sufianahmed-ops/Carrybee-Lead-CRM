-- Short-lived, service-role-only snapshot pages used by the keyless Apps Script backup.
create table if not exists public.backup_snapshot_chunks (
  run_id bigint not null references public.backup_runs(id) on delete cascade,
  sheet_name text not null,
  chunk_index integer not null,
  headers jsonb not null,
  rows jsonb not null,
  total_rows integer not null,
  primary key (run_id, sheet_name, chunk_index)
);
alter table public.backup_snapshot_chunks enable row level security;
revoke all on public.backup_snapshot_chunks from anon, authenticated;
grant all on public.backup_snapshot_chunks to service_role;
create index if not exists backup_snapshot_chunks_run_idx on public.backup_snapshot_chunks(run_id);
