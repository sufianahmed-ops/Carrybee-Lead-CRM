# Fix B — slim list load (shipped)

Deployment `dpl_FMrCadv3he5CFRQ55vfqapcsmvhm` — READY / PROMOTED → `carrybee-lead-crm.vercel.app`

## What changed

Two independent changes in `lib/data.ts`, no database or schema change:

1. **Slim column list** (`LEAD_LIST_COLUMNS`). The list load no longer does `select('*')`.
   Six columns are dropped from the list payload because the UI never reads them:

   | Dropped column | Why |
   | --- | --- |
   | `id` (uuid) | primary key, never rendered — the app keys rows on `lead_id` |
   | `created_at`, `last_updated`, `last_updated_by` | write bookkeeping timestamps |
   | `assigned_to`, `incubation_agent` (uuids) | duplicate of `assigned_to_name` / `incubation_agent_name`, which the UI uses |

   Everything the table, filters, KPIs and drawer read is still fetched, including all
   derived fields: `due_state`, `alert`, `priority`, `care_days_left`, `points_covered`,
   `must_close_next_call`, `sla_breach`, `trip_overdue`, `handover_call_state`.

   `loadOneLead` (Fix A) still reads `select('*')`, so opening a lead gets the complete
   record and every drawer field stays editable.

2. **Parallel paging** (`allRows`). The bulk download used to be 13 strictly sequential
   requests. It now fetches pages 6 at a time in overlapping waves. The first wave is
   still sequential-by-one to establish that a second page is needed at all, so small
   tables (`team_members`, `status_rules`, `app_settings`, `list_values`) cost exactly
   one request, as before.

   PostgREST builders are mutable, so `allRows` takes a factory (`() => query`) and builds
   a fresh query per page. Reusing one builder would silently re-request page 1 and
   produce a corrupt list with duplicate leads.

## Measured results (live data, 12,002 leads)

| Configuration | Time |
| --- | --- |
| Old: `select('*')`, sequential | 22,300 ms |
| Slim columns only, sequential | 27,085 ms |
| **Shipped: slim columns + 6-way parallel** | **18,043 ms** |

Wire size, one 1,000-row page, gzip as the browser receives it: **195 KB → 140 KB (28% smaller)**.
Uncompressed JSON 1.72 MB → 1.48 MB (14% smaller) — gzip already compresses the UUIDs well,
which is why the column trim alone is not the main win.

## Honest note on what this does and does not achieve

The column trim is a real but modest 28% reduction in bytes. The larger factor is the
parallel fetch. Even so, a full 12,000-row load still takes ~18 s from this sandbox, which
sits far from the Supabase region — from Dhaka with a warm CDN and a normal office
connection it should be materially faster, but it will not be instant.

The remaining lever, if this is still slow in real use, is to stop loading all 12,002 leads
at all: serve only the current tab / owner / date view (a few hundred rows) and fetch on
filter change. That is a bigger change to `crm.tsx` filtering logic and should be its own
decision, not bundled in.

## Verification performed

- `allRows` exercised directly against production Supabase: **12,002 of 12,002 rows**,
  all `lead_id`s unique, still ordered by `lead_id`, derived columns present, internal
  columns absent.
- Canary lead `CB-003495` loaded through the new path: `due_state=Upcoming`, `priority=5`.
- Next.js production build: compiled successfully, `/` = 16.9 kB / 185 kB first load.
- Live bundle after promotion: slim column list present, old `select('*')` list query gone,
  Fix A single-lead reload present, round-robin RPC call intact, Fix A+ points note intact.

## Rollback

Previous production deployment is `dpl_9c9BXb9uki8WdJiMXNo6iLtMppzC` (Fix A only).
Source snapshot of this release: `private/app-slim-load.tar.xz`.
