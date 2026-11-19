'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, PhoneCall, Workflow, List, Inbox, Heart, XCircle, Badge, Clock3, BookOpen, Database, Search, RefreshCw, Plus, Menu, LogOut, Users, ChevronRight, Sparkles, Settings, CheckCircle2, BarChart3, FileSpreadsheet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { loadBootstrap, loadBootstrapMeta, loadOneLead, setting } from '@/lib/data';
import { Notifications } from './notifications';
import { MissingBusinessId } from './missing-business-id';
import { Package } from 'lucide-react';
import type { Bootstrap, Lead, Member } from '@/lib/types';
import { unique } from '@/lib/utils';
import { OLD_ASSIGNMENT_BUSINESS_IDS } from '@/lib/assignment-exclusions';
import { ThemeButton } from './theme-button';
import { Dashboard } from './dashboard';
import { Rulebook } from './rulebook';
import type { DashboardData } from './dashboard';
import { LeadTable } from './lead-table';
import { LeadDrawer } from './lead-drawer';
import { AddLead } from './add-lead';
import { TeamAdmin } from './team-admin';
import { SyncHealthBanner } from './sync-health-banner';
import { SyncLog } from './sync-log';
import { OverdueEscalationBanner } from './overdue-escalation-banner';
import { CommandCenter } from './command-center/CommandCenter';
import { Reports } from './reports/Reports';

// Registration date is shown in every working queue (Follow Up, CNR, New Leads,
// New to LQT, Old follow-ups, Care Period, Incubation Queue, Handover Inbox and
// the Onboarding tracker) so age of a lead is visible without opening it.
const COLS = {
  lqt: ['lead_id','lead_generation','business_name','merchant_name','phone_clean','source','registration_date','current_status','last_reason','lqt_touches','next_due_date','due_state','current_owner','alert'],
  inc: ['lead_id','business_name','merchant_name','phone_clean','registration_date','current_status','current_owner','handover_booked_time','handover_call_state','trip_deadline','next_due_date','due_state','alert'],
  care: ['lead_id','business_name','phone_clean','registration_date','current_owner','first_order_date','pickup_state','care_end_date','care_days_left','last_reason','next_due_date','due_state'],
  onb: ['lead_id','business_id','business_name','phone_clean','registration_date','current_status','qualified_by_name','onboarded_form','first_trip_date','first_trip_cid','pickup_miss','current_owner'],
  // who handed the lead over, so Incubation can see whose handover it was
  incQ: ['lead_id','business_name','merchant_name','phone_clean','registration_date','current_status','current_owner','qualified_by_name','qualified_at','handover_booked_time','handover_call_state','trip_deadline','pickup_state','next_due_date','due_state','alert'],
  final: ['lead_id','business_name','merchant_name','phone_clean','source','registration_date','current_status','last_reason','last_status_date','current_owner'],
  all: ['lead_id','lead_generation','business_id','business_name','phone_clean','source','registration_date','current_status','stage','current_owner','next_due_date','due_state','alert'],
  qualified: ['lead_id','business_name','merchant_name','phone_clean','registration_date','current_status','stage','current_owner','qualified_at','next_due_date'],
  qualifiedTeam: ['lead_id','business_name','merchant_name','phone_clean','registration_date','current_status','stage','qualified_by_name','qualified_at','current_owner'],
};
type View = { id: string; title: string; group: string; icon: LucideIcon; columns?: string[]; filter?: (l: Lead) => boolean; final?: boolean; special?: string; sort?: (a: Lead, b: Lead) => number };

