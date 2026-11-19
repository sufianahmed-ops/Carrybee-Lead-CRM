# Carrybee Lead CRM — Functionality Inventory & Roadmap

Production: **https://carrybee-lead-crm.vercel.app**
Last audited against source: **10 Nov 2026** (deployment `dpl_HTx4J5B8RNvEDzVSErWHSJnZRKGJ`, READY / PROMOTED)

---

## Part 1 — What the CRM does today

### 1. Data sources & ingestion
| # | Functionality | How it works |
|---|---|---|
| 1.1 | **Supabase as single source of truth** | All reads/writes are live Postgres; no sheet recalculation delay. |
| 1.2 | **Legacy workbook migration** | 11,119 leads + 15,469 call logs imported, with event-ordering fixes and de-duplication. |
| 1.3 | **Google Sheet intake (calls)** | `Data_Dump` / `Call_Queue` rows marked `Ready = YES` are pushed to `POST /api/sheets-intake`; idempotent by deterministic `SQ-…` Call ID and normalized phone. |
| 1.4 | **Self-registered / organic intake** | Rows from the registration sheet become new leads (idempotent by row key + phone), with `registration_date`, store address, profile-completion and payment-method fields. |
| 1.5 | **Care Period intake** | `Care_Period` tab pushes consignment-level reports; idempotent by Consignment ID; drives First Order Date and care end date. |
| 1.6 | **Manual "Import organic leads" button** | Lead/Admin can pull the latest self-registrations from the Dashboard without waiting for the script. |
| 1.7 | **Legacy cutoff protection** | `LEGACY_CUTOFF` (2026-11-04 inclusive) prevents sheet rows from overwriting pre-cutoff historical leads. |
| 1.8 | **Intake run log** | Every push is recorded in `sheet_sync_runs` with received vs. imported counts and per-row errors. |
| 1.9 | **Add lead manually** | Drawer form → `add_lead` RPC (source, phone, names, business ID, email, assignee, assign date). |

### 2. Views, navigation & filtering
| # | Functionality | How it works |
|---|---|---|
| 2.1 | **Dashboard** | "My work today", "Team" and "By agent" KPI blocks; every KPI click-through opens the matching view. |
| 2.2 | **My call queue** | Priority-ordered (`0` handover overdue → `3` due today) with a "Start with the first call" action and "Save and next call". |
| 2.3 | **How it works** | Visual lane map of LQT → Incubation → Care with live counts and the day/limit settings. |
| 2.4 | **LQT stage tabs** | New Leads, CNR, Follow Up, Handover Inbox (tabs are data-driven from `status_rules`). |
| 2.5 | **New LQT assignments** | Only `Self Registered`, unassigned, has `registration_date`, and Business ID **not** in the 737-ID Old.csv set. |
| 2.6 | **Old follow-ups** | Leads with legacy history that are not final. |
| 2.7 | **Missing Business ID** | Dedicated worklist for records without an ID. |
| 2.8 | **Incubation views** | Handover Inbox, Incubation Queue, Care Period, Care Completed, plus an **Onboarding tracker** (onboarded form, first trip date/CID, pickup miss). |
| 2.9 | **Final statuses** | Tab per closure status, sorted by most recent status date. |
| 2.10 | **All leads** | Full record view with stage, owner, status, registration date. |
| 2.11 | **Call script** | 7 talking points with script text, mirrored inside the call drawer as tickable coverage. |
| 2.12 | **Global search** | Business name, merchant name, phone, lead ID, business ID, email. |
| 2.13 | **Filters** | Owner (all / mine / unassigned / specific agent), source, and **Registration date from/to**; "Old.csv exclusion active" indicator. |
| 2.14 | **Role-aware UI** | Agents see their own work; Team Lead / Admin unlock assignment, bulk tools, Team & system, and Add lead. |
| 2.15 | **Dark/light theme toggle** + responsive sidebar. |

### 3. Lead workflow & call logging
| # | Functionality | How it works |
|---|---|---|
| 3.1 | **Log a call** | Outcome/status, reason, channel, next follow-up date, talking points, note → atomic `log_call` RPC. |
| 3.2 | **Rule-driven behaviour** | `status_rules` decides which statuses a team may set, whether a reason is required, allowed reasons, and whether a next date is needed (with min/max). |
| 3.3 | **Qualification handover** | "Qualified" requires a booked call time (Dhaka time) and a handover note; the slot drives the handover-call SLA ("call within X minutes"). |
| 3.4 | **Incubation acceptance / return** | `accept_handover` assigns the lead to an Incubation agent; `return_handover` sends it back to LQT with a reason that shows as a banner. |
| 3.5 | **Bulk handover accept** | Multi-select in Handover Inbox + "Accept handover". |
| 3.6 | **Lead profile editing** | Business ID, names, email, FB link, product category, parcel volume, zone, area, existing courier — saved with the call or standalone ("Save details only"). |
| 3.7 | **Full call history** | Last 200 events per lead with timestamp, agent, team, status, reason, next date, note, and a "old tracker" tag for legacy rows. |
| 3.8 | **Live next-best-action flags** | Alert banner (`SLA breached`, duplicate phone, etc.), return reason, and "last LQT touch — must close next call". |
| 3.9 | **One-tap contact** | `tel:` link and WhatsApp deep link from the drawer. |

