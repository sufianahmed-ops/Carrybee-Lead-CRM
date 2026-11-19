import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ALLOWED_DATE_FIELDS, EXPORT_COL_KEYS, parseListParam } from '@/lib/report-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function applyFilters(q: any, params: URLSearchParams) {
  const dateField = params.get('dateField') || 'registration_date';
  const from = params.get('from');
  const to = params.get('to');
  const statuses = parseListParam(params.get('status'));
  const stages = parseListParam(params.get('stage'));
  const tabs = parseListParam(params.get('tab'));
  const generations = parseListParam(params.get('generation'));
  const sources = parseListParam(params.get('source'));
  const owners = parseListParam(params.get('owner'));
  const dueStates = parseListParam(params.get('dueState'));
  const isFinal = params.get('isFinal');
  const leadId = params.get('leadId');
  const bizId = params.get('businessId');
  const zone = params.get('zone');

  // whitelist date field
  const safeDateField = (ALLOWED_DATE_FIELDS as readonly string[]).includes(dateField) ? dateField : 'registration_date';

  if (from) q = q.gte(safeDateField, from);
  if (to) q = q.lte(safeDateField, to);
  if (statuses) q = q.in('current_status', statuses);
  if (stages) q = q.in('stage', stages);
  if (tabs) q = q.in('tab', tabs);
  if (generations) q = q.in('lead_generation', generations);
  if (sources) q = q.in('source', sources);
  if (owners) q = q.in('current_owner', owners);
  if (dueStates) q = q.in('due_state', dueStates);
  if (isFinal) q = q.eq('is_final', isFinal);
  if (leadId) q = q.ilike('lead_id', `%${leadId}%`);
  if (bizId) q = q.ilike('business_id', `%${bizId}%`);
  if (zone) q = q.eq('zone', zone);

  return q;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const admin = createAdminClient();

  // admin-only: Lead/Admin per team_members
  const { data: me } = await admin.from('team_members').select('role,is_main_admin,admin_access').eq('auth_user_id', user.id).single();
  const isLead = !!me && (!!(me as any).is_main_admin || !!(me as any).admin_access || /lead|admin/i.test((me as any).role || ''));
  if (!isLead) return NextResponse.json({ error: 'Admin access required — reports are admin-only' }, { status: 403 });

  // optional limit/offset for preview
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100'), 1), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

  const cols = EXPORT_COL_KEYS.join(',');

  // count first (head)
  let countQ = admin.from('lead_list_snapshot').select('lead_id', { count: 'exact', head: true });
  countQ = applyFilters(countQ, url.searchParams);
  const { count, error: countErr } = await countQ;
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

  // rows — newest registration first so today's data is on top
  let dataQ = admin.from('lead_list_snapshot').select(cols).order('registration_date', { ascending: false }).order('lead_id', { ascending: false }).range(offset, offset + limit - 1);
  dataQ = applyFilters(dataQ, url.searchParams);
  const { data, error } = await dataQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // distinct values for filter dropdowns (lightweight - from rules/members but we can give snapshot distinct via separate query if needed)
  return NextResponse.json({ ok: true, count: count ?? 0, rows: data || [], limit, offset });
}