export default function CRM() {
  const router = useRouter();
  const supabase = createClient();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [userId, setUserId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState('dash');
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('mine');
  const [source, setSource] = useState('');
  const [generation, setGeneration] = useState('');
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashDays, setDashDays] = useState(30);
  const [dashTeam, setDashTeam] = useState('');
  const [dashFrom, setDashFrom] = useState('');
  const [dashTo, setDashTo] = useState('');
  const [dashLive, setDashLive] = useState(false);
  const [statusPick, setStatusPick] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [assignFrom, setAssignFrom] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [registrationFrom, setRegistrationFrom] = useState('');
  const [registrationTo, setRegistrationTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roundRobinAgents, setRoundRobinAgents] = useState<string[]>([]);
  const [cap, setCap] = useState('30');
  const [handover, setHandover] = useState<{ agents: any[]; cap: number; waiting: number; unassigned: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fromQueue, setFromQueue] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [toast, setToast] = useState('');
  const [lastSync, setLastSync] = useState('');
  // --- Server-paginated Fix C (FREE IO fix) ---
  const [leadsRows, setLeadsRows] = useState<Lead[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [countsMap, setCountsMap] = useState<Record<string,number>>({});
  const [useServer, setUseServer] = useState(true);
  // --- Persist filters + view (localStorage) ---
  const FILTER_KEY = 'crm:filters:v2';
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTER_KEY); if (!raw) return;
      const f = JSON.parse(raw);
      if (f.query !== undefined) setQuery(f.query); if (f.owner !== undefined) setOwner(f.owner);
      if (f.source !== undefined) setSource(f.source); if (f.generation !== undefined) setGeneration(f.generation);
      if (f.statusPick !== undefined) setStatusPick(f.statusPick); if (f.businessId !== undefined) setBusinessId(f.businessId);
      if (f.assignFrom !== undefined) setAssignFrom(f.assignFrom); if (f.assignTo !== undefined) setAssignTo(f.assignTo);
      if (f.registrationFrom !== undefined) setRegistrationFrom(f.registrationFrom); if (f.registrationTo !== undefined) setRegistrationTo(f.registrationTo);
      if (f.statusFilter !== undefined) setStatusFilter(f.statusFilter); if (f.viewId) setViewId(f.viewId);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ query, owner, source, generation, statusPick, businessId, assignFrom, assignTo, registrationFrom, registrationTo, statusFilter, viewId })); } catch {}
  }, [query, owner, source, generation, statusPick, businessId, assignFrom, assignTo, registrationFrom, registrationTo, statusFilter, viewId]);
  const me = data?.members.find(m => m.auth_user_id === userId) || null;
  const isLead = !!me && (/lead|admin/i.test(me.role) || !!me.admin_access || !!me.is_main_admin);

  const refresh = useCallback(async (showBusy = true) => {
    if (showBusy) setBusy(true);
    try {
      // Try meta-only (Fix C) — 5 small tables, not 12k leads. Falls back to full load if it fails.
      let fresh: Bootstrap | null = null;
      try {
        const meta = await loadBootstrapMeta(supabase);
        fresh = { ...meta, leads: [] } as Bootstrap;
        setUseServer(true);
      } catch {
        fresh = await loadBootstrap(supabase);
        setUseServer(false);
      }
      setData(fresh); setLastSync(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); setLoadError('');
      return fresh;
    } catch (e: any) { setLoadError(e.message || String(e)); throw e; }
    finally { if (showBusy) setBusy(false); }
  }, []);
  // Everyone else's saves land in lead_list_snapshot via pg_cron (every 2 minutes).
  // Rather than blindly reloading 12,463 rows, ask the snapshot for its newest
  // last_updated — a single indexed number — and only reload when it has moved.
  const lastStamp = useRef('');
  const probe = useCallback(async () => {
    try {
      const { data: r, error } = await supabase
        .from('lead_list_snapshot').select('last_updated')
        .order('last_updated', { ascending: false }).limit(1);
      if (error) return false;
      const stamp = (r?.[0] as any)?.last_updated || '';
      if (!stamp) return false;
      if (lastStamp.current === stamp) return false;
      const first = lastStamp.current === '';
      lastStamp.current = stamp;
      return !first;   // first probe just records the baseline
    } catch { return false; }
  }, [supabase]);

  // Rebuild the snapshot straight after a save so the next probe (within 120 s)
  // carries this change to everyone else instead of waiting for the cron tick.
  const nudgeSnapshot = useCallback(async () => {
    try {
      const { data: stamp } = await supabase
        .from('lead_list_snapshot').select('last_updated')
        .order('last_updated', { ascending: false }).limit(1);
      await supabase.rpc('refresh_snapshot_if_stale');
      const { data: after } = await supabase
        .from('lead_list_snapshot').select('last_updated')
        .order('last_updated', { ascending: false }).limit(1);
      const s = (after?.[0] as any)?.last_updated || (stamp?.[0] as any)?.last_updated || '';
      if (s) lastStamp.current = s;
    } catch { /* the cron will catch up on its own */ }
  }, [supabase]);

  const loadDash = useCallback(async (d: number, from?: string, to?: string) => {
    setDashLoading(true);
    try {
      const params: any = { p_days: d };
      if (from) params.p_from = from;
      if (to) params.p_to = to;
      const { data: rpc, error } = await supabase.rpc('dashboard_stats', params);
      if (error) throw error;
      setDash(rpc as unknown as DashboardData);
    } catch (e: any) {
      setToast(`Dashboard: ${e.message || e}`);
    } finally { setDashLoading(false); }
  }, []);
  // Server-paginated leads fetch — replaces 12k client download with 50-row pages (Fix C IO saver)
  const fetchLeads = useCallback(async () => {
    if (!data || !me || !useServer) return;
    // dashboard/flow/reports/nobid/team handle leads differently — skip server fetch for them
    const serverViews = new Set(['all','oldbook','closed','new-lqt','new-gen','parked','pickup','qualified','my-qualified','onb','nobid']);
    const isTab = viewId?.startsWith('tab:');
    const isServerView = isTab || serverViews.has(viewId || '') || viewId === 'queue';
    if (!isServerView) return;
    setRowsLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('viewId', viewId);
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      if (owner) sp.set('owner', owner);
      if (me?.name) sp.set('meName', me.name);
      if (source) sp.set('source', source);
      if (generation) sp.set('generation', generation);
      if (statusPick) sp.set('statusPick', statusPick);
      if (businessId) sp.set('businessId', businessId);
      if (assignFrom) sp.set('assignFrom', assignFrom);
      if (assignTo) sp.set('assignTo', assignTo);
      if (registrationFrom) sp.set('registrationFrom', registrationFrom);
      if (registrationTo) sp.set('registrationTo', registrationTo);
      if (statusFilter) sp.set('statusFilter', statusFilter);
      if (query.trim()) sp.set('query', query.trim());
      const res = await fetch(`/api/leads?${sp.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'leads fetch failed');
      setLeadsRows(j.rows || []);
      setTotalCount(j.count || 0);
    } catch (e: any) {
      // Fallback to client mode if server fails (DB throttled)
    } finally { setRowsLoading(false); }
  }, [data, me, useServer, viewId, owner, source, generation, statusPick, businessId, assignFrom, assignTo, registrationFrom, registrationTo, statusFilter, query, page, pageSize]);

  const fetchCounts = useCallback(async () => {
    if (!data || !me || !useServer) return;
    try {
      const res = await fetch('/api/leads/counts');
      const j = await res.json();
      if (j.counts) setCountsMap(j.counts);
    } catch {}
  }, [data, me, useServer]);

  // Reset to page 1 when filters/view change
  useEffect(() => { setPage(1); }, [viewId, owner, source, generation, statusPick, businessId, assignFrom, assignTo, registrationFrom, registrationTo, statusFilter, query]);
  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  // helper to reload with current calendar
  const reloadDash = useCallback(() => loadDash(dashDays, dashFrom || undefined, dashTo || undefined), [dashDays, dashFrom, dashTo, loadDash]);
  useEffect(() => { if (data) loadDash(dashDays, dashFrom || undefined, dashTo || undefined).catch(() => {}); }, [data, dashDays, dashFrom, dashTo, loadDash]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: auth }) => {
      if (!auth.user) return router.replace('/login');
      setUserId(auth.user.id);
      try { await refresh(); } catch { /* displayed below */ }
    });
  }, []);
  useEffect(() => {
    if (!me) return;
    try { if (localStorage.getItem(FILTER_KEY)) return; } catch {}
    setOwner(isLead ? '' : 'mine');
  }, [me?.id]);

  // Poll the snapshot every 120 s. Reload only when it actually changed.
  useEffect(() => {
    if (!data) return;
    probe();
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      if (await probe()) refresh(false).catch(() => {});
    }, 120000);
    return () => clearInterval(t);
  }, [data !== null, probe, refresh]);

  // Coming back to a tab that was left open all morning: check immediately.
  useEffect(() => {
    const onShow = async () => {
      if (document.visibilityState !== 'visible') return;
      if (await probe()) refresh(false).catch(() => {});
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, [probe, refresh]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  const views = useMemo<View[]>(() => {
    if (!data) return [];
    const tabsFor = (stages: string[]) => unique(data.rules.filter(r => stages.includes(r.stage)).map(r => r.tab));
    // Request 19: the sidebar was carrying duplicate views (Follow Up vs Old follow-ups,
    // New Leads vs New to LQT, Handed to me inside the Incubation Queue), a tab that can
    // never fill (Callback requested — the rulebook parks a lead as 1st Follow Up Need), and
    // admin-only cleanup sitting in the agents' work area. Those are folded away here. The
    // rulebook still has every status, so nothing is lost — only the shortcuts.
    const mine = (l: Lead) => l.current_owner === me?.name;
    const open = (l: Lead) => l.is_final !== 'Yes';
    const output: View[] = [
      { id: 'dash', title: 'Dashboard', group: '', icon: LayoutDashboard, special: 'dash' },
      { id: 'queue', title: 'My call queue', group: '', icon: PhoneCall, special: 'queue' },
      { id: 'flow', title: 'How it works', group: '', icon: Workflow, special: 'flow' },
    ];

    // ---- What to call now -------------------------------------------------
    tabsFor(['LQT']).filter(tab => tab !== 'Callback requested').forEach(tab => output.push({
      id: `tab:${tab}`, title: tab === 'Follow Up' ? 'Follow Up (incl. old book)' : tab,
      group: 'Call today', icon: List, columns: COLS.lqt, filter: l => l.tab === tab,
    }));
    // The old book I own and have not closed — the list that had no home before. Sorted by
    // due date by default, so it answers "what do I call now" instead of "here are 2,727 rows".
    // Old book = the inherited LQT-era book. Incubation work has its own queue, so a lead that
    // has moved into Incubation is not repeated here.
    output.push({
      id: 'oldbook', title: 'Old book — due now', group: 'Call today', icon: Clock3, columns: COLS.lqt,
      filter: l => l.lead_generation === 'Old' && l.stage === 'LQT' && open(l),
    });
    // Parked by "Lead asked for a later call" — folded in from the dead Callback requested tab.
    output.push({
      id: 'parked', title: 'Callback requested', group: 'Call today', icon: PhoneCall, columns: COLS.lqt,
      filter: l => !!l.callback_hold && open(l),
    });
    // Request 25: a blank Business ID blocks qualification, so it is LQT's own work — an LQT
    // agent sees the leads they own, an LQT Lead the whole book. It used to sit under
    // Administration, where the two agents who actually own these 33 leads could not see it.
    // Request 25: a blank Business ID blocks qualification, so it is LQT's own work — the two LQT
    // agents see the leads they own, the Lead/Admin sees the whole LQT book. LQT has no Lead of
    // its own, so oversight falls to whoever holds Lead or Admin (Sazzad, Admin) as well.
    // It used to sit under Administration, where the agents who actually own these leads could
    // not see it at all.
    if (me?.team === 'LQT' || isLead) output.push({ id: 'nobid', title: 'Missing Business ID', group: 'Call today', icon: Badge, special: 'nobid' });
    if (me?.team !== 'Incubation') output.push({ id: 'new-gen', title: 'New to LQT', group: 'Call today', icon: Sparkles, columns: COLS.lqt, filter: l => l.lead_generation === 'New' && open(l) });
    // An Incubation member never qualifies a lead, so "Qualified by me" is permanently empty
    // for them; and deals leaving Incubation never return to the LQT book.
    if (me?.team !== 'Incubation') output.push({ id: 'my-qualified', title: 'Qualified by me', group: 'Handovers', icon: CheckCircle2, columns: COLS.qualified, filter: l => !!l.qualified_by && (l.qualified_by === me?.id || l.qualified_by_name === me?.name) });

    // ---- Handovers and Incubation ----------------------------------------
    tabsFor(['Handover','Incubation']).forEach(tab => output.push({ id: `tab:${tab}`, title: tab, group: 'Handovers and Incubation', icon: tab === 'Handover Inbox' ? Inbox : tab === 'Care Period' ? Heart : List, columns: tab === 'Care Period' ? COLS.care : COLS.incQ, filter: l => l.tab === tab }));
    // Request 26: a pickup request is cancelled automatically 3 days after it is raised, so the
    // only moment anyone can save one is day 2. This list is ordered by expiry, not by age.
    if (me?.team === 'Incubation') output.push({ id: 'pickup', title: 'Pickup check', group: 'Handovers and Incubation', icon: Package, columns: [...COLS.inc.slice(0, 4), 'pickup_state', ...COLS.inc.slice(4)], filter: l => l.pickup_state === 'LastChance' || l.pickup_state === 'Pending' || l.pickup_state === 'Cancelled', sort: (a, b) => {
      // Expiring today first, then still open, then already lost. Within a state the request
      // closest to expiry comes first, because that is the one worth a call.
      const rank = (l: Lead) => l.pickup_state === 'LastChance' ? 0 : l.pickup_state === 'Pending' ? 1 : 2;
      return rank(a) - rank(b) || String(a.pickup_last_request_at || '').localeCompare(String(b.pickup_last_request_at || ''));
    } });
    if (isLead) output.push({ id: 'qualified', title: 'Qualified (team)', group: 'Handovers and Incubation', icon: CheckCircle2, columns: COLS.qualifiedTeam, filter: l => !!l.qualified_by });

    // ---- Everything closed, behind one filter ----------------------------
    if (tabsFor(['Final']).length) output.push({ id: 'closed', title: 'Closed leads', group: 'Records', icon: XCircle, columns: COLS.final, filter: l => l.stage === 'Final', final: true });
    output.push({ id: 'all', title: 'All leads', group: 'Records', icon: Database, columns: COLS.all, filter: () => true });
    output.push({ id: 'onb', title: 'Onboarding tracker', group: 'Records', icon: Badge, columns: COLS.onb, filter: l => l.in_onboarding_tracker === 'Yes' });
    output.push({ id: 'script', title: 'Call script', group: 'Records', icon: BookOpen, special: 'script' });

    // ---- Administration (Lead / Admin only) ------------------------------
    if (isLead) {
      output.push({ id: 'reports', title: 'Reports — CSV Export', group: 'Administration', icon: FileSpreadsheet, special: 'reports' });
      output.push({ id: 'command-center', title: 'Command Center', group: 'Administration', icon: BarChart3, special: 'command-center' });
      output.push({ id: 'new-lqt', title: 'New LQT assignments', group: 'Administration', icon: List, columns: COLS.all, filter: l => l.lead_generation === 'New' && l.source === 'Self Registered' && !l.current_owner && !!l.registration_date && !OLD_ASSIGNMENT_BUSINESS_IDS.has(String(l.business_id || '').trim()) });
      output.push({ id: 'sync-log', title: 'Sync health', group: 'Administration', icon: Database, special: 'sync-log' });
      output.push({ id: 'rulebook', title: 'Follow-up rulebook', group: 'Administration', icon: Settings, special: 'rulebook' });
      output.push({ id: 'team', title: 'Team & system', group: 'Administration', icon: Users, special: 'team' });
    }
    return output;
  }, [data, isLead]);
  const currentView = views.find(v => v.id === viewId) || views[0];
  const currentLead = (useServer ? leadsRows : data?.leads)?.find(l => l.lead_id === openId) || null;

  // The stage a person actually works in today (a lending overrides their home team).
  const myStage = me ? (me.lend_stage || me.stage || me.team) : '';
  function queueRows(sourceData = data) {
    if (useServer) return leadsRows; // paginated queue from server

    if (!sourceData || !me) return [];
    // Request 17: the queue is stage-aware. Priority order (Phase 1): new-generation work
    // always outranks the old book — 0 handover overdue | 1 NEW first call late | 2 NEW due
    // | 3 NEW fresh | 4 OLD. An Incubation agent's queue is their Incubation work, not the
    // LQT-era book they inherited, so a lead that is due today or overdue is always shown.
    // An Incubation agent's queue is their Incubation work and nothing else: the LQT-era book
    // they inherited before the team split (thousands of rows) no longer fills it. Nothing is
    // hidden from them — those leads stay in Old follow-ups and the stage lists.
    // Unified sort: most recent registration first — today's data visible without scrolling
    const byRegDesc = (a: Lead, b: Lead) => {
      const da = a.registration_date || '';
      const db = b.registration_date || '';
      if (da !== db) return db.localeCompare(da);
      return String(b.lead_id || '').localeCompare(String(a.lead_id || ''));
    };
    if (myStage === 'Incubation') return sourceData.leads.filter(l =>
      l.current_owner === me.name && l.stage === 'Incubation' && l.is_final === 'No' && matchesFilters(l))
      .sort(byRegDesc);
    return sourceData.leads.filter(l => l.current_owner === me.name && l.priority <= 4 && matchesFilters(l))
      .sort(byRegDesc);
  }
  function go(id: string) { setViewId(id); setSelected(new Set()); setRoundRobinAgents([]); setSideOpen(false); }
  function openLead(id: string, queue = false) { setOpenId(id); setFromQueue(queue); }
  async function saved(previousId: string, next: boolean) {
    let patched: Lead | null = null;
    try { patched = await loadOneLead(supabase, previousId); } catch {}
    if (patched) {
      if (useServer) setLeadsRows(cur => cur.map(l => l.lead_id === patched!.lead_id ? patched! : l));
      else setData(current => {
        if (!current) return current;
        const leads = current.leads.map(l => l.lead_id === patched!.lead_id ? patched! : l);
        return { ...current, leads };
      });
    } else {
      try { await refresh(false); } catch {}
    }
    fetchCounts();
    if (useServer) fetchLeads(); else nudgeSnapshot().catch(() => {});
    setSelected(new Set()); setToast('Saved to Supabase');
    if (next) {
      const base = data && patched ? { ...data, leads: data.leads.map(l => l.lead_id === patched!.lead_id ? patched! : l) } : data;
      const nextLead = useServer ? leadsRows.find(l => l.lead_id !== previousId) : queueRows(base || undefined).find(l => l.lead_id !== previousId);
      if (nextLead) { setOpenId(nextLead.lead_id); setFromQueue(true); }
      else { setOpenId(null); go('queue'); }
    } else setOpenId(null);
  }
  function toggle(id: string, checked: boolean) { const next = new Set(selected); checked ? next.add(id) : next.delete(id); setSelected(next); }
  function selectAll(checked: boolean, rows: Lead[]) { const next = new Set(selected); rows.slice(0,500).forEach(l => checked ? next.add(l.lead_id) : next.delete(l.lead_id)); setSelected(next); }
  async function loadHandover() {
    const [agents, capRes] = await Promise.all([
      supabase.rpc('handover_agents'),
      supabase.rpc('handover_cap'),
    ]);
    const waiting = useServer ? [] : leads.filter(l => l.current_status === 'Qualified');
    setHandover({
      agents: agents.data || [],
      cap: Number(capRes.data ?? 30),
      waiting: waiting.length,
      unassigned: waiting.filter(l => !l.incubation_agent).length,
    });
    setCap(String(Number(capRes.data ?? 30)));
  }
  useEffect(() => { if (viewId === 'tab:Handover Inbox') loadHandover(); }, [viewId]);
  async function distributeHandovers() {
    setBusy(true);
    const { data: result, error } = await supabase.rpc('assign_handovers', { p: { cap: Number(cap) || 30 } });
    setBusy(false);
    if (error) return setToast(error.message);
    await refresh(false); await loadHandover();
    setToast(result?.assigned
      ? `${result.assigned} qualified lead${result.assigned === 1 ? '' : 's'} distributed${result.overflow ? ` · ${result.overflow} still waiting (everyone at the cap)` : ''}`
      : result?.overflow ? `Nothing moved: ${result.overflow} waiting and everyone is at the ${result.cap} cap` : 'Nothing waiting — the qualified queue is clear');
  }
  async function saveCap() {
    setBusy(true);
    const { error } = await supabase.from('app_settings').update({ value: String(Number(cap) || 30) }).eq('key', 'HANDOVER_DAILY_CAP');
    setBusy(false);
    if (error) return setToast(error.message);
    await loadHandover(); setToast('Handover cap saved');
  }
  async function bulkAccept() {
    const agentId = (document.getElementById('bulk-agent') as HTMLSelectElement)?.value;
    if (!agentId || !selected.size) return;
    setBusy(true); const { error } = await supabase.rpc('accept_handover', { p: { leadIds: [...selected], agentId } }); setBusy(false);
    if (error) return setToast(error.message); await refresh(false); setSelected(new Set()); setToast('Handover accepted');
  }
  function toggleRoundRobinAgent(id: string) {
    setRoundRobinAgents(current => current.includes(id) ? current.filter(agentId => agentId !== id) : [...current, id]);
  }
  function clearBulkSelection() { setSelected(new Set()); setRoundRobinAgents([]); }
  async function bulkReassign() {
    const roundRobin = viewId === 'new-lqt';
    const agentId = (document.getElementById('bulk-agent') as HTMLSelectElement)?.value;
    if ((!roundRobin && !agentId) || (roundRobin && !roundRobinAgents.length) || !selected.size) return;
    const visibleLeadIds = roundRobin ? filtered(currentView).filter(l => selected.has(l.lead_id)).map(l => l.lead_id) : [];
    const leadIds = roundRobin ? [...visibleLeadIds, ...[...selected].filter(id => !visibleLeadIds.includes(id))] : [...selected];
    setBusy(true);
    const { data: result, error } = roundRobin
      ? await supabase.rpc('round_robin_assign_lqt', { p: { leadIds, agentIds: roundRobinAgents } })
      : await supabase.rpc('reassign_leads', { p: { leadIds, agentId } });
    setBusy(false);
    if (error) return setToast(error.message);
    await refresh(false); clearBulkSelection();
    setToast(roundRobin ? `${result?.assigned ?? leadIds.length} leads assigned round robin across ${roundRobinAgents.length} LQT agent${roundRobinAgents.length === 1 ? '' : 's'}` : 'Leads reassigned');
  }
  async function signOut() { await supabase.auth.signOut(); router.replace('/login'); }

  if (loadError && !data) return <div className="loading"><div className="card"><b>Could not open the CRM</b><p className="error">{loadError}</p><p className="mute">Your Auth account may not be linked to a team member yet.</p><button className="btn" onClick={() => router.replace('/login')}>Back to sign in</button></div></div>;
  if (!data || !me) return <div className="loading">Loading your CRM workspace... <span className="mute small">(Fix C server-paginated -- ~2s)</span></div>;
  const leads = useServer ? leadsRows : (data.leads || []);
  const countFor = (v: View) => { if (useServer && countsMap[v.id] !== undefined) return countsMap[v.id]; return v.id === 'queue' ? queueRows().length : v.filter ? leads.filter(v.filter).length : ''; };
  // Request 21: Lead status / Business ID / Assign date are global filters — they apply to
  // the call queue as well as the table lists, so an agent can narrow either one.
  // Request 23: the top-bar search reaches the call queue too, not just the table lists.
  const matchesSearch = (l: Lead) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [l.lead_id, l.business_id, l.business_name, l.merchant_name, l.phone_clean, l.phone, l.email]
      .some(x => String(x || '').toLowerCase().includes(q));
  };

  const matchesFilters = (l: Lead) => {
    if (!matchesSearch(l)) return false;
    if (statusPick && l.current_status !== statusPick) return false;
    if (businessId && !String(l.business_id || '').toLowerCase().includes(businessId.trim().toLowerCase())) return false;
    if (assignFrom && (!l.assign_date || l.assign_date < assignFrom)) return false;
    if (assignTo && (!l.assign_date || l.assign_date > assignTo)) return false;
    return true;
  };
  const anyFilter = !!(statusPick || businessId || assignFrom || assignTo);

  const filtered = (v: View) => {
    if (useServer) return leads; // server already filtered/paginated
    const q = query.trim().toLowerCase();
    // These lists are about who QUALIFIED the lead, not who owns it now.
    const mineIgnored = v.id === 'tab:Handover Inbox' || v.id === 'my-qualified' || v.id === 'qualified';
    return leads.filter(v.filter || (() => true)).filter(l => {
      if (owner === 'mine' && !mineIgnored && l.current_owner !== me.name) return false;
      if (owner === '__none' && l.current_owner) return false;
      if (owner && !['mine','__none'].includes(owner) && l.current_owner !== owner) return false;
      if (source && l.source !== source) return false;
      if (generation && l.lead_generation !== generation) return false;
      if (!matchesFilters(l)) return false;
      if (registrationFrom && (!l.registration_date || l.registration_date < registrationFrom)) return false;
      if (registrationTo && (!l.registration_date || l.registration_date > registrationTo)) return false;
      if (q && ![l.lead_id,l.business_id,l.business_name,l.merchant_name,l.phone_clean,l.phone,l.email].some(x => String(x || '').toLowerCase().includes(q))) return false;
      // Request 19: Closed leads is one view for six former tabs.
      if (v.id === 'closed' && statusFilter && l.current_status !== statusFilter) return false;
      return true;
    }).sort((a,b) => {
      // Global rule: most recent registration first — today's leads on top in every table
      const da = a.registration_date || '';
      const db = b.registration_date || '';
      if (da !== db) return db.localeCompare(da);
      return String(b.lead_id || '').localeCompare(String(a.lead_id || ''));
    });
  };
  const bulkAllowed = isLead || (viewId === 'tab:Handover Inbox' && me.team === 'Incubation');
  // Live today personal stats for Dashboard
  const myQueue = queueRows();
  const myLeadRows = useServer ? [] : leads.filter(l => l.current_owner === me.name);
  const myStats = {
    pending: myLeadRows.filter(l => l.is_final === 'No').length,
    overdue: myLeadRows.filter(l => l.due_state === 'Overdue' && l.is_final === 'No').length,
    dueToday: myLeadRows.filter(l => l.due_state === 'Due Today' && l.is_final === 'No').length,
    newOpen: myLeadRows.filter(l => l.lead_generation === 'New' && l.stage === 'LQT' && l.is_final === 'No').length,
    oldOpen: myLeadRows.filter(l => l.lead_generation === 'Old' && l.stage === 'LQT' && l.is_final === 'No').length,
    callsToday: dash?.agents.find(a => a.name === me.name)?.calls_today ?? 0,
  };

  return <div className="shell">
    {busy && <div className="busy" />}
    <aside className={`sidebar ${sideOpen ? 'open' : ''}`}>
      <div className="brand">carry<span>bee</span></div><div className="user-line">{me.name}<br />{me.team} · {me.is_main_admin ? 'Main Admin' : me.admin_access ? 'Admin (granted)' : me.role}</div>
      {views.map((v, i) => <div key={v.id}>{v.group && v.group !== views[i-1]?.group && <div className="nav-group">{v.group}</div>}
        <button className={`nav-btn ${viewId === v.id ? 'active' : ''}`} onClick={() => go(v.id)}><v.icon /><span className="label">{v.title}</span>{countFor(v) !== '' && <span className="count">{countFor(v)}</span>}</button>
      </div>)}
      <div className="nav-group" /><button className="nav-btn" onClick={signOut}><LogOut /><span className="label">Sign out</span></button>
    </aside>
    <header className="topbar">
      <button className="btn icon burger" onClick={() => setSideOpen(!sideOpen)}><Menu /></button>
      <div className="search"><Search /><input className="input" type="search" placeholder="Search business, merchant, phone or ID" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <select className="select" aria-label="Owner" value={owner} onChange={e => setOwner(e.target.value)}><option value="">All owners</option><option value="mine">My leads</option><option value="__none">Unassigned</option>{data.members.filter(m => m.active).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
      <select className="select" aria-label="Source" value={source} onChange={e => setSource(e.target.value)}><option value="">All sources</option>{data.lists.filter(l => l.category === 'Source').map(l => <option key={l.value}>{l.value}</option>)}</select>
      <select className="select" aria-label="Lead generation" value={generation} onChange={e => setGeneration(e.target.value)}><option value="">New + Old</option><option value="New">New only</option><option value="Old">Old only</option></select>
      <select className="select" aria-label="Lead status" value={statusPick} onChange={e => { setStatusPick(e.target.value); setSelected(new Set()); }}>
        <option value="">All lead statuses</option>
        {unique(data.rules.map(r => r.status)).map(st => <option key={st} value={st}>{st}</option>)}
      </select>
      <input className="input bizid" type="search" aria-label="Business ID" placeholder="Business ID" value={businessId} onChange={e => { setBusinessId(e.target.value); setSelected(new Set()); }} />
      {viewId === 'closed' && <select className="select" aria-label="Closed status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="">All closed statuses</option>
        {unique(data.rules.filter(r => r.stage === 'Final').map(r => r.status)).map(st => <option key={st} value={st}>{st}</option>)}
      </select>}
      <span className="grow" /><span className="sync">Synced {lastSync}</span>
      <Notifications supabase={supabase} memberId={me?.id ?? null}
        onOpenLead={ref => openLead(ref)} />
      <ThemeButton />
      <button className="btn icon" title="Refresh" onClick={() => refresh().catch(() => {})}><RefreshCw /></button>
      {isLead && <button className="btn primary" onClick={() => setAddOpen(true)}><Plus />Add lead</button>}
    </header>
    <main className="main">
      <SyncHealthBanner onOpenDetails={() => go('sync-log')} />
      <OverdueEscalationBanner onOpenProfile={owner => { setOwner(owner); go('oldbook'); }} />
      {loadError && <div className="banner bad">{loadError}</div>}
      {currentView.special === 'reports' && <Reports isLead={isLead} />}
      {currentView.special === 'dash' && <Dashboard stats={dash} loading={dashLoading} days={dashDays} onDays={setDashDays} team={dashTeam} onTeam={setDashTeam} go={go} periodFrom={dashFrom} periodTo={dashTo} onPeriodFrom={setDashFrom} onPeriodTo={setDashTo} liveToday={dashLive} onLiveToday={setDashLive} meName={me.name} myQueue={myQueue} myStats={myStats} />}
      {currentView.special === 'queue' && <Queue leads={queueRows()} open={openLead} stage={myStage} filtered={anyFilter || !!query.trim()} query={query} />}
      {currentView.special === 'flow' && <Flow data={data} go={go} />}
      {currentView.special === 'script' && <><h1 className="page-title">Call script</h1><p className="subtitle">Cover every talking point with each merchant. Script text is backed up with the configuration.</p>{data.scripts.map(p => <div className="card" key={p.point_number}><b>{p.point_number}. {p.talking_point}</b><p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{p.script_text || <span className="mute">No script yet. Add it in Supabase or the original sheet before migration.</span>}</p></div>)}</>}
      {currentView.special === 'nobid' && <MissingBusinessId supabase={supabase} leads={data.leads}
        mine={me?.name || ''} isLqtLead={isLead} onOpenLead={openLead} onSaved={() => refresh(false)} />}
      {currentView.special === 'rulebook' && <Rulebook />}
      {currentView.special === 'team' && <TeamAdmin members={data.members} settings={data.settings} me={me} onChanged={async () => { await refresh(false); }} />}
      {currentView.special === 'command-center' && <CommandCenter />}
      {currentView.special === 'sync-log' && <SyncLog supabase={supabase} />}
      {viewId === 'tab:Handover Inbox' && handover && <div className="card" style={{ marginBottom: 14 }}>
        <p className="mute small" style={{ margin: '0 0 10px' }}>Qualified leads are handed out automatically, the moment an LQT agent qualifies one, to whichever Incubation person is <b>IN</b> today and has the fewest today. Nobody has to claim them. Mark someone <b>out</b> in Team &amp; system and they stop receiving immediately.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {handover.agents.length === 0 && <span className="tag warn">Nobody IN for Incubation — qualified leads will wait unassigned</span>}
          {handover.agents.map((a: any) => <span key={a.member_id} className="tag">{a.name}: <b>{a.received_today}</b>/{handover.cap} today · {a.open_leads} open</span>)}
          {handover.unassigned > 0 && <span className="tag bad">{handover.unassigned} waiting unassigned</span>}
        </div>
        {isLead && <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'end' }}>
          <label className="field" style={{ margin: 0, maxWidth: 180 }}>Daily cap per person<input className="input" type="number" min="1" max="100" value={cap} onChange={e => setCap(e.target.value)} onBlur={saveCap} /></label>
          <button className="btn primary" disabled={busy} onClick={distributeHandovers}>{handover.unassigned ? `Distribute ${handover.unassigned} now` : 'Distribute any waiting now'}</button>
          <span className="mute small">Only needed for leftovers — a new qualifying is handed out on its own.</span>
        </div>}
      </div>}
      {!currentView.special && <div className="list-view">
        <div className="list-head"><h1 className="page-title">{currentView.title}</h1><p className="subtitle">{useServer ? totalCount : filtered(currentView).length} leads{rowsLoading ? " — loading…" : ""}{owner === 'mine' && viewId !== 'tab:Handover Inbox' && viewId !== 'my-qualified' && viewId !== 'qualified' ? ' owned by you' : ''}. {currentView.id === 'new-lqt' ? 'Every Business ID in Old.csv is excluded; select the newer merchants to assign.' : currentView.id === 'oldbook' ? 'The inherited book you own and have not closed, earliest due date first — this is the list to work, not a record. Incubation work sits in My call queue and the Incubation Queue instead.' : currentView.id === 'closed' ? 'Every closed lead in one place. Use the status filter to narrow to one outcome.' : currentView.id === 'parked' ? 'Leads that asked for a later call. They are not counted as overdue and their clock is paused until the date they named.' : currentView.id === 'tab:Callback requested' ? 'Leads that asked to be called on a later date. They are not counted as overdue and their SLA clock is paused until the date they named; they return to the queue on that day.' : currentView.id === 'my-qualified' ? 'Every lead you marked Qualified, wherever it has moved since — Incubation, Care Period or a final status. This is your own record; nobody can edit it.' : currentView.id === 'qualified' ? 'Every lead the LQT team has qualified, with who qualified it and when. Use the owner filter to see one agent\'s record.' : currentView.id === 'handed-to-me' ? 'Every open lead handed to you after qualification, wherever it has moved since — Awaiting 1st Trip, Care Period or a later call. It never hides a lead because of a due date.' : 'New leads are listed before the old book. Click a lead to log a call.'}</p>
        <div className="registration-filters" aria-label="Registration date filters">
          <label>Registration from<input className="input" type="date" aria-label="Registration from" value={registrationFrom} max={registrationTo || undefined} onChange={e => { setRegistrationFrom(e.target.value); setSelected(new Set()); }} /></label>
          <label>Registration to<input className="input" type="date" aria-label="Registration to" value={registrationTo} min={registrationFrom || undefined} onChange={e => { setRegistrationTo(e.target.value); setSelected(new Set()); }} /></label>
          <label>Assign from<input className="input" type="date" aria-label="Assign from" value={assignFrom} max={assignTo || undefined} onChange={e => { setAssignFrom(e.target.value); setSelected(new Set()); }} /></label>
          <label>Assign to<input className="input" type="date" aria-label="Assign to" value={assignTo} min={assignFrom || undefined} onChange={e => { setAssignTo(e.target.value); setSelected(new Set()); }} /></label>
          {(registrationFrom || registrationTo || assignFrom || assignTo || statusPick || businessId) && <button className="btn" onClick={() => { setRegistrationFrom(''); setRegistrationTo(''); setAssignFrom(''); setAssignTo(''); setStatusPick(''); setBusinessId(''); setSelected(new Set()); }}>Clear filters</button>}
          {currentView.id === 'new-lqt' && <span className="filter-note">Old.csv exclusion active</span>}
        </div></div>
        <div className="list-body">
          {useServer ? (
            <LeadTable leads={leads} columns={currentView.columns || COLS.all} onOpen={openLead} selected={bulkAllowed ? selected : undefined} onToggle={bulkAllowed ? toggle : undefined} onSelectAll={bulkAllowed ? checked => selectAll(checked, leads) : undefined} searchQuery={query} serverMode totalCount={totalCount} serverPage={page} serverPageSize={pageSize} onPageChange={(p, ps)=>{setPage(p); setPageSize(ps);}} />
          ) : (
            <LeadTable leads={filtered(currentView)} columns={currentView.columns || COLS.all} onOpen={openLead} selected={bulkAllowed ? selected : undefined} onToggle={bulkAllowed ? toggle : undefined} onSelectAll={bulkAllowed ? checked => selectAll(checked, filtered(currentView)) : undefined} searchQuery={query} />
          )}
        </div>
      </div>}
    </main>
    {selected.size > 0 && <div className="bulkbar"><b>{selected.size} selected</b>
      {viewId === 'new-lqt' ? <details className="agent-picker">
        <summary className="select">{roundRobinAgents.length ? `${roundRobinAgents.length} LQT agent${roundRobinAgents.length === 1 ? '' : 's'} selected` : 'Choose LQT agents'}</summary>
        <div className="agent-picker-menu">
          <p className="agent-picker-help">Select in rotation order. Leads will be assigned A → B → C → A…</p>
          {data.members.filter(m => m.active && m.team === 'LQT').map(m => <label className="agent-choice" key={m.id}>
            <input type="checkbox" checked={roundRobinAgents.includes(m.id)} onChange={() => toggleRoundRobinAgent(m.id)} />
            <span>{m.name}</span>{roundRobinAgents.includes(m.id) && <b>#{roundRobinAgents.indexOf(m.id) + 1}</b>}
          </label>)}
          {roundRobinAgents.length > 0 && <p className="agent-order"><b>Rotation:</b> {roundRobinAgents.map((id, index) => <span key={id}>{index + 1}. {data.members.find(m => m.id === id)?.name}</span>)}</p>}
        </div>
      </details> : <select id="bulk-agent" className="select" defaultValue={viewId === 'tab:Handover Inbox' && me.team === 'Incubation' ? me.id : ''}><option value="" disabled>Choose agent</option>{data.members.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name} — {m.stage || m.team}{m.on_leave ? ' (out today)' : ''}</option>)}</select>}
      {viewId === 'tab:Handover Inbox' && !isLead && me.team === 'Incubation' && <button className="btn primary" onClick={bulkAccept}>Accept handover</button>}
      {isLead && <button className="btn primary" disabled={viewId === 'new-lqt' && !roundRobinAgents.length} onClick={bulkReassign}>{viewId === 'new-lqt' ? roundRobinAgents.length > 1 ? 'Assign round robin' : 'Assign to LQT' : 'Reassign'}</button>}<button className="btn" onClick={clearBulkSelection}>Clear</button>
    </div>}
    {currentLead && <LeadDrawer lead={currentLead} me={me} members={data.members} rules={data.rules} lists={data.lists} scripts={data.scripts} settings={data.settings} fromQueue={fromQueue} onClose={() => setOpenId(null)} onSaved={saved} />}
    {addOpen && <AddLead members={data.members} lists={data.lists} onClose={() => setAddOpen(false)} onSaved={async () => { await refresh(false); setAddOpen(false); setToast('Lead added'); }} />}
    {toast && <div className="toast">{toast}</div>}
    <BottomNav viewId={viewId} go={go} queueCount={queueRows().length} />
  </div>;
}

function BottomNav({ viewId, go, queueCount }: { viewId: string; go: (id:string)=>void; queueCount:number }) {
  const items: { id:string; label:string; icon: any }[] = [
    { id:'dash', label:'Dashboard', icon: LayoutDashboard },
    { id:'queue', label:'My queue', icon: PhoneCall },
    { id:'oldbook', label:'Old book', icon: Clock3 },
    { id:'tab:Follow Up', label:'Follow Up', icon: List },
    { id:'all', label:'All leads', icon: Database },
  ];
  return <nav className="bottom-nav" aria-label="Primary">
    {items.map(it => {
      const active = viewId===it.id;
      return <button key={it.id} className={`bnav-btn ${active?'active':''}`} onClick={()=>go(it.id)} aria-current={active?'page':undefined}>
        <it.icon /><span>{it.label}</span>{it.id==='queue' && queueCount>0 && <b className="bnav-badge">{queueCount}</b>}
      </button>;
    })}
  </nav>;
}
function Kpi({ label, value, tone = '', onClick }: { label: string; value: number; tone?: string; onClick: () => void }) {
  return <button className={`kpi ${tone}`} onClick={onClick}><strong>{value}</strong><span>{label}</span></button>;
}
function Queue({ leads, open, stage, filtered, query }: { leads: Lead[]; open: (id: string, queue: boolean) => void; stage: string; filtered: boolean; query: string }) {
  const labels: Record<number,string> = { 0: 'Handover call overdue', 1: 'Overdue', 2: 'New lead', 3: 'Due today' };
  // Request 23: the queue gets the same frozen frame as the list views — heading, subtitle,
  // the "start with the first call" button and the table header stay put; only rows scroll.
  return <div className="list-view">
    <div className="list-head">
      <h1 className="page-title">My call queue</h1>
      <p className="subtitle">{stage === 'Incubation' ? 'Your Incubation work that needs a call now — a lead due today or overdue is always here, whatever its priority.' : 'Your leads that need a call now, ordered by the same priority rules as the original CRM.'}</p>
      {leads.length > 0 && <button className="btn primary queue-start" onClick={() => open(leads[0].lead_id, true)}>Start with the first call<ChevronRight /></button>}
    </div>
    {!leads.length
      ? <div className="list-body"><div className="card empty">{filtered
          ? 'No lead in your queue matches the current search or filters. Clear them to see the whole queue again.'
          : 'Your queue is clear. Check Follow Up and Care Period for upcoming work.'}</div></div>
      : <div className="list-body">
          <LeadTable leads={leads} columns={['lead_id','business_name','phone_clean','registration_date','current_status','lqt_touches','next_due_date','due_state','alert']} onOpen={id => open(id, true)} searchQuery={query} />
          <p className="table-note" style={{ padding: '0 12px 12px' }}>Priority: {leads.slice(0,10).map(l => `${l.lead_id} (${labels[l.priority] || 'Upcoming'})`).join(' · ')}{leads.length > 10 ? '…' : ''}</p>
        </div>}
  </div>;
}
function Flow({ data, go }: { data: Bootstrap; go: (id: string) => void }) {
  const s = (key: string) => setting(data.settings,key); const count = (tab: string) => (useServer && countsMap['tab:'+tab]!==undefined ? countsMap['tab:'+tab] : data.leads.filter(l => l.tab === tab).length);
  const Step = ({ title, text, n, view }: { title: string; text: string; n: number; view: string }) => <button className="step" onClick={() => go(view)}><b>{title}</b><span>{text}</span><strong>{n}</strong></button>;
  return <><h1 className="page-title">How it works</h1><p className="subtitle">Lead movement and timing rules, now calculated directly in Postgres.</p><div className="lanes">
    <div className="lane"><h3>1. Supabase is the source of truth</h3><div className="steps"><Step title="Leads" text="TL assigns leads; every read and write is live in Postgres." n={data.leads.length} view="all" /><Step title="Old follow-ups" text="Migrated legacy calls remain in the audit history." n={data.leads.filter(l => l.has_legacy === 'Yes' && l.is_final === 'No').length} view="old" /></div></div>
    <div className="lane"><h3>2. Lead Qualification Team (LQT)</h3><div className="steps"><Step title="New Leads" text={`1st call within ${s('FIRST_CONTACT_DAYS')} day of assignment`} n={count('New Leads')} view="tab:New Leads" /><Step title="CNR" text={`${s('CNR_MAX')} CNRs become Silent Leads`} n={count('CNR')} view="tab:CNR" /><Step title="Follow Up" text={`FU1 day ${s('FU1_DAYS')} (max ${s('FU1_MAX')}); FU2 day ${s('FU2_DAYS')} (max ${s('FU2_MAX')})`} n={count('Follow Up')} view="tab:Follow Up" /><Step title="Qualified" text="Profile, talking points, booked call and handover note" n={count('Handover Inbox')} view="tab:Handover Inbox" /></div><p className="mute small">Final status or Qualified within {s('FINAL_SLA_DAYS')} days of assignment.</p></div>
    <div className="lane"><h3>3. Incubation</h3><div className="steps"><Step title="Handover Inbox" text={`Call within ${s('HANDOVER_CALL_MIN')} minutes of the booked slot`} n={count('Handover Inbox')} view="tab:Handover Inbox" /><Step title="Incubation Queue" text={`1st trip within ${s('TRIP_DAYS')} days of accepting`} n={count('Incubation Queue')} view="tab:Incubation Queue" /><Step title="Care Period" text={`${s('CARE_DAYS')} days from first trip`} n={count('Care Period')} view="tab:Care Period" /><Step title="Care Completed" text="Automatic after care period" n={count('Care Completed')} view="tab:Care Completed" /></div></div>
  </div></>;
}
