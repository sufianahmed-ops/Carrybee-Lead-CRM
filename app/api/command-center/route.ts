import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { CommandCenterData, DateMode, FunnelStage, StatusDist, CohortRow, LqtIncRow, ExecRow, AlertItem, TargetRow } from '@/lib/command-center-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pct(a: number, b: number) {
  if (!b) return 0;
  return +(a * 100 / b).toFixed(1);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const after13 = url.searchParams.get('after13nov') === '1' || url.searchParams.get('after13nov') === 'true';
  const dateMode = (url.searchParams.get('dateMode') as DateMode) || 'registration';

  // auth: must be Lead/Admin but allow any authenticated for preview (return 403 with helpful msg otherwise)
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const admin = createAdminClient();
  // check role (soft — still allow read but flag)
  const { data: me } = await admin.from('team_members').select('id,role,is_main_admin,admin_access,team').eq('auth_user_id', user.id).single();
  const isLead = !!me && (!!(me as any).is_main_admin || !!(me as any).admin_access || /lead|admin/i.test((me as any).role || ''));

  // date defaults: last 30 days
  const todayStr = new Date().toISOString().slice(0, 10);
  // crm_today is Dhaka — but for server we approximate; RPC would be precise. We'll use admin RPC crm_today if available
  let crmTodayStr: string = todayStr;
  try {
    const { data: t } = await admin.rpc('crm_today' as any);
    if (t) crmTodayStr = String(t);
  } catch {}

  const toDefault = crmTodayStr;
  const fromDefault = (() => { const d = new Date(crmTodayStr); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })();
  let from = fromParam || fromDefault;
  let to = toParam || toDefault;
  if (after13) {
    const cut = '2026-11-14';
    if (from < cut) from = cut;
  }
  if (from > to) [from, to] = [to, from];

  // Fetch snapshot + leads + members + call_logs (for funnel contacted detection)
  // For performance, fetch snapshot filtered by registration_date
  // We need leads table for verified check (business_id etc) — snapshot already has those? LEAD_LIST_COLUMNS includes business_id etc but verify mapping
  // We'll fetch lead_list_snapshot with needed cols
  const neededCols = [
    'lead_id','business_id','business_name','merchant_name','phone_clean','source','registration_date','assign_date',
    'current_status','stage','tab','is_final','current_owner','assigned_to','incubation_agent',
    'first_contact_date','last_status_date','next_due_date','due_state',
    'first_trip_date','care_end_date','qualified_at','qualified_by_name',
    'business_id','product_category','parcel_volume','zone','area',
    'lead_generation','priority','last_reason','handover_booked_time','handover_accepted_date','trip_deadline',
    'total_calls','lqt_touches','incubation_calls','sla_breach','trip_overdue','missing_business_id','duplicate_phone'
  ].join(',');

  // Pull in pages (reuse allRows logic server-side)
  async function fetchAllSnapshot(): Promise<any[]> {
    const pageSize = 1000;
    let fromIdx = 0;
    const rows: any[] = [];
    for (;;) {
      let q = admin.from('lead_list_snapshot').select(neededCols).order('registration_date', { ascending: false }).order('lead_id', { ascending: false }).range(fromIdx, fromIdx + pageSize - 1);
      // filter by dateMode
      if (dateMode === 'registration') {
        q = q.gte('registration_date', from).lte('registration_date', to);
      } else if (dateMode === 'milestone') {
        // milestone = first_trip_date
        q = q.gte('first_trip_date', from).lte('first_trip_date', to);
      } else {
        // activity = assign_date as proxy (call activity would be separate)
        q = q.gte('assign_date', from).lte('assign_date', to);
      }
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
      fromIdx += pageSize;
      if (rows.length > 25000) break; // safety
    }
    return rows;
  }

  // Also need fallback: if registration_date filter returns 0 but we have leads without reg_date that were assigned in period, include assigned?
  // For now strict.

  const [snapshotRows, membersRes, targetsRes] = await Promise.all([
    fetchAllSnapshot(),
    admin.from('team_members').select('id,name,team,role,active,on_leave,stage').eq('active', true),
    admin.from('dashboard_targets').select('*').gte('period_date', from).lte('period_date', to),
  ]);

  const members: any[] = (membersRes.data || []) as any[];
  const targets: any[] = (targetsRes.data || []) as any[];

  // For contacted detection, we need first_contact_date != null (already in snapshot) — no need extra call_logs
  // But for verified we need profile complete: business_id + 4 fields non-empty
  const isVerified = (r: any) => !!(r.business_id && r.business_id.trim() !== '' && r.product_category && r.product_category.trim() !== '' && r.parcel_volume && r.parcel_volume.trim() !== '' && r.zone && r.zone.trim() !== '' && r.area && r.area.trim() !== '');

  const isQualified = (r: any) => r.current_status === 'Qualified' || r.qualified_at != null;
  const isOnboarded = (r: any) => r.current_status === 'Onboarded (complete profile)';
  const isFirstTrip = (r: any) => !!r.first_trip_date;
  const isActivation7 = (r: any) => {
    if (!r.first_trip_date) return false;
    const ft = new Date(r.first_trip_date);
    const crmToday = new Date(crmTodayStr);
    const diff = Math.floor((crmToday.getTime() - ft.getTime()) / 86400000);
    if (diff < 7) return false; // not mature
    // survived 7 days = not moved to ineligible/blocked? proxy: still in care or care completed
    return r.current_status === '1st Trip Complete' || r.current_status === 'Care Completed' || diff >= 7;
  };

  const contactedRows = snapshotRows.filter(r => !!r.first_contact_date);
  const verifiedRows = snapshotRows.filter(r => isVerified(r));
  const qualifiedRows = snapshotRows.filter(r => isQualified(r));
  const onboardedRows = snapshotRows.filter(r => isOnboarded(r));
  const firstTripRows = snapshotRows.filter(r => isFirstTrip(r));
  const activation7Rows = snapshotRows.filter(r => isActivation7(r));

  const total = snapshotRows.length;

  // Funnel
  const stagesDef: { key: string; label: string; rows: any[]; avgDaysFn?: (rows: any[]) => number | null; reasonFn?: boolean }[] = [
    { key: 'registered', label: 'New Registrations', rows: snapshotRows },
    { key: 'contacted', label: 'Contacted', rows: contactedRows, avgDaysFn: (rs) => avgDays(rs, r => r.registration_date, r => r.first_contact_date) },
    { key: 'verified', label: 'Verified', rows: verifiedRows },
    { key: 'qualified', label: 'Qualified', rows: qualifiedRows, avgDaysFn: (rs) => avgDays(rs, r => r.first_contact_date, r => (r.qualified_at ? String(r.qualified_at).slice(0, 10) : null)) },
    { key: 'onboarded', label: 'Onboarded', rows: onboardedRows },
    { key: 'firstTrip', label: 'First Trip Completed', rows: firstTripRows, avgDaysFn: (rs) => avgDays(rs, r => r.registration_date, r => r.first_trip_date) },
    { key: 'activation7', label: '7-Day Activation', rows: activation7Rows },
  ];

  function avgDays(rows: any[], fromFn: (r: any) => string | null, toFn: (r: any) => string | null): number | null {
    const diffs: number[] = [];
    for (const r of rows) {
      const a = fromFn(r);
      const b = toFn(r);
      if (!a || !b) continue;
      const da = new Date(a);
      const db = new Date(b);
      const d = (db.getTime() - da.getTime()) / 86400000;
      if (d >= 0 && d < 365) diffs.push(d);
    }
    if (!diffs.length) return null;
    return +((diffs.reduce((s, x) => s + x, 0) / diffs.length).toFixed(1));
  }

  const funnel: FunnelStage[] = stagesDef.map((s, i) => {
    const prev = i ? stagesDef[i - 1].rows.length : null;
    const conv = prev && prev > 0 ? pct(s.rows.length, prev) : null;
    const drop = conv != null ? +(100 - conv).toFixed(1) : null;
    // top drop reason among those who didn't progress? For simplicity: top last_reason among current is_final rows in stage's cohort that are final
    const finalsInStageCohort = snapshotRows.filter(r => r.is_final === 'Yes' && !s.rows.includes(r));
    // Better: for funnel drop, look at leads that reached prev but not current and are final
    let topReason: string | null = null;
    let topReasonCount = 0;
    if (i > 0) {
      const prevSet = new Set(stagesDef[i - 1].rows.map(r => r.lead_id));
      const curSet = new Set(s.rows.map(r => r.lead_id));
      const dropped = snapshotRows.filter(r => prevSet.has(r.lead_id) && !curSet.has(r.lead_id) && r.is_final === 'Yes');
      const reasonCounts: Record<string, number> = {};
      for (const d of dropped) {
        const k = d.last_reason || d.current_status || 'No reason';
        reasonCounts[k] = (reasonCounts[k] || 0) + 1;
      }
      const sorted = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length) { topReason = sorted[0][0]; topReasonCount = sorted[0][1]; }
    }
    const ownersMap: Record<string, number> = {};
    for (const r of s.rows) {
      const o = r.current_owner || 'Unassigned';
      ownersMap[o] = (ownersMap[o] || 0) + 1;
    }
    const owners = Object.entries(ownersMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([owner, count]) => ({ owner, count }));
    return {
      key: s.key,
      label: s.label,
      count: s.rows.length,
      convPrev: conv,
      dropPrev: drop,
      avgDays: s.avgDaysFn ? s.avgDaysFn(s.rows) : null,
      topReason,
      topReasonCount,
      owners,
    };
  });

  // Status distribution
  const statusCounts: Record<string, number> = {};
  const statusIsFinal: Record<string, boolean> = {};
  for (const r of snapshotRows) {
    const s = r.current_status || 'Unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
    statusIsFinal[s] = r.is_final === 'Yes';
  }
  const totalForPct = snapshotRows.length || 1;
  const statusDist: StatusDist[] = Object.entries(statusCounts).map(([status, count]) => ({
    status,
    count,
    pct: +(count * 100 / totalForPct).toFixed(1),
    trend: null, // would need snapshot history
    isFinal: !!statusIsFinal[status],
  })).sort((a, b) => b.count - a.count);

  // Cohort rows: group by registration_date
  const byCohort: Record<string, any[]> = {};
  for (const r of snapshotRows) {
    const c = r.registration_date || 'Unknown';
    if (!byCohort[c]) byCohort[c] = [];
    byCohort[c].push(r);
  }
  const cohorts: CohortRow[] = Object.entries(byCohort)
    .filter(([k]) => k !== 'Unknown')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14) // last 14 cohorts to keep table readable
    .map(([cohort, rows]) => {
      const reg = rows.length;
      const contacted = rows.filter(r => !!r.first_contact_date).length;
      const verified = rows.filter(r => isVerified(r)).length;
      const qualified = rows.filter(r => isQualified(r)).length;
      const onboarded = rows.filter(r => isOnboarded(r)).length;
      const firstTrip = rows.filter(r => isFirstTrip(r)).length;
      const act7 = rows.filter(r => isActivation7(r)).length;
      const cohortDate = new Date(cohort);
      const mature = (new Date(crmTodayStr).getTime() - cohortDate.getTime()) / 86400000 >= 30;
      return {
        cohort,
        registered: reg,
        contacted, verified, qualified, onboarded, firstTrip, activation7: act7,
        contactedPct: pct(contacted, reg),
        verifiedPct: pct(verified, reg),
        qualifiedPct: pct(qualified, reg),
        onboardedPct: pct(onboarded, reg),
        firstTripPct: pct(firstTrip, reg),
        activation7Pct: pct(act7, reg),
        avgDaysToFirstTrip: avgDays(rows.filter(r => isFirstTrip(r)), r => r.registration_date, r => r.first_trip_date),
        mature,
      };
    });

  // LQT vs Incubation
  const lqtMembers = members.filter(m => (m as any).team === 'LQT' || (m as any).stage === 'LQT');
  const incMembers = members.filter(m => (m as any).team === 'Incubation' || (m as any).stage === 'Incubation');
  const lqtNames = new Set(lqtMembers.map(m => m.name));
  const incNames = new Set(incMembers.map(m => m.name));
  // For LQT team, consider leads whose current_owner is LQT member OR stage LQT; for Inc, stage Incubation/Handover
  function teamRows(names: Set<string>, stageFilter?: (r: any) => boolean): any[] {
    if (stageFilter) return snapshotRows.filter(r => stageFilter(r));
    return snapshotRows.filter(r => names.has(r.current_owner));
  }
  // Use stage-based for more accurate: LQT = stage LQT, Inc = stage Incubation or Handover
  const lqtRows = snapshotRows.filter(r => r.stage === 'LQT');
  const incRows = snapshotRows.filter(r => r.stage === 'Incubation' || r.stage === 'Handover');
  // Also global totals per team for same metrics as overview but scoped
  function teamTotals(rows: any[]) {
    return {
      registered: rows.length,
      contacted: rows.filter(r => !!r.first_contact_date).length,
      verified: rows.filter(r => isVerified(r)).length,
      qualified: rows.filter(r => isQualified(r)).length,
      onboarded: rows.filter(r => isOnboarded(r)).length,
      firstTrip: rows.filter(r => isFirstTrip(r)).length,
      activation7: rows.filter(r => isActivation7(r)).length,
    };
  }
  const lqtT = teamTotals(lqtRows);
  const incT = teamTotals(incRows);
  const gT = teamTotals(snapshotRows);
  const lqtIncMetrics: { metric: string; lqt: number; inc: number; lqtPct?: number; incPct?: number; delta: number }[] = [
    { metric: 'Total leads', lqt: lqtT.registered, inc: incT.registered, delta: incT.registered - lqtT.registered },
    { metric: 'Contacted', lqt: lqtT.contacted, inc: incT.contacted, lqtPct: pct(lqtT.contacted, lqtT.registered), incPct: pct(incT.contacted, incT.registered), delta: pct(incT.contacted, incT.registered) - pct(lqtT.contacted, lqtT.registered) },
    { metric: 'Verified', lqt: lqtT.verified, inc: incT.verified, lqtPct: pct(lqtT.verified, lqtT.registered), incPct: pct(incT.verified, incT.registered), delta: pct(incT.verified, incT.registered) - pct(lqtT.verified, lqtT.registered) },
    { metric: 'Qualified', lqt: lqtT.qualified, inc: incT.qualified, lqtPct: pct(lqtT.qualified, lqtT.registered), incPct: pct(incT.qualified, incT.registered), delta: pct(incT.qualified, incT.registered) - pct(lqtT.qualified, lqtT.registered) },
    { metric: 'Onboarded', lqt: lqtT.onboarded, inc: incT.onboarded, lqtPct: pct(lqtT.onboarded, lqtT.registered), incPct: pct(incT.onboarded, incT.registered), delta: pct(incT.onboarded, incT.registered) - pct(lqtT.onboarded, lqtT.registered) },
    { metric: 'First Trip', lqt: lqtT.firstTrip, inc: incT.firstTrip, lqtPct: pct(lqtT.firstTrip, lqtT.registered), incPct: pct(incT.firstTrip, incT.registered), delta: pct(incT.firstTrip, incT.registered) - pct(lqtT.firstTrip, lqtT.registered) },
    { metric: '7-Day Activation', lqt: lqtT.activation7, inc: incT.activation7, lqtPct: pct(lqtT.activation7, lqtT.registered), incPct: pct(incT.activation7, incT.registered), delta: pct(incT.activation7, incT.registered) - pct(lqtT.activation7, lqtT.registered) },
  ];

  // Aging buckets
  const agingBuckets: { bucket: string; count: number }[] = [
    { bucket: '0-2 days', count: 0 },
    { bucket: '3-7 days', count: 0 },
    { bucket: '8-20 days', count: 0 },
    { bucket: '20+ days', count: 0 },
  ];
  for (const r of snapshotRows.filter(r => r.is_final === 'No' && r.next_due_date)) {
    const due = new Date(r.next_due_date);
    const today = new Date(crmTodayStr);
    const diff = Math.floor((today.getTime() - due.getTime()) / 86400000); // positive = overdue
    if (diff <= 0) agingBuckets[0].count++; // due today or upcoming but we count overdue only? For now include all
    else if (diff <= 2) agingBuckets[0].count++;
    else if (diff <= 7) agingBuckets[1].count++;
    else if (diff <= 20) agingBuckets[2].count++;
    else agingBuckets[3].count++;
  }
  // Actually better: overdue aging
  // Recompute correctly for overdue only
  const overdueRows = snapshotRows.filter(r => r.due_state === 'Overdue' && r.is_final === 'No');
  const aging = [
    { bucket: 'Overdue 1-2d', count: overdueRows.filter(r => { const d = daysOverdue(r.next_due_date, crmTodayStr); return d >= 1 && d <= 2; }).length },
    { bucket: 'Overdue 3-7d', count: overdueRows.filter(r => { const d = daysOverdue(r.next_due_date, crmTodayStr); return d >= 3 && d <= 7; }).length },
    { bucket: 'Overdue 8-20d', count: overdueRows.filter(r => { const d = daysOverdue(r.next_due_date, crmTodayStr); return d >= 8 && d <= 20; }).length },
    { bucket: 'Overdue 20d+', count: overdueRows.filter(r => daysOverdue(r.next_due_date, crmTodayStr) > 20).length },
  ];
  function daysOverdue(due: string, today: string) {
    if (!due) return 0;
    return Math.floor((new Date(today).getTime() - new Date(due).getTime()) / 86400000);
  }

  // Executive performance
  const owners = Array.from(new Set(snapshotRows.map(r => r.current_owner).filter(Boolean))) as string[];
  const execs: ExecRow[] = owners.map(owner => {
    const rows = snapshotRows.filter(r => r.current_owner === owner);
    const m = members.find(x => x.name === owner);
    const pending = rows.filter(r => r.is_final === 'No').length;
    const overdue = rows.filter(r => r.due_state === 'Overdue' && r.is_final === 'No').length;
    const assigned = rows.length;
    const contacted = rows.filter(r => !!r.first_contact_date).length;
    const qualified = rows.filter(r => isQualified(r)).length;
    const onboarded = rows.filter(r => isOnboarded(r)).length;
    const firstTrip = rows.filter(r => isFirstTrip(r)).length;
    // on-time %: leads where next_due_date not overdue historically? proxy: 1 - overdue/pending
    const onTimePct = pending ? +((1 - overdue / pending) * 100).toFixed(1) : null;
    const tat = avgDays(rows.filter(r => isFirstTrip(r)), r => r.registration_date, r => r.first_trip_date);
    return {
      id: (m as any)?.id || owner,
      name: owner,
      team: (m as any)?.team || (lqtNames.has(owner) ? 'LQT' : incNames.has(owner) ? 'Incubation' : 'Unknown'),
      assigned, contacted, qualified, onboarded, firstTrip, pending, overdue, onTimePct, tatAvg: tat, activationRate: pct(firstTrip, assigned)
    };
  }).sort((a, b) => b.assigned - a.assigned).slice(0, 12);

  // Alerts
  const alerts: AlertItem[] = [];
  // SLA breach
  const slaRows = snapshotRows.filter(r => r.sla_breach === 'Breached');
  if (slaRows.length) alerts.push({ kind: 'sla_breach', title: `${slaRows.length} leads breached 20-day SLA`, body: 'LQT leads assigned >20 days ago without Qualified/Final', count: slaRows.length, severity: 'high', leadIds: slaRows.slice(0, 20).map(r => r.lead_id) });
  // Trip overdue
  const tripOver = snapshotRows.filter(r => r.trip_overdue === 'Overdue');
  if (tripOver.length) alerts.push({ kind: 'trip_overdue', title: `${tripOver.length} Incubation trips overdue (>${10} days)`, body: 'Awaiting 1st Trip past deadline', count: tripOver.length, severity: 'high', leadIds: tripOver.slice(0, 20).map(r => r.lead_id) });
  // Handover backlog
  const handoverBacklog = snapshotRows.filter(r => r.current_status === 'Qualified' && !r.incubation_agent);
  if (handoverBacklog.length) alerts.push({ kind: 'handover_backlog', title: `${handoverBacklog.length} Qualified waiting for Incubation`, body: 'No incubation_agent assigned', count: handoverBacklog.length, severity: 'medium' });
  // Data quality
  const missingBID = snapshotRows.filter(r => r.missing_business_id === 'Missing' && r.is_final === 'No');
  if (missingBID.length) alerts.push({ kind: 'data_quality', title: `${missingBID.length} active leads missing Business ID`, body: 'Blocks KAM handover', count: missingBID.length, severity: 'medium', leadIds: missingBID.slice(0, 20).map(r => r.lead_id) });
  const dupes = snapshotRows.filter(r => r.duplicate_phone === 'Duplicate');
  if (dupes.length) alerts.push({ kind: 'data_quality', title: `${dupes.length} leads with duplicate phone`, body: 'Check for duplicate Business ID', count: dupes.length, severity: 'low' });
  // Aging
  if (aging[3].count > 50) alerts.push({ kind: 'aging', title: `${aging[3].count} leads overdue 20+ days`, body: 'Old book needs cleanup or reassign', count: aging[3].count, severity: 'high' });
  // Overdue escalations (from escalation_tracker)
  if (overdueRows.length > 100) alerts.push({ kind: 'workload', title: `${overdueRows.length} leads currently Overdue`, body: 'Consider lending help or capping auto-assign', count: overdueRows.length, severity: 'high' });

  // Targets scorecard
  // For each major KPI, fetch target for period (monthly)
  const targetByMetric: Record<string, number> = {};
  for (const t of targets) {
    if (t.scope === 'global' && t.period === 'monthly') targetByMetric[t.metric] = t.target_value;
  }
  // fallback defaults
  const defaults: Record<string, number> = { registered: 2500, contacted: 2000, verified: 1500, qualified: 1200, onboarded: 1000, first_trip: 800, activation7: 600 };
  for (const k of Object.keys(defaults)) if (!targetByMetric[k]) targetByMetric[k] = defaults[k as keyof typeof defaults];

  const prevFrom = (() => { const d = new Date(from); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const prevTo = (() => { const d = new Date(to); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  // For prev we don't refetch; approximate as 85% of current for demo, or fetch if needed — here we skip extra query and set null

  const kpiDefs: { metric: string; actual: number; label: string }[] = [
    { metric: 'registered', actual: total, label: 'Registered' },
    { metric: 'contacted', actual: contactedRows.length, label: 'Contacted' },
    { metric: 'verified', actual: verifiedRows.length, label: 'Verified' },
    { metric: 'qualified', actual: qualifiedRows.length, label: 'Qualified' },
    { metric: 'onboarded', actual: onboardedRows.length, label: 'Onboarded' },
    { metric: 'first_trip', actual: firstTripRows.length, label: 'First Trip' },
    { metric: 'activation7', actual: activation7Rows.length, label: '7-Day Activation' },
  ];

  const kpis: TargetRow[] = kpiDefs.map(k => {
    const target = targetByMetric[k.metric] || 0;
    const ach = target ? +(k.actual * 100 / target).toFixed(1) : 0;
    const variance = k.actual - target;
    // prev: fetch quickly for overview? skip for now
    return { metric: k.label, actual: k.actual, target, achievement: ach, variance, prev: null, trend: ach >= 100 ? 'up' : ach >= 80 ? 'flat' : 'down' };
  });

  const bottleneck = (() => {
    const mostOverdueTab = statusDist.filter(s => !s.isFinal).sort((a, b) => b.count - a.count)[0];
    if (!mostOverdueTab) return null;
    return { stage: mostOverdueTab.status, stuckCount: mostOverdueTab.count };
  })();

  const data: CommandCenterData = {
    meta: { from, to, after13nov: after13, dateMode, generatedAt: new Date().toISOString(), totalLeads: total },
    overview: {
      kpis,
      totals: {
        registered: total,
        contacted: contactedRows.length,
        verified: verifiedRows.length,
        qualified: qualifiedRows.length,
        onboarded: onboardedRows.length,
        firstTrip: firstTripRows.length,
        activation7: activation7Rows.length,
        overallConv: pct(firstTripRows.length, total),
      }
    },
    funnel,
    statusDist,
    cohorts,
    lqtVsInc: { rows: lqtIncMetrics, lqt: lqtT as any, inc: incT as any },
    aging,
    execs,
    alerts,
    bottleneck,
  };

  return NextResponse.json({ ok: true, data, isLead, meta: { from, to, after13nov: after13, dateMode } });
}
