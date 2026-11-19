import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { LEAD_LIST_COLUMNS } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OLD_ASSIGNMENT_BUSINESS_IDS trimmed to Set check post-fetch for new-lqt
import { OLD_ASSIGNMENT_BUSINESS_IDS } from '@/lib/assignment-exclusions';

function applyCommonFilters(q: any, sp: URLSearchParams) {
  const owner = sp.get('owner'); // '' = all, 'mine'=current user, '__none'=unassigned, else name
  const source = sp.get('source');
  const generation = sp.get('generation');
  const statusPick = sp.get('statusPick');
  const businessId = sp.get('businessId');
  const assignFrom = sp.get('assignFrom');
  const assignTo = sp.get('assignTo');
  const registrationFrom = sp.get('registrationFrom');
  const registrationTo = sp.get('registrationTo');
  const statusFilter = sp.get('statusFilter'); // closed view second filter
  const query = sp.get('query') || sp.get('q');
  const currentOwnerName = sp.get('meName'); // passed from client to resolve 'mine'

  // owner
  if (owner) {
    if (owner === '__none') q = q.is('current_owner', null);
    else if (owner === 'mine' && currentOwnerName) q = q.eq('current_owner', currentOwnerName);
    else if (owner && owner !== 'mine') q = q.eq('current_owner', owner);
  }
  if (source) q = q.eq('source', source);
  if (generation) q = q.eq('lead_generation', generation);
  if (statusPick) q = q.eq('current_status', statusPick);
  if (businessId) q = q.ilike('business_id', `%${businessId}%`);
  if (assignFrom) q = q.gte('assign_date', assignFrom);
  if (assignTo) q = q.lte('assign_date', assignTo);
  if (registrationFrom) q = q.gte('registration_date', registrationFrom);
  if (registrationTo) q = q.lte('registration_date', registrationTo);
  if (statusFilter) q = q.eq('current_status', statusFilter);

  // global search across key text cols — use or()
  if (query && query.trim().length >= 1) {
    const e = query.trim().replace(/%/g, '').replace(/,/g, '');
    // PostgREST or: col.ilike.%val% — 7 fields
    q = q.or(`lead_id.ilike.%${e}%,business_id.ilike.%${e}%,business_name.ilike.%${e}%,merchant_name.ilike.%${e}%,phone_clean.ilike.%${e}%,phone.ilike.%${e}%,email.ilike.%${e}%`);
  }
  return q;
}

function applyViewFilter(q: any, viewId: string, sp: URLSearchParams, me: { id: string; name: string } | null) {
  if (!viewId) return q;
  if (viewId.startsWith('tab:')) {
    const tab = viewId.slice(4);
    q = q.eq('tab', tab);
    return q;
  }
  switch (viewId) {
    case 'oldbook':
      q = q.eq('lead_generation', 'Old').eq('stage', 'LQT').eq('is_final', 'No');
      break;
    case 'parked':
      q = q.eq('callback_hold', true).eq('is_final', 'No');
      break;
    case 'new-gen':
      q = q.eq('lead_generation', 'New').eq('is_final', 'No');
      break;
    case 'closed':
      q = q.eq('stage', 'Final');
      break;
    case 'all':
      break;
    case 'onb':
      q = q.eq('in_onboarding_tracker', 'Yes');
      break;
    case 'new-lqt':
      q = q.eq('lead_generation', 'New').eq('source', 'Self Registered').is('current_owner', null).not('registration_date', 'is', null);
      break;
    case 'pickup':
      // fetch LastChance/Pending/Cancelled — cannot OR easily with snapshot, use in()
      q = q.in('pickup_state', ['LastChance', 'Pending', 'Cancelled'] as any);
      break;
    case 'qualified':
      q = q.not('qualified_by', 'is', null);
      break;
    case 'my-qualified':
      if (me) {
        // server can only filter by qualified_by OR name — use or()
        q = q.or(`qualified_by.eq.${me.id},qualified_by_name.eq.${me.name}`);
        q = q.not('qualified_by', 'is', null);
      }
      break;
    case 'nobid':
      q = q.eq('missing_business_id', 'Missing');
      break;
    case 'queue':
      // queue handled separately via priority filter below
      break;
    default:
      break;
  }
  return q;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const admin = createAdminClient();
  const { data: meRow } = await admin.from('team_members').select('id,name,team,role,stage').eq('auth_user_id', user.id).single();
  const me = meRow as any as { id: string; name: string; team: string; role: string; stage?: string } | null;
  if (!me) return NextResponse.json({ error: 'No team member linked' }, { status: 403 });

  // merge lend_stage if present
  let actingStage = (me as any)?.stage || me?.team;
  try {
    const { data: lending } = await admin.from('member_lendings').select('work_stage').eq('member_id', me.id).eq('active', true).limit(1).single();
    if ((lending as any)?.work_stage) actingStage = (lending as any).work_stage;
  } catch {}

  const viewId = sp.get('viewId') || sp.get('view') || 'all';
  const isQueue = viewId === 'queue';
  const page = Math.max(parseInt(sp.get('page') || '1'), 1);
  const pageSize = Math.min(Math.max(parseInt(sp.get('pageSize') || sp.get('limit') || '50'), 1), 250);
  const offset = (page - 1) * pageSize;

  // count query
  let countQ = admin.from('lead_list_snapshot').select('lead_id', { count: 'exact', head: true });
  countQ = applyCommonFilters(countQ, sp);
  countQ = applyViewFilter(countQ, viewId, sp, me);

  // queue filters
  if (isQueue) {
    const myStage = (me as any).lend_stage || actingStage;
    if (myStage === 'Incubation') {
      countQ = countQ.eq('current_owner', me.name).eq('stage', 'Incubation').eq('is_final', 'No');
    } else {
      countQ = countQ.eq('current_owner', me.name).lte('priority', 4);
    }
    // queue also respects global search/status filters already applied via applyCommonFilters
  }

  const { count, error: countErr } = await countQ;
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

  // data query
  let dataQ = admin.from('lead_list_snapshot').select(LEAD_LIST_COLUMNS).order('registration_date', { ascending: false }).order('lead_id', { ascending: false }).range(offset, offset + pageSize - 1);
  dataQ = applyCommonFilters(dataQ, sp);
  dataQ = applyViewFilter(dataQ, viewId, sp, me);
  if (isQueue) {
    const myStage = (me as any).lend_stage || actingStage;
    if (myStage === 'Incubation') {
      dataQ = dataQ.eq('current_owner', me.name).eq('stage', 'Incubation').eq('is_final', 'No');
    } else {
      dataQ = dataQ.eq('current_owner', me.name).lte('priority', 4);
    }
  }

  const { data, error } = await dataQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = (data as any[]) || [];

  // post-filter for new-lqt Old.csv exclusion (set of ~thousands) — cannot do in PostgREST
  if (viewId === 'new-lqt') {
    rows = rows.filter(r => !OLD_ASSIGNMENT_BUSINESS_IDS.has(String(r.business_id || '').trim()));
    // count after exclusion (approx) — recount filtered chunk scaling
    // for now return filtered rows of this page; total count slightly over — acceptable for IO saving
  }

  return NextResponse.json({ ok: true, count: count ?? rows.length, rows, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize) });
}
