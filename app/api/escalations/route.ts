import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  try {
    const admin = createAdminClient();
    // quick auth: allow any signed-in to read; cron bypasses
    const cronOk = cronAuthorized(request);
    if (!cronOk) {
      try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
      } catch {}
    }
    // overdue snapshot via lead_list_snapshot
    const { data: cfg } = await admin.from('app_settings').select('key,value').in('key', ['ESCALATION_OVERDUE_DAYS','ESCALATION_MIN_COUNT','ESCALATION_ENABLED']);
    const days = Number(cfg?.find(c=>c.key==='ESCALATION_OVERDUE_DAYS')?.value || 2);
    const min = Number(cfg?.find(c=>c.key==='ESCALATION_MIN_COUNT')?.value || 5);
    const enabled = (cfg?.find(c=>c.key==='ESCALATION_ENABLED')?.value || 'true') !== 'false';

    // compute overdue>days via RPC if available, else via view
    const { data: health } = await admin.rpc('check_overdue_escalations' as any).then(r=>({data:null,error:r.error})).catch(()=>({data:null,error:null}));
    // For GET we do not want to re-notify, so just read tracker + snapshot counts
    const { data: tracker } = await admin.from('escalation_tracker').select('member_id,last_escalated_at,last_overdue_count');
    // counts: use snapshot grouping client-side via query
    const { data: counts } = await admin.rpc('sync_health' as any); // placeholder to keep admin warm
    void counts; void health;

    // fetch per-member overdue>days via direct query (service role bypasses RLS)
    const cutoffRes = await admin.from('app_settings').select('value').eq('key','ESCALATION_OVERDUE_DAYS').maybeSingle();
    void cutoffRes;
    // We compute via a raw SQL through rpc if exists else fallback to reading snapshot rows
    // Fallback: pull snapshot row counts client-side (small payload: only overdue rows)
    const { data: overdueRows, error } = await admin.from('lead_list_snapshot')
      .select('current_owner,next_due_date,due_state,is_final')
      .eq('due_state','Overdue').eq('is_final','No').limit(6000);
    let perOwner: Record<string, number> = {};
    if (!error && overdueRows) {
      const { data: todayData } = await admin.rpc('crm_today' as any);
      const today = todayData ? String(todayData) : new Date().toISOString().slice(0,10);
      const cutoff = new Date(today); cutoff.setDate(cutoff.getDate()-days);
      const cutoffStr = cutoff.toISOString().slice(0,10);
      for (const r of overdueRows as any[]) {
        const d = String(r.next_due_date||'');
        if (d && d <= cutoffStr) perOwner[r.current_owner] = (perOwner[r.current_owner]||0)+1;
      }
    }
    const filtered = Object.entries(perOwner).filter(([,c])=>c>=min)
      .map(([owner,c])=>({owner, overdue: c, last_escalated: (tracker as any[])?.find(t=> false)?.last_escalated_at || null }))
      .sort((a,b)=>b.overdue-a.overdue);

    // enrich with last_escalated per owner via member lookup
    const { data: members } = await admin.from('team_members').select('id,name');
    const byName = new Map((members as any[]||[]).map(m=>[m.name,m.id]));
    const enriched = filtered.map(f=>{
      const mid = byName.get(f.owner) as string|undefined;
      const tr = (tracker as any[]||[]).find(t=>t.member_id===mid);
      return {...f, member_id: mid||null, last_escalated_at: tr?.last_escalated_at||null, last_count: tr?.last_overdue_count||null};
    });

    return NextResponse.json({ ok: true, enabled, days, min, overdue: enriched, tracker });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message||String(e)}, {status:500});
  }
}

export async function POST(request: Request) {
  const cronOk = cronAuthorized(request);
  let isLead = false;
  if (!cronOk) {
    const supabase = await createClient();
    const { data: {user} } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error:'Sign in'},{status:401});
    const admin = createAdminClient();
    const { data: me } = await admin.from('team_members').select('role,is_main_admin,admin_access').eq('auth_user_id', user.id).single();
    isLead = !!me && (!!(me as any).is_main_admin || !!(me as any).admin_access || /lead|admin/i.test((me as any).role||''));
    if (!isLead) return NextResponse.json({ error:'Lead/Admin only'},{status:403});
  }
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_overdue_escalations' as any);
    if (error) throw error;
    return NextResponse.json({ ok:true, result: data });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e.message||String(e)}, {status:500});
  }
}
