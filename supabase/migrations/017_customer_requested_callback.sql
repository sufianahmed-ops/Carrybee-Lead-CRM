-- 017 · Lead-requested later callbacks (Request 13)
-- A merchant who says "call me in 30 days" must be bookable past the normal follow-up limit,
-- without the lead going cold and without the agent being blamed for an SLA breach.
-- Nothing here is hard-coded: the switch and the longest wait are editable in
-- Administration -> Follow-up rulebook (CALLBACK_OVERRIDE, CALLBACK_MAX_DAYS).
--
-- Applied to production in four statements:
--   1) settings + rulebook specs (this file, part A)
--   2) status_rules.callback_hold + the 'Callback requested' status (part B)
--   3) call_logs.held_back (part C)
--   4) the lead_details view (part D) and log_call (part E)
--   5) lead_list_snapshot columns + refresh (part F) - the app reads the 2-minute
--      snapshot table, so a new view column must also exist there.

-- ── A. Settings and rulebook specs ─────────────────────────────────────────────
insert into public.app_settings(key,value,description) values
 ('CALLBACK_OVERRIDE','TRUE','Allow an agent to book a follow-up past the latest allowed date when the merchant asks'),
 ('CALLBACK_MAX_DAYS','90','Longest lead-requested callback an agent may book, in days'),
 ('CALLBACK_STATUS','1st Follow Up Need','Status used to park a lead-requested callback')
on conflict (key) do update set value=excluded.value, description=excluded.description;

insert into public.setting_specs(key,label,group_name,kind,min_value,max_value,unit,note,sort_order) values
 ('CALLBACK_MAX_DAYS','Longest lead-requested wait','Lead qualification','int',1,365,'days','The furthest ahead an agent may book when the lead asks to be called later. 30 days covers "call me next month", 90 covers a business launch.',28),
 ('CALLBACK_OVERRIDE','Allow lead-requested later callbacks','Gates','bool',null,null,null,'When a lead asks to be called later than the normal follow-up limit, the agent ticks "Customer asked for a later call" and may book further ahead. Turn this off and the old hard limit applies again.',63)
on conflict (key) do update set label=excluded.label, group_name=excluded.group_name, kind=excluded.kind,
 min_value=excluded.min_value, max_value=excluded.max_value, unit=excluded.unit, note=excluded.note, sort_order=excluded.sort_order;

-- ── B. Which statuses park a lead until the day the merchant named ─────────────
alter table public.status_rules add column if not exists callback_hold boolean not null default false;
update public.status_rules set callback_hold=true where status in ('1st Follow Up Need','2nd Follow Up Need');
insert into public.status_rules(status,stage,tab,is_final,set_by,needs_next_date,reason_required,allowed_reasons,meaning,callback_hold)
values ('Callback requested','LQT','Callback requested',false,'LQT',true,false,
 string_to_array('Decision Pending,Busy — Will Talk Later,New Business,Will Start Soon,Business Not Started Yet',','),
 'The lead asked to be called on a later date; the SLA clock is paused until then.',true)
on conflict (status) do update set stage=excluded.stage, tab=excluded.tab, is_final=excluded.is_final,
 set_by=excluded.set_by, needs_next_date=excluded.needs_next_date, reason_required=excluded.reason_required,
 allowed_reasons=excluded.allowed_reasons, meaning=excluded.meaning, callback_hold=true;

-- ── C. The tick is recorded on the call, so it is auditable ────────────────────
alter table public.call_logs add column if not exists held_back boolean not null default false;

-- ── F. Snapshot table (runs after D) ──────────────────────────────────────────
alter table public.lead_list_snapshot add column if not exists callback_hold boolean;
alter table public.lead_list_snapshot add column if not exists callback_date date;
select public.refresh_lead_list_snapshot() as rows_refreshed;

-- ── D. lead_details view (applied 2026-11-15) ─────────────────────────────────
-- Adds the last two columns ONLY (a view can only gain columns at the end):
--   callback_hold  - true when the last status is a parking status AND the call was
--                    ticked "customer asked for a later call"
--   callback_date  - the date the merchant named
-- and changes four behaviours:
--   next_due_date        -> the callback date until it passes, then normal rules
--   due_state            -> 'Upcoming' while parked (never 'Overdue')
--   sla_breach           -> paused while the merchant has asked us to wait
--   must_close_next_call -> cleared for a parked lead (a customer request is not a dead lead)
-- The applied definition is the current production view; regenerate it with
--   select pg_get_viewdef('public.lead_details'::regclass, true);
-- before editing, so no other rule is lost.

-- ── E. log_call (applied 2026-11-15) ──────────────────────────────────────────
--   hb := (p->>'heldBack')::boolean AND CALLBACK_OVERRIDE
--   if hb            -> the date may exceed next_date_max but not today+CALLBACK_MAX_DAYS
--   elsif over the cap -> "The latest allowed next date is X. If the lead asked for a
--                         later call, tick Lead asked for a later call."
--   the call_logs row is written with status = CALLBACK_STATUS and held_back = true,
--   and the real outcome is kept in the note ("Outcome: 1st Follow Up Need. ...").

-- Rollback (safe; no data is lost):
--   update public.app_settings set value='FALSE' where key='CALLBACK_OVERRIDE';
-- Turning the switch off restores the hard limit immediately without touching any lead.
