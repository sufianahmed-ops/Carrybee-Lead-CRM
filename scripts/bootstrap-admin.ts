import './env';
import { createAdminClient } from '../lib/supabase/admin';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME || 'CRM Admin';
  if (!email) throw new Error('Set ADMIN_EMAIL in .env.local');
  const admin = createAdminClient();
  const site = process.env.APP_URL || 'http://localhost:3000';
  const { data: invite, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/callback` });
  if (error) throw error;
  const { data: existing } = await admin.from('team_members').select('id').eq('email', email).maybeSingle();
  const row = { name, email, team: 'Management', role: 'Admin', active: true, auth_user_id: invite.user.id, employee_id: 'ADMIN' };
  const { error: saveError } = existing?.id
    ? await admin.from('team_members').update(row).eq('id', existing.id)
    : await admin.from('team_members').insert(row);
  if (saveError) throw saveError;
  console.log(`Admin invitation sent to ${email}. Open the email and set a password.`);
}
main().catch(e => { console.error(e); process.exit(1); });
