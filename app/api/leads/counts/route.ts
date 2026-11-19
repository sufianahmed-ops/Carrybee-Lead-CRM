import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const admin = createAdminClient();
  const { data: meRow } = await admin.from('team_members').select('id,name,team,stage').eq('auth_user_id', user.id).single();
  const me = meRow as any;
  if (!me) return NextResponse.json({ error: 'No member' }, { status: 403 });

  let actingStage = me.stage || me.team;
  try {
    const { data: lending } = await admin.from('member_lendings').select('work_stage').eq('member_id', me.id).eq('active', true).limit(1).single();
    if ((lending as any)?.work_stage) actingStage = (lending as any).work_stage;
  } catch {}

  const base = () => admin.from('lead_list_snapshot').select('lead_id', { count: 'exact', head: true });
  const views: { id: string; q: any }[] = [];

  if (actingStage === 'Incubation') views.push({ id:'queue', q: base().eq('current_owner', me.name).eq('stage','Incubation').eq('is_final','No') });
  else views.push({ id:'queue', q: base().eq('current_owner', me.name).lte('priority',4) });

  views.push({ id:'oldbook', q: base().eq('lead_generation','Old').eq('stage','LQT').eq('is_final','No') });
  views.push({ id:'new-gen', q: base().eq('lead_generation','New').eq('is_final','No') });
  views.push({ id:'closed', q: base().eq('stage','Final') });
  views.push({ id:'all', q: base() });
  views.push({ id:'tab:Follow Up', q: base().eq('tab','Follow Up') });
  views.push({ id:'tab:New Leads', q: base().eq('tab','New Leads') });
  views.push({ id:'tab:CNR', q: base().eq('tab','CNR') });
  views.push({ id:'tab:Handover Inbox', q: base().eq('tab','Handover Inbox') });
  views.push({ id:'tab:Incubation Queue', q: base().eq('tab','Incubation Queue') });
  views.push({ id:'tab:Care Period', q: base().eq('tab','Care Period') });

  const results = await Promise.all(views.map(async v => {
    const { count } = await v.q;
    return [v.id, count ?? 0] as const;
  }));
  const map: Record<string, number> = Object.fromEntries(results);
  return NextResponse.json({ ok: true, counts: map });
}
