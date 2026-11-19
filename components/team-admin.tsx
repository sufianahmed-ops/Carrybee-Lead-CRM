'use client';
import { FormEvent, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Member, Setting } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { LqtAutoAssignCard } from './lqt-auto-assign-card';

export function TeamAdmin({ members, settings, me, onChanged }: { members: Member[]; settings: Setting[]; me: Member; onChanged: () => Promise<void> }) {
  const [memberId, setMemberId] = useState('');
  const [careDays, setCareDays] = useState(settings.find(s => s.key === 'CARE_DAYS')?.value || '30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [runs, setRuns] = useState<any[]>([]);
  const selected = members.find(m => m.id === memberId);
  const isMainAdmin = !!me?.is_main_admin;
  const isAdmin = !!members.find(m => m.is_main_admin || m.admin_access);
  // Works stage, Today and lending are limited to the Main Admin and the people
  // manager (currently Sazzad). A granted Admin can do admin work but not move people.
  const canManagePeople = !!me && (!!me.is_main_admin || !!me.can_manage_people);
  async function loadRuns() {
    const { data } = await createClient().from('backup_runs').select('*').order('started_at', { ascending: false }).limit(8);
    setRuns(data || []);
  }
  useEffect(() => { loadRuns(); }, []);
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    const payload = { memberId: memberId || undefined, name: String(f.get('name')), email: String(f.get('email')), team: String(f.get('team')), role: String(f.get('role')), employeeId: String(f.get('employeeId')) };
    const response = await fetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setError(result.error);
    setMessage(`Invitation sent to ${result.email}. The member can set a password from that email.`);
    setMemberId(''); formElement.reset(); await onChanged();
  }
  async function saveStage(member: Member, stage: string) {
    setBusy(true); setError(''); setMessage('');
    const { error } = await createClient().rpc('set_member_stage', { p: { memberId: member.id, stage } });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(`${member.name} now works the ${stage} stage.`);
    await onChanged();
  }
  async function grantAccess(member: Member) {
    setBusy(true); setError(''); setMessage('');
    const { data, error } = await createClient().rpc('grant_admin_access', { p: { memberId: member.id, adminAccess: !member.admin_access } });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(data?.admin_access ? `${member.name} now has Admin access.` : `Admin access removed from ${member.name}.`);
    await onChanged();
  }
  async function startLend(member: Member) {
    const target = (member.stage || member.team) === 'LQT' ? 'Incubation' : 'LQT';
    const stage = window.prompt(`Lend ${member.name} to which stage for today? Type LQT or Incubation.`, target);
    if (!stage) return;
    const cap = window.prompt(`How many leads may ${member.name} take today while borrowed?`, '10');
    if (cap === null) return;
    const reason = window.prompt('Reason (shows in the log), e.g. LQT overflow after two sick days', '') || '';
    setBusy(true); setError(''); setMessage('');
    const { data, error } = await createClient().rpc('set_member_lending', { p: { memberId: member.id, active: true, stage: stage.trim(), cap: Number(cap), reason } });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(`${data?.member} is helping ${data?.lent_to_stage} today, up to ${data?.cap} leads. They go back to their own stage when you end it.`);
    await onChanged();
  }
  async function endLend(member: Member) {
    setBusy(true); setError(''); setMessage('');
    const { data, error } = await createClient().rpc('set_member_lending', { p: { memberId: member.id, active: false } });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(`${data?.member} is back on their own stage.`);
    await onChanged();
  }
  async function toggleLeave(member: Member) {
    setBusy(true); setError(''); setMessage('');
    const { data, error } = await createClient().rpc('set_member_leave', { p: { memberId: member.id, onLeave: !member.on_leave } });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(`${member.name} is ${data?.on_leave ? 'marked out today — left out of rotations' : 'back in today'}.`);
    await onChanged();
  }
  async function saveCareDays(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    const response = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ careDays: Number(careDays) }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) return setError(result.error);
    setMessage(`Care period updated to ${result.careDays} days. Care queues recalculate automatically.`);
    await onChanged();
  }
  return <>
    <h1 className="page-title">Team & system</h1><p className="subtitle">Invite team members with Supabase Auth and monitor the independent Google Sheets backup.</p>
    {busy && <div className="busy" />}<div className="admin-grid">
      <div className="card"><h2 className="section-title" style={{ marginTop: 0 }}>Invite a member</h2>
        <p className="mute small">Select a seeded agent to attach their email, or choose “New member”. They will receive a secure invitation link.</p>
        <form onSubmit={invite} key={memberId || 'new'}><div className="stack">
          <label className="field">Existing member<select className="select" value={memberId} onChange={e => setMemberId(e.target.value)}><option value="">New member</option>{members.filter(m => !m.auth_user_id).map(m => <option key={m.id} value={m.id}>{m.name} — {m.team}</option>)}</select></label>
          <label className="field">Full name<input className="input" name="name" required defaultValue={selected?.name || ''} /></label>
          <label className="field">Work email<input className="input" name="email" type="email" required defaultValue={selected?.email || ''} placeholder="agent@carrybee.com" /></label>
          <label className="field">Team<select className="select" name="team" defaultValue={selected?.team || 'LQT'}><option>LQT</option><option>Incubation</option><option>Management</option></select></label>
          <label className="field">Role<select className="select" name="role" defaultValue={selected?.role || 'Agent'}><option>Agent</option><option>Team Lead</option><option>Admin</option></select></label>
          <label className="field">Employee ID (optional)<input className="input" name="employeeId" defaultValue={selected?.employee_id || ''} /></label>
          <div className="error">{error}</div>{message && <div className="success small">{message}</div>}
          <button className="btn primary" disabled={busy}>Send email invitation</button>
        </div></form>
      </div>
    </div>
    <div className="card" style={{ marginTop: 16 }}><h2 className="section-title" style={{ marginTop: 0 }}>Members</h2><p className="mute small">“Works stage” is the stage a person actually handles — it can differ from their team, and rotations follow it. “In today” can be switched off for a sick day; that person then drops out of the rotations but you can still hand them a single lead. <b>Admin access</b> lets someone do Admin-only work (such as moving a lead across stages). Only the Main Admin can give or take it — the button sits in this table, and every grant is recorded with who gave it and when. <b>Borrowed for today</b> lends a person to the other team for the day with their own lead limit; they go back to their own stage when you press End. <b>Works stage, Today and Lending are restricted</b> to the Main Admin and the people manager (Sazzad) — everyone else sees them greyed out.</p><div className="table-wrap" style={{ boxShadow: 'none' }}><table style={{ minWidth: 1240 }}><thead><tr><th>Name</th><th>Email</th><th>Team</th><th>Works stage</th><th>Today</th><th>Role</th><th>Admin access</th><th>Borrowed for today</th><th>Login</th></tr></thead><tbody>{members.map(m => <tr key={m.id}><td><b>{m.name}</b><br /><span className="mute small">{m.employee_id}</span></td><td>{m.email || 'Not invited'}</td><td>{m.team}</td><td><select className="select" style={{ minWidth: 128 }} value={m.stage || m.team} disabled={busy || !canManagePeople} title={canManagePeople ? '' : 'Only the Main Admin or a people manager can change this'} onChange={e => saveStage(m, e.target.value)}><option>LQT</option><option>Incubation</option></select></td><td><span className={`tag ${m.on_leave ? 'warn' : 'good'}`}>{m.on_leave ? 'Out' : 'In'}</span>{' '}<button className="btn small" disabled={busy || !canManagePeople} title={canManagePeople ? '' : 'Only the Main Admin or a people manager can change this'} onClick={() => toggleLeave(m)}>{m.on_leave ? 'Bring back' : 'Mark out'}</button></td><td>{m.role}</td><td>{m.is_main_admin ? <span className="tag good">Main Admin</span> : m.admin_access ? <><span className="tag good">Admin (granted)</span>{' '}<button className="btn small" disabled={busy || !isMainAdmin} onClick={() => grantAccess(m)}>Remove</button></> : <><span className="tag">No</span>{' '}<button className="btn small" disabled={busy || !isMainAdmin} onClick={() => grantAccess(m)}>Give access</button></>}</td><td>{m.lend_stage ? <><span className="tag good">Helping {m.lend_stage}</span><br /><span className="mute small">cap {m.lend_cap} today</span><br /><button className="btn small" disabled={busy || !canManagePeople} onClick={() => endLend(m)}>End</button></> : <button className="btn small" disabled={busy || !canManagePeople} title={canManagePeople ? '' : 'Only the Main Admin or a people manager can change this'} onClick={() => startLend(m)}>Lend…</button>}</td><td><span className={`status-dot ${m.auth_user_id ? 'on' : ''}`} />{m.auth_user_id ? 'Active login' : 'Invitation needed'}</td></tr>)}</tbody></table></div></div>
    <LqtAutoAssignCard />
    <div className="card"><h2 className="section-title" style={{ marginTop: 0 }}>Care period</h2><p className="mute small">Today − First Order Date determines the care period. If no report exists, the CRM uses 1st Trip Date.</p><form onSubmit={saveCareDays}><div className="row"><label className="field grow">Care duration (days)<input className="input" type="number" min="1" max="365" required value={careDays} onChange={e => setCareDays(e.target.value)} /></label><button className="btn primary" disabled={busy}>Save care setting</button></div></form></div>
    <div className="card"><div className="row"><div className="grow"><h2 className="section-title" style={{ margin: 0 }}>Google Sheets backup</h2><p className="mute small">Dhaka time: Sat–Thu hourly 10 AM–8 PM; Friday 10 AM, 3 PM and 8 PM. Run the first manual backup from the bound backup spreadsheet before activating its schedule.</p></div></div>
      <div className="table-wrap" style={{ boxShadow: 'none', marginTop: 15 }}><table style={{ minWidth: 650 }}><thead><tr><th>Started</th><th>Status</th><th>Leads</th><th>Logs</th><th>Triggered by</th><th>Message</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td>{formatDateTime(r.started_at)}</td><td><span className={`tag ${r.status === 'success' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}`}>{r.status}</span></td><td>{r.leads_count}</td><td>{r.calls_count}</td><td>{r.triggered_by}</td><td>{r.message}</td></tr>)}</tbody></table></div>
    </div>
  </>;
}
