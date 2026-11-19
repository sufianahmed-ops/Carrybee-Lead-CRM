-- Phase 2 pilot result + rollback
--
-- Executed 2026-11-14 03:46 UTC (09:46 Dhaka) as Mohammad Sazzad Haider (Lead role,
-- via his own JWT — the function refuses to run without a Lead/Admin session).
--
--   candidates in scope (old book, worked in October, assigned before 1 Nov): 2,521
--     Md.Mahmudul Hasan 1,224 · MD.Ebrahim Emu 1,197 · Mohammad Sazzad Haider 915
--   protected by the 1 Nov cutover (assigned on/after 1 Nov): 506
--   pilot: the 20 oldest candidates, round robin Tonoy → Zahin
--     → 10 leads each, assign_date = 2026-11-14, 20 'Reassign' rows in call_logs
--       with note 'Phase 2 round robin: <from> → <to>'
--
-- The pilot batch rolls back with the block below; nothing else has moved yet.

begin;

-- restore the original owners (from the audit trail, not from guesswork)
update public.leads l
   set assigned_to = before.assigned_to,
       assign_date  = before.assign_date,
       last_updated = now()
  from (
    select cl.lead_id,
           (regexp_match(cl.note, '^Phase 2 round robin: (.*) → '))[1] as from_name,
           cl.call_time
      from public.call_logs cl
     where cl.note like 'Phase 2 round robin%'
  ) x
  join public.team_members before on before.name = x.from_name
 where l.id = x.lead_id;

-- drop the audit rows for the pilot so the counters do not double count
delete from public.call_logs where note like 'Phase 2 round robin%';

commit;

-- NOTE: run one batch at a time, check `phase2_summary()` between batches, and
-- only then widen the scope. `phase2_round_robin(..., p_dry_run => true)` previews
-- any batch without writing.