### 4. Assignment
| # | Functionality | How it works |
|---|---|---|
| 4.1 | **Single-lead / single-agent assignment** | Multi-select + agent dropdown → `reassign_leads` (with audit log). |
| 4.2 | **Multi-person round robin (added last)** | "Choose LQT agents" picker records rotation order; leads are dealt **A → B → C → A…**, remainder to the earliest agents, via atomic `round_robin_assign_lqt`. |
| 4.3 | **Rotation preview** | Numbered agent chips + "Rotation: 1. X 2. Y" summary before committing. |
| 4.4 | **Hidden-selection safe** | Selected leads stay in the batch even if a filter change hides them; visible leads keep table order, hidden ones are appended. |
| 4.5 | **Guardrails** | RPC rejects inactive / duplicate / non-LQT agents, already-assigned or ineligible leads, non-Self-Registered sources, and null registration dates — all-or-nothing rollback. |
| 4.6 | **Old.csv exclusion** | 737 exact Business IDs excluded from the assignment pool. |
| 4.7 | **Assignment audit** | Reassignments are written to the audit trail; round-robin entries are marked `(Round Robin)`. |
| 4.8 | **First assignment date** | `first_assignment_date` frozen at first assign so SLA maths stays honest after reassignment. |

### 5. Compliance, SLA & care logic (computed in Postgres)
Computed on the `lead_details` view, so every client sees identical numbers: due state, `first_contact_late`, `sla_breach`, `trip_overdue`, `handover_call_state`, `care_days_left`, `must_close_next_call`, `next_date_default` / `next_date_max`, `missing_business_id`, `has_legacy`, `in_onboarding_tracker`, `duplicate_phone`, composite `alert` text, and queue `priority`.
Configurable settings: `FIRST_CONTACT_DAYS`, `CNR_MAX`, `FU1_DAYS/MAX`, `FU2_DAYS/MAX`, `FINAL_SLA_DAYS`, `HANDOVER_CALL_MIN`, `TRIP_DAYS`, `CARE_DAYS` (editable in Team & system).

### 6. Administration & security
| # | Functionality | How it works |
|---|---|---|
| 6.1 | **Invite-based auth** | Supabase Auth email invites, public signups disabled, `/auth/callback` + `/update-password` flow. |
| 6.2 | **Team & access management** | Invite/link members, set team (LQT / Incubation / Management), role (Agent / Team Lead / Admin), employee ID; member list shows login status. |
| 6.3 | **Role checks server-side** | Admin APIs re-verify the caller's member row, not just the UI. |
| 6.4 | **RLS + RPC-only writes** | Row-level security on tables; mutations go through SECURITY DEFINER RPCs; service-role key only on the server. |
| 6.5 | **Care period setting** | Admin-editable 1–365 days; care queues recalculate immediately. |
| 6.6 | **Keyless Google backup** | Apps Script pulls a paged frozen snapshot (`backup_snapshot_chunks`) and replaces the previous backup only when every page succeeds; schedule Sat–Thu hourly 10:00–20:00, Fri 10/15/20:00, with a dated final copy at 20:00. |
| 6.7 | **Backup run monitor** | Last 8 backup runs with status, leads/calls counts, trigger source, message. |
| 6.8 | **`CRON_SECRET`-gated APIs** | Sheets intake and backup routes are bearer-token protected. |

---

## Part 2 — What we can add next

Grouped by size, all using the same patterns already proven (Postgres RPC + typed UI + audit log). **Tier A** items are roughly the size of the round-robin feature.

### Tier A — natural next steps (high value, ~1–2 deploys each)

