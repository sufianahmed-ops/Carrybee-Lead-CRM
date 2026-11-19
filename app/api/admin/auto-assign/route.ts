import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const schema = z.object({
  enabled: z.boolean(),
  cap: z.number().int().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
    const { data: actor } = await supabase.from('team_members').select('role,is_main_admin,admin_access').eq('auth_user_id', user.id).eq('active', true).single();
    const isLead = !!actor && (!!(actor as any).is_main_admin || !!(actor as any).admin_access || /lead|admin/i.test((actor as any).role || ''));
    if (!isLead) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    const input = schema.parse(await request.json());
    const admin = createAdminClient();
    await admin.from('app_settings').upsert({ key: 'LQT_AUTO_ASSIGN_ENABLED', value: input.enabled ? 'true' : 'false' }, { onConflict: 'key' });
    await admin.from('app_settings').upsert({ key: 'LQT_AUTO_ASSIGN_DAILY_CAP', value: String(input.cap) }, { onConflict: 'key' });
    return NextResponse.json({ ok: true, enabled: input.enabled, cap: input.cap });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 400 });
  }
}
