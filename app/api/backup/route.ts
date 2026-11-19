import { NextResponse } from 'next/server';
import { runBackup } from '@/lib/backup';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function authorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) return 'cron';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await supabase.from('team_members').select('role').eq('auth_user_id', user.id).eq('active', true).single();
  return member && /lead|admin/i.test(member.role) ? user.email || 'admin' : null;
}
async function handler(request: Request) {
  const actor = await authorized(request);
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await runBackup(actor)); }
  catch (error: any) { return NextResponse.json({ error: error.message || String(error) }, { status: 500 }); }
}
export const GET = handler;
export const POST = handler;
