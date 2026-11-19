import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({ careDays: z.number().int().min(1).max(365) });

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
    const { data: actor } = await supabase.from('team_members').select('role').eq('auth_user_id', user.id).eq('active', true).single();
    if (!actor || !/lead|admin/i.test(actor.role)) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    const input = schema.parse(await request.json());
    const { error } = await supabase.rpc('update_care_days', { days: input.careDays });
    if (error) throw error;
    return NextResponse.json({ ok: true, careDays: input.careDays });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 400 });
  }
}
