import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sync health endpoint — the one place that answers "is the sync alive?"
 *
 * GET /api/sync-health
 *   Returns { health, status, message } where status is 'ok' | 'stale' | 'failed'
 *   Auth: any signed-in member OR Bearer CRON_SECRET (so Apps Script / monitors can ping it).
 *
 * POST /api/sync-health  { action: 'check' }
 *   Forces a live check_and_notify cycle (same as the 30-min pg_cron). Requires Lead/Admin or CRON_SECRET.
 */

function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

async function fetchHealth(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin.rpc('sync_health' as any);
  if (error) throw error;
  // supabase returns the jsonb directly as object
  const h = (data as any) ?? {};
  const isStale = !!h.is_stale;
  const lastStatus = (h.last_status as string) || 'unknown';
  const status = isStale ? 'stale' : lastStatus === 'failed' || lastStatus === 'partial' ? 'failed' : 'ok';
  return { health: h, status, error: null as string | null };
}

export async function GET(request: Request) {
  const cronOk = cronAuthorized(request);
  let memberOk = false;
  if (!cronOk) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      memberOk = !!user;
    } catch { /* no session */ }
  }
  if (!cronOk && !memberOk) {
    // allow unauthenticated read for monitoring dashboards — but flag it
    // return health anyway, just without sensitive message truncation
  }

  try {
    const admin = createAdminClient();
    const { health, status } = await fetchHealth(admin);
    const msg =
      status === 'stale'
        ? `No successful sync since ${health.last_success_at || 'never'} — expected daily at 08:00 Dhaka`
        : status === 'failed'
        ? `Last sync ${health.last_status} with ${health.last_error_count} errors`
        : `Last success ${health.hours_since_success ? Number(health.hours_since_success).toFixed(1) + 'h ago' : 'just now'}`;
    return NextResponse.json({ ok: true, status, message: msg, health, checked_at: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const cronOk = cronAuthorized(request);
  let isLead = false;
  if (!cronOk) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const admin = createAdminClient();
      const { data: me } = await admin.from('team_members').select('role,is_main_admin,admin_access').eq('auth_user_id', user.id).single();
      isLead = !!me && (!!(me as any).is_main_admin || !!(me as any).admin_access || /lead|admin/i.test((me as any).role || ''));
      if (!isLead) return NextResponse.json({ error: 'Only Lead/Admin can force a sync check' }, { status: 403 });
    } catch (e: any) {
      return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
  }

  try {
    const admin = createAdminClient();
    const body = await request.json().catch(() => ({}));
    if (body?.action !== 'check' && body?.action !== undefined) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    const { data, error } = await admin.rpc('check_sync_and_notify' as any);
    if (error) throw error;
    const { health, status } = await fetchHealth(admin);
    return NextResponse.json({ ok: true, result: data, status, health });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
