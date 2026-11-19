# Management dashboard — redesign

**Audience:** management monitoring team performance (not an agent's "my day" view).
**Data source:** one aggregated RPC, `public.dashboard_stats(p_days)`. No browser-side maths over
the 15,591 call rows, so the tab loads in a single round trip.

## Speed

| | Before | After |
|---|---|---|
| `dashboard_stats` (real user JWT) | 3.0–4.1 s | **0.34–0.74 s** |

Why it got fast: `call_logs` and `team_members` have row-level security, so every policy check ran
per row (≈15.6k) on each request. The function is now `security definer` (owner bypasses the policy),
with `execute` granted only to `authenticated` and revoked from `public`/`anon` — verified: anon call
returns **401**. `lead_list_snapshot` has RLS disabled, so it is unaffected.

Supporting indexes added: `lead_list_snapshot(assigned_to)`, `call_logs(agent_id, call_time desc)`,
`call_logs(event_type, call_time desc)`.

## What is on the page

1. **Today — is the team working?** calls logged today (red when 0), agents active today, new leads
   never called, new work late vs SLA, due today.
2. **Work mix — what the team owns.** Donut of the open book by queue (New LQT / Old LQT /
   Incubation) and a stacked bar chart of calls per day by team.
3. **Queue KPIs.** New LQT open, old book open, Incubation open, overdue, unassigned, old never
   called, in care period, handover inbox. Every KPI is clickable and filters the lead list.
4. **Pipeline — where the book sits.** Live counts for new (no call yet) → contacted / follow up →
   qualified → onboarded → 1st trip → care completed. Stages **overlap** (a lead can be both
   "contacted" and "follow up"), so the bars are scaled to the largest stage and the % column is that
   stage's share of the largest — it is explicitly labelled as *not* a stage-to-stage conversion rate.
5. **By agent table.** New/old/incubation open, late new, calls today / 7d / 30d, last-call date,
   `7d+ silent` flag, and a 30-day volume bar.

**Filters:** period (7 / 14 / 30 / 90 days) and team (All / LQT / Incubation). Period drives the charts;
the agent columns are deliberately fixed to today / 7d / 30d so "who is not dialling" is always comparable.

## Design decisions carried over from the earlier review

- "Overdue" is **not** used as a headline number on its own — 8,044 of 8,452 open leads are overdue,
  which saturates and tells management nothing. It sits in the queue KPI row where it belongs.
- New leads are ranked above old debt: new-work KPIs sit at the top, old book is labelled "backlog,
  not today's work".
- No per-agent "my work today" row for Admin/Management users — that row was always all zeros.
- Shunucki is included as a 4th **Incubation** member, so his zero-call status is visible.

## Numbers at the time of build (2026-11-14)

- Open 8,452 · New LQT 922 · Old LQT 5,830 · Incubation 1,698 · unassigned 1,395 · late new 776 ·
  new never called 899 · old never called 36 · in care 158 · handover inbox 2.
- Calls: today **0**, yesterday 1, 7-day average **1.4/day**. Daily volume collapsed on 5 Nov
  (5 calls), 6 Nov 39, 7 Nov 6, **8–11 Nov 0**, 12 Nov 9, **13–14 Nov 0**. Historic weekends were
  full-volume (200–360/day), so this is an operational stop, not a weekend effect.
- Incubation has logged **zero** calls in 9 days.
- LQT: Tonoy and Zahin each carry 56 late new leads (112 of their 150 new leads are past SLA).

## Deployment

Live at https://carrybee-lead-crm.vercel.app (Dashboard tab). Production deployment
`dpl_AETDL7psSZoCTnhVQJHu1b8ESqA4`. Verified by rendering the real page in a headless browser with a
signed-in session: no console errors, all sections and charts present.

**Build path used this time (the Vercel connector writes `files[].data` verbatim, so a large base64
tarball can't be passed through it):** the source tarball sits in Supabase Storage
(`build-artifacts/v3.txz`, public bucket), and the project build command is
`curl … && tar -xJf … && npm install --include=dev && next build`, with `installCommand` set to
`echo prebuilt-source`. `--include=dev` is required: without it npm prunes TypeScript, which
`next.config.ts` needs.

Renewing the tarball later: re-upload to `build-artifacts/`, point the build command at the new
object, and create a deployment with any small non-JSON file (e.g. `README.txt`).

## Screenshots

- `../dashboard-full.png` — Dashboard, last 30 days, all teams.

## Files

- `components/dashboard.tsx` — all charts (hand-drawn SVG, no chart library, no CDN).
- `components/crm.tsx` — loads `dashboard_stats` and renders `<Dashboard />`; the old local
  dashboard component was deleted.
- `app/globals.css` — `.dash-*`, `.chart`, `.donut*`, `.funnel*`, `.prodbar` styles.
