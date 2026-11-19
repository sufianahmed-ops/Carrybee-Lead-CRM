import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const schema = z.object({
  memberId: z.string().uuid().optional(), name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(), team: z.enum(['LQT','Incubation','Management']),
  role: z.string().trim().min(2).max(40), employeeId: z.string().trim().max(40).optional(),
});
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
    const { data: actor } = await supabase.from('team_members').select('role').eq('auth_user_id', user.id).eq('active', true).single();
    if (!actor || !/lead|admin/i.test(actor.role)) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
    const input = schema.parse(await request.json());
    const admin = createAdminClient();
    if (input.memberId) {
      const { data: existing } = await admin.from('team_members').select('auth_user_id').eq('id', input.memberId).single();
      if (existing?.auth_user_id) return NextResponse.json({ error: 'This member is already linked to an Auth account.' }, { status: 409 });
    }
    const origin = new URL(request.url).origin;
    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo: `${origin}/auth/callback` });
    if (inviteError) throw inviteError;
    const row = { name: input.name, email: input.email, team: input.team, role: input.role, employee_id: input.employeeId || null, auth_user_id: invite.user.id, active: true };
    const query = input.memberId ? admin.from('team_members').update(row).eq('id', input.memberId) : admin.from('team_members').insert(row);
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true, email: input.email });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 400 });
  }
}
