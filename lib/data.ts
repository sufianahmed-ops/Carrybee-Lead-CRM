import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bootstrap, Lead } from './types';

/**
 * Columns the workspace actually renders or filters on. The per-row UUIDs and
 * write timestamps (`id`, `created_at`, `last_updated`, `last_updated_by`) and
 * the duplicate `assigned_to` / `incubation_agent` keys are deliberately left
 * out: they are never read by the UI but make up the largest part of the list
 * payload. A full record is fetched on demand by `loadOneLead`.
 */
export const LEAD_LIST_COLUMNS = [
  'lead_id','business_id','business_name','merchant_name','phone','phone_clean','email',
  'fb_link','product_category','parcel_volume','zone','area','existing_courier',
  'source','funnel','registration_date','assign_date',
  'current_status','stage','tab','is_final','current_owner','assigned_to_name',
  'incubation_agent_name','last_reason','last_status','last_status_date','last_note','last_next_date',
  'lqt_touches','total_calls','incubation_calls','cnr_count','points','points_covered',
  'first_contact_date','last_call_date','next_due_date','due_state','next_date_default','next_date_max',
  'callback_hold','callback_date','qualified_by','qualified_by_name','qualified_at',
  'must_close_next_call','first_contact_late','sla_breach','trip_overdue',
  'handover_booked_time','handover_accepted_date','handover_call_due','handover_call_state',
  'handover_note','return_reason','trip_deadline','first_trip_date','first_trip_cid',
  'onboarded_form','pickup_miss','first_order_date','care_end_date','care_days_left',
  'missing_business_id','has_legacy','in_onboarding_tracker','duplicate_phone',
  'sheet_notes','priority','alert','lead_generation',
].join(',');

const PAGE_SIZE = 1000;      // server-side maximum rows per request
const CONCURRENCY = 2;       // lowered 6→2 to cut Disk IO bursts (FREE tier 6 MB/s throttled)

/**
 * Page through a query in parallel. Requests are issued CONCURRENCY at a time
 * until a short page proves the end of the result set, which turns the old
 * one-request-after-another download into a few overlapping waves.
 *
 * `make` must return a FRESH query builder each call: PostgREST builders are
 * mutable, so reusing one across pages silently repeats the first range.
 */
export async function allRows<T>(make: () => any): Promise<T[]> {
  const first = await make().range(0, PAGE_SIZE - 1);
  if (first.error) throw first.error;
  const rows: T[] = first.data || [];
  if (rows.length < PAGE_SIZE) return rows;

  let from = PAGE_SIZE;
  for (;;) {
    const starts = Array.from({ length: CONCURRENCY }, (_, i) => from + i * PAGE_SIZE);
    const pages = await Promise.all(starts.map(start => make().range(start, start + PAGE_SIZE - 1)));
    let finished = false;
    for (const page of pages) {
      if (page.error) throw page.error;
      const data: T[] = page.data || [];
      rows.push(...data);
      if (data.length < PAGE_SIZE) { finished = true; break; }
    }
    if (finished) return rows;
    from += CONCURRENCY * PAGE_SIZE;
  }
}

export async function loadBootstrapMeta(supabase: SupabaseClient): Promise<Omit<Bootstrap,'leads'>> {
  const [members, rules, settings, lists, scripts] = await Promise.all([
    (async () => {
      const [people, lendings] = await Promise.all([
        allRows<any>(() => supabase.from('team_members').select('*').order('name')),
        allRows<any>(() => supabase.from('member_lendings').select('*').eq('active', true)),
      ]);
      const byMember = new Map(lendings.map((l: any) => [l.member_id, l]));
      return people.map((m: any) => {
        const l: any = byMember.get(m.id);
        return l ? { ...m, lend_stage: l.work_stage, lend_cap: l.cap, lend_reason: l.reason } : m;
      });
    })(),
    allRows<any>(() => supabase.from('status_rules').select('*').order('status')),
    allRows<any>(() => supabase.from('app_settings').select('*').order('key')),
    allRows<any>(() => supabase.from('list_values').select('*').order('sort_order')),
    allRows<any>(() => supabase.from('call_scripts').select('*').order('point_number')),
  ]);
  return { members: members as any, rules: rules as any, settings: settings as any, lists: lists as any, scripts: scripts as any };
}
export async function loadBootstrap(supabase: SupabaseClient): Promise<Bootstrap> {
  const [leads, members, rules, settings, lists, scripts] = await Promise.all([
    // Read the precomputed list snapshot instead of the full lead_details view.
    // The view recomputes 12,002 rows on every request; doing that 13 times in a
    // row exceeded the 8s statement timeout enforced by the connection role, so
    // logins failed outright. lead_list_snapshot is refreshed by pg_cron every
    // 2 minutes and pages in well under a second.
    allRows<Lead>(() => supabase.from('lead_list_snapshot').select(LEAD_LIST_COLUMNS).order('registration_date', { ascending: false }).order('lead_id', { ascending: false })),
    // team_members plus, per person, any one-day lending (see member_lendings):
    // a borrowed person works the other team's stage until the Admin ends it.
    (async () => {
      const [people, lendings] = await Promise.all([
        allRows<any>(() => supabase.from('team_members').select('*').order('name')),
        allRows<any>(() => supabase.from('member_lendings').select('*').eq('active', true)),
      ]);
      const byMember = new Map(lendings.map((l: any) => [l.member_id, l]));
      return people.map((m: any) => {
        const l: any = byMember.get(m.id);
        return l ? { ...m, lend_stage: l.work_stage, lend_cap: l.cap, lend_reason: l.reason } : m;
      });
    })(),
    allRows<any>(() => supabase.from('status_rules').select('*').order('status')),
    allRows<any>(() => supabase.from('app_settings').select('*').order('key')),
    allRows<any>(() => supabase.from('list_values').select('*').order('sort_order')),
    allRows<any>(() => supabase.from('call_scripts').select('*').order('point_number')),
  ]);
  // Request 26: pickup state is computed in its own narrow view (~12k rows) rather than added to
  // lead_details, which every page load already recomputes. Merged onto the lead objects by id so
  // the table, filters and alerts can read it like any other field.
  // Joined on lead_ref (CB-xxxxx), not the UUID: LEAD_LIST_COLUMNS never selects `id`, so a merge
  // keyed on it matched nothing and every lead silently came back without a pickup state.
  const pickups = await allRows<any>(() => supabase.from('pickup_status')
    .select('lead_ref,pickup_state,days_left,last_request_at').neq('pickup_state', ''));
  const byLead = new Map(pickups.map((p: any) => [p.lead_ref, p]));
  const merged = leads.map((l: any) => {
    const p: any = byLead.get(l.lead_id);
    return p ? { ...l, pickup_state: p.pickup_state, pickup_days_left: p.days_left, pickup_last_request_at: p.last_request_at } : l;
  });
  return { leads: merged, members: members as any, rules: rules as any, settings: settings as any, lists: lists as any, scripts: scripts as any };
}

/**
 * Re-read a single lead from the computed view so all derived columns
 * (due state, priority, alerts, care dates, touch counts) stay authoritative
 * while the rest of the workspace is left untouched. A full record is needed
 * here because the drawer can edit every field.
 */
export async function loadOneLead(supabase: SupabaseClient, leadId: string): Promise<Lead | null> {
  const { data, error } = await supabase.from('lead_details').select('*').eq('lead_id', leadId).limit(1);
  if (error) throw error;
  return (data?.[0] as Lead) || null;
}

export function setting(settings: { key: string; value: string }[], key: string, fallback = '') {
  return settings.find(s => s.key === key)?.value ?? fallback;
}