| # | Feature | What it does | Why it matters |
|---|---|---|---|
| A1 | **Round-robin fairness memory** | Store the last agent who received a lead per rotation group, so the next batch **continues** the rotation instead of restarting at agent #1. One agent never gets more leads across batches. | Today every batch restarts at A → A accumulates more leads over time. |
| A2 | **Dry-run preview modal for assignment** | Before committing, show the exact lead → agent mapping table ("LEAD-39411 → Tonoy"), with confirm/cancel. | Round robin is powerful and irreversible-ish; a preview makes it safe. |
| A3 | **Undo last assignment batch** | Record `assignment_batches` + members, then a one-click "Undo this batch" that returns leads to the unassigned pool with an audit entry. | Protects against a wrong filter/agent selection. |
| A4 | **Server-side Old.csv exclusion** | Move the 737 IDs into a DB table (`assignment_exclusions`) and enforce it **inside** `round_robin_assign_lqt` / `reassign_leads`, not only the UI. | The file is currently a client constant; a direct API call could bypass it. |
| A5 | **Capacity / load-aware distribution** | Weight the rotation by current open-lead count per agent (e.g. "level the queue" mode next to the strict A→B→C mode). | Balancing new batches against existing backlog. |
| A6 | **Bulk unassign / recycle** | Select leads → return to unassigned pool (with reason) for Team Lead. | Needed after an agent leaves or is on leave. |
| A7 | **Assignment history report** | A dedicated view listing every batch: when, who assigned, which agents, how many leads, with a per-lead drilldown. | Assignment auditing is currently per-lead only. |
| A8 | **Round robin in Handover Inbox** | Same multi-agent rotation for handover acceptance to Incubation agents. | Direct reuse of the feature you just shipped. |

### Tier B — workflow & insight upgrades (medium)

| # | Feature | What it does |
|---|---|---|
| B1 | **CSV export of any filtered view** | Export exactly what is on screen (respecting search, owner, source, date filters) — useful for management reviews. |
| B2 | **Saved filter presets / segments** | Name a filter combination ("Self-registered, last 7 days, unassigned") and share it with the team. |
| B3 | **Follow-up calendar** | Month/week grid of `next_due_date` per agent, drag-to-reschedule with an audit note. |
| B4 | **Charts on the dashboard** | Trend lines: registrations/day, calls/day, qualification rate, per-agent throughput, SLA breach trend (last 30/90 days). |
| B5 | **Leaderboard & coaching report** | Per-agent calls, touches to qualification, CNR rate, reason breakdown, overdue exposure — exportable for 1:1s. |
| B6 | **Duplicate phone merge tool** | Cluster duplicates (already flagged) and merge two lead records while preserving both call histories. |
| B7 | **Bulk status / tag updates** | Apply a status-with-reason or a tag to many selected leads in one audited call. |
| B8 | **Intake health monitor** | "Sheet vs CRM" reconciliation page that lists rows present in the Google sheet but missing in the CRM (this is exactly how the 39446 / 39471 / 39495 gap was found manually), plus last-run error detail. |
| B9 | **Validation hardening on self-registration** | Require a Business ID at intake (or flag + auto-route to "Missing Business ID"), so the assignment pool never hides merchants. |
| B10 | **In-app notification bell** | Unread counts for new assignments, returned handovers, due-today climb, and SLA breaches. |
| B11 | **SLA & escalation rules** | Auto-escalate a lead to the Team Lead after N overdue days, with an escalation queue. |
| B12 | **Session-safe pagination** | `loadBootstrap` currently pulls *all* leads into the browser; move to server-side paging + server-side search/filter for headroom as the lead count grows. |
| B13 | **Daily digest email / WhatsApp** | Scheduled summary per agent (queue count, due today, overdue) and a management roll-up at 20:00. |
| B14 | **Notes & mentions** | Internal comments on a lead with `@agent` mentions (separate from call notes). |

### Tier C — bigger bets / integrations

| # | Feature | What it does |
|---|---|---|
| C1 | **Carrybee delivery-API integration** | Auto-detect "first trip" from the courier system (consignment created → first trip date/CID filled automatically), removing the main manual step in Incubation and making care-period start exact. |
| C2 | **Automated call logging from the dialer/telephony** | Call start/end/duration/recording URL attached to the lead automatically. |
| C3 | **Built-in WhatsApp / SMS templates** | Send the follow-up message from the drawer through an official API and log it as a channel event. |
| C4 | **Mobile PWA / offline queue** | Installable app for agents with offline call logging that syncs when back online. |
| C5 | **Territory / zone auto-assignment** | Route leads by `zone` / `area` to the responsible agent as a third distribution mode. |
| C6 | **Incubation → Care ownership handoff automation** | Time-based transitions with rule-driven SLA and exception queues. |
| C7 | **Warehouse-of-record analytics** | Cohort retention by registration month: registration → first trip → repeat parcel volume. |
| C8 | **Granular permissions** | Per-view and per-action permissions (e.g. Team Lead can assign but not delete; Incubation cannot reassign LQT leads). |

---

## Suggested order

1. **A4, A2, A1** — make the feature you just shipped bullet-proof and fair.
2. **A3, A6, A7, A8** — operational safety and extension.
3. **B1, B8, B5** — visibility for management.
4. **B9, B6, B2** — data quality.
5. **C1** — highest-leverage integration (removes the biggest manual step in the care workflow).

---

*Legend for effort estimates: Tier A ≈ 1 focused build + 1 deploy each, matching the round-robin change; Tier B ≈ several days including UI work; Tier C ≈ cross-system integration with external dependencies.*
