-- Undo a Phase 2 batch.
--
-- Everything the "Assign now" button does is recorded in public.phase2_queue:
-- the lead, the owner it came from, the original assign date and the agent it
-- went to. So any batch is reversible exactly, without guesswork.
--
-- Replace the batch number(s). Run the SELECT first to see what would change.

-- 1. Which batches exist, and what each one did
select batch_no,
       count(*)              as leads,
       min(assigned_at)      as run_at,
       min(from_owner)       as example_from,
       min(note)             as example_note
  from public.phase2_queue
 where status = 'done'
 group by batch_no
 order by batch_no desc;

-- 2. What batch 1 would undo
select q.lead_label, q.from_owner, tm.name as currently_with, q.from_assign_date, q.assigned_at
  from public.phase2_queue q left join public.team_members tm on tm.id = q.assigned_to
 where q.status = 'done' and q.batch_no = 1
 order by q.id;

-- 3. Undo it
begin;

update public.leads l
   set assigned_to = src.member_id,
       assign_date = coalesce(q.from_assign_date, l.assign_date),
       last_updated = now()
  from public.phase2_queue q
  join public.team_members src on src.name = q.from_owner
 where q.status = 'done' and q.batch_no = 1 and l.id = q.lead_row_id;

delete from public.call_logs
 where event_type in ('BatchAssign','Reassign')
   and note like 'Batch assign:%'
   and lead_id in (select lead_row_id from public.phase2_queue where status = 'done' and batch_no = 1);

update public.phase2_queue
   set status = 'queued', assigned_to = null, assigned_at = null, batch_no = null
 where status = 'done' and batch_no = 1;

commit;

-- 4. Confirm the queue is back to "waiting"
select status, count(*) from public.phase2_queue group by status;
