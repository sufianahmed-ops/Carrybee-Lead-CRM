# Phase 1 — deployed

Deployment `dpl_PxUcvtYRTjq1K6DLVPTr2WjQbEBw` → READY / PROMOTED → `carrybee-lead-crm.vercel.app`
Migration `supabase/migrations/011_phase1_generation_and_priority.sql`

## What changed

### 1. `lead_generation` label
New column on `lead_details`: **New** (registered on/after cutover) or **Old**.
Cutover is stored in `app_settings.LQT_CUTOVER_DATE = 2026-11-01`, so it can be changed
later without touching the view.

| Label | Leads | Open LQT |
| --- | --- | --- |
| New | 940 | 922 |
| Old | 11,062 | 7,525 |

### 2. Assign date backfill — `registration_date + 1`
772 never-assigned, never-called self-registered leads now have a real `assign_date`,
so their 1-day first-contact clock finally runs. Existing assign dates untouched;
leads with no registration date skipped; any lead with a call log excluded.

### 3. New priority order
`0` handover overdue → `1` **NEW first call late** → `2` **NEW due today/earlier** →
`3` **NEW fresh** → `4` **OLD** → `5` rest.

Verified: best possible priority for any Old LQT lead is **4**, so no old lead can sit
above new work. The agent call queue now includes priority 4 (it previously stopped at 3,
which would have hidden the old book entirely).

### 4. UI
- **Gen** column in LQT and All-leads tables
- **New + Old / New only / Old only** filter in the top bar
- **New to LQT** view, visible to agents (the old "New LQT assignments" stays Lead/Admin only)
- **Old follow-ups** now filters on `lead_generation='Old'` instead of the legacy-call flag
- Dashboard KPIs: **New to LQT** and **Old book open**
- Alert text now leads with `NEW not called yet` on the most urgent bucket

## Verification

- `allRows` against production: 12,002 rows, `lead_generation` present, 940 New / 11,062 Old
- Top of the New queue: `CB-000057 p1 New · "NEW not called yet · 1st contact late"`
- Old book floor confirmed at priority 4
- Next.js build clean; live bundle contains the new column, views, filters and KPIs
- Fix A (single-lead save), Fix B (slim load) and round-robin all still intact

## Rollback

- View: re-apply the view body from `supabase/migrations/007_care_view_performance.sql`
- Assign dates: the 772 rows are identifiable as
  `assigned_to is null and assign_date = registration_date + 1`
- Previous deployment: `dpl_FMrCadv3he5CFRQ55vfqapcsmvhm`
- Source snapshot: `private/app-phase1.tar.xz`

## Not in this phase

- Old-book round-robin (October-scoped, ~2,519 leads) and moving leads off Sazzad Haider
- CNR counter reset on reassignment
- Daily call cap enforcement
- The 2,563 pre-October leads — left untouched by decision
