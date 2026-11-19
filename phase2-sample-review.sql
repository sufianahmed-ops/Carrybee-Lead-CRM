-- Phase 2 sample review — run this in the Supabase SQL editor to see exactly
-- what each batch would move, before asking the app to move it.
-- Nothing here writes; it only reads `phase2_candidates`.

-- A. Scope by owner
select owner,
       count(*)                                             as movable,
       min(last_call_date)                                  as oldest_oct_call,
       max(last_call_date)                                  as newest_oct_call,
       count(*) filter (where cnr_count >= 3)               as cnr_at_max,
       count(*) filter (where registration_date is null)    as missing_registration
  from public.phase2_candidates(null, 5000)
 group by owner
 order by movable desc;

-- B. The first 50 that a batch would take (oldest October call first), with the
--    owner each lead would land on for a 2-agent rotation.
with c as (
  select *, row_number() over (order by last_call_date, id) rn
    from public.phase2_candidates(null, 5000)
)
select rn,
       lead_id,
       business_name,
       owner                                   as current_owner,
       last_call_date,
       assign_date,
       cnr_count,
       tab,
       case when rn % 2 = 1 then 'Md. shariful Islam Tonoy' else 'MD. Zahin Rahman' end as would_go_to
  from c
 where rn <= 50
 order by rn;

-- C. Protected leads — assigned on/after 1 Nov, so they never move in Phase 2.
select assigned_to_name, count(*) as protected_since_cutover
  from public.lead_list_snapshot
 where is_final = 'No' and lead_generation = 'Old' and assign_date >= date '2026-11-01'
 group by 1 order by 2 desc;
