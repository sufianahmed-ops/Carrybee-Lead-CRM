'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { X, Phone, MessageCircle, Copy, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { SearchableSelect } from './searchable-select';
import type { CallLog, Lead, ListValue, Member, Rule, ScriptPoint, Setting } from '@/lib/types';
import { formatDate, formatDateTime, toIsoFromDhakaLocal } from '@/lib/utils';

// Local helpers for the lead-requested-callback date limits.
function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

const profileFields = ['Business ID', 'Business Name', 'Merchant Name', 'Email', 'Fb Link', 'Product Category', 'Parcel Volume', 'Zone', 'Area', 'Existing Courier'] as const;
const profileKeys: Record<string, keyof Lead> = {
  'Business ID': 'business_id', 'Business Name': 'business_name', 'Merchant Name': 'merchant_name', Email: 'email',
  'Fb Link': 'fb_link', 'Product Category': 'product_category', 'Parcel Volume': 'parcel_volume', Zone: 'zone', Area: 'area', 'Existing Courier': 'existing_courier',
};
const listCategories = new Set(['Product Category', 'Parcel Volume', 'Zone', 'Existing Courier']);

export function LeadDrawer({ lead, me, members, rules, lists, scripts, settings, fromQueue, onClose, onSaved }: {
  lead: Lead; me: Member; members: Member[]; rules: Rule[]; lists: ListValue[]; scripts: ScriptPoint[]; settings: Setting[];
  fromQueue: boolean; onClose: () => void; onSaved: (previousId: string, next: boolean) => Promise<void>;
}) {
  const supabase = createClient();
  const isLead = /lead|admin/i.test(me.role) || !!me.admin_access || !!me.is_main_admin;
  // The stage a person is ACTING in today: their own stage, unless an Admin has
  // lent them to the other team. A borrowed LQT helper must see LQT statuses.
  const actingStage = (me as any).lend_stage || (me as any).stage || me.team;
  // Request 18: an Incubation member who OWNS this old-book lead may also run its
  // LQT follow-ups, so LQT-era statuses are offered on that lead only. Owning it is the
  // gate — a lead owned by Tonoy or Zahin still offers nothing, and Qualified stays LQT-only.
  // The row loaded for a list does not carry assigned_to, so fall back to the owner name.
  const ownsThisLead = me.team === 'Incubation' &&
    ((!!lead.assigned_to && lead.assigned_to === me.id) || (!!lead.current_owner && lead.current_owner === me.name));
  const availableRules = useMemo(() => rules.filter(r => r.set_by && r.set_by !== 'System' && (isLead || r.set_by === 'Both' || r.set_by === actingStage || r.set_by === me.team || (r.set_by === 'LQT' && r.status !== 'Qualified' && ownsThisLead))), [rules, isLead, actingStage, me.team, ownsThisLead]);
  const allowedStatuses = availableRules;
  const [status, setStatus] = useState(allowedStatuses.some(r => r.status === lead.current_status) ? lead.current_status : '');
  // "The lead asked to be called later": the date is allowed past the normal limit.
  const [heldBack, setHeldBack] = useState(!!lead.callback_hold);
  const [copied, setCopied] = useState('');
  // Profile field values live in state so the searchable lists stay controlled.
  const [profile, setProfile] = useState<Record<string, string>>(() => Object.fromEntries(profileFields.map(name => [name, String(lead[profileKeys[name]] ?? '')])));
  const [history, setHistory] = useState<CallLog[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [incAgent, setIncAgent] = useState(me.team === 'Incubation' ? me.id : members.find(m => m.team === 'Incubation' && m.active)?.id || '');
  const rule = rules.find(r => r.status === status);
  const settingValue = (key: string, fallback = '') => settings.find(s => s.key === key)?.value ?? fallback;
  const callbackAllowed = settingValue('CALLBACK_OVERRIDE', 'TRUE') === 'TRUE';
  const callbackMaxDays = Number(settingValue('CALLBACK_MAX_DAYS', '90')) || 90;
  // The longest date an agent may pick: the normal limit, or further ahead when the lead asked.
  const latestDate = heldBack && callbackAllowed ? addDays(todayIso(), callbackMaxDays) : (lead.next_date_max || undefined);
  const list = (category: string) => lists.filter(l => l.category === category).map(l => l.value);

  useEffect(() => {
    setStatus(allowedStatuses.some(r => r.status === lead.current_status) ? lead.current_status : '');
    setError('');
    setProfile(Object.fromEntries(profileFields.map(name => [name, String(lead[profileKeys[name]] ?? '')])));
    createClient().from('call_history').select('*').eq('public_lead_id', lead.lead_id)
      .order('call_time', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (!error) setHistory(data as CallLog[]); else setError(error.message); });
  }, [lead.lead_id]); // Reload history when another lead is opened.

  // Copy the number the way a phone dialler wants it: digits only, no spaces or dashes.
  async function copyPhone() {
    const raw = String(lead.phone_clean || lead.phone || '').trim();
    if (!raw) return;
    const value = raw.replace(/[^0-9+]/g, '');
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs a secure context / permission; fall back to a hidden field.
      const el = document.createElement('textarea');
      el.value = value; el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el); el.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(el); }
    }
    setCopied(value);
    setTimeout(() => setCopied(current => current === value ? '' : current), 2000);
  }
  function profileFrom(form: FormData) {
    const profile: Record<string, string> = {};
    for (const name of profileFields) profile[name] = String(form.get(`profile_${name}`) || '').trim();
    return profile;
  }
  async function saveCall(e: FormEvent<HTMLFormElement>, next = false) {
    e.preventDefault();
    if (!status) return setError('Choose the outcome of the call.');
    const form = new FormData(document.getElementById('call-form') as HTMLFormElement);
    setBusy(true); setError('');
    const payload = {
      leadId: lead.lead_id, status, reason: String(form.get('reason') || ''), channel: String(form.get('channel') || ''),
      points: form.getAll('points').map(Number), nextDate: rule?.needs_next_date ? String(form.get('nextDate') || '') : '',
      note: String(form.get('note') || ''), profile: profileFrom(form),
      bookedTime: status === 'Qualified' ? toIsoFromDhakaLocal(String(form.get('bookedTime') || '')) : '',
      handoverNote: String(form.get('handoverNote') || ''), tripDate: String(form.get('tripDate') || ''),
      tripCid: String(form.get('tripCid') || ''), onboardedForm: String(form.get('onboardedForm') || ''), pickupMiss: String(form.get('pickupMiss') || ''),
      heldBack: heldBack && !!rule?.needs_next_date,
    };
    const { error } = await supabase.rpc('log_call', { p: payload });
    setBusy(false);
    if (error) return setError(error.message);
    await onSaved(lead.lead_id, next);
  }
  async function saveProfile() {
    const form = new FormData(document.getElementById('call-form') as HTMLFormElement);
    setBusy(true); setError('');
    const { error } = await supabase.rpc('update_profile', { p: { leadId: lead.lead_id, profile: profileFrom(form) } });
    setBusy(false);
    if (error) return setError(error.message);
    await onSaved(lead.lead_id, false);
  }
  async function accept() {
    setBusy(true); setError('');
    const { error } = await supabase.rpc('accept_handover', { p: { leadIds: [lead.lead_id], agentId: incAgent } });
    setBusy(false);
    if (error) return setError(error.message);
    await onSaved(lead.lead_id, false);
  }
  async function giveBack() {
    const reason = String(new FormData(document.getElementById('call-form') as HTMLFormElement).get('returnReason') || '');
    setBusy(true); setError('');
    const { error } = await supabase.rpc('return_handover', { p: { leadId: lead.lead_id, reason } });
    setBusy(false);
    if (error) return setError(error.message);
    await onSaved(lead.lead_id, false);
  }

  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="drawer" aria-label={`Lead ${lead.lead_id}`}>
      {busy && <div className="busy" />}
      <div className="drawer-head"><div>
        <h2>{lead.business_name || lead.merchant_name || lead.lead_id}</h2>
        <div className="mute small">{lead.merchant_name || 'No merchant name'} · {lead.lead_id}</div>
        <div className="row" style={{ marginTop: 7 }}>
          <a className="btn" href={`tel:${lead.phone_clean}`}><Phone />{lead.phone_clean}</a>
          <button type="button" className="btn" onClick={copyPhone} aria-label={copied ? 'Phone number copied' : 'Copy phone number'} title="Copy phone number">
            {copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy'}
          </button>
          <a className="btn" target="_blank" rel="noreferrer" href={`https://wa.me/88${lead.phone_clean}`}><MessageCircle />WhatsApp</a>
        </div>
      </div><button className="btn icon" onClick={onClose} aria-label="Close"><X /></button></div>
      <div className="tags"><span className="tag status">{lead.current_status}</span>
        {/* Due-date chip: coloured dot + state + date always visible in drawer header */}
        {lead.due_state && <span className={`tag ${/overdue/i.test(lead.due_state) ? 'bad' : /today/i.test(lead.due_state) ? 'warn' : ''}`}>{/overdue/i.test(lead.due_state) ? '● ' : /today/i.test(lead.due_state) ? '◐ ' : ''}{lead.due_state}{lead.next_due_date ? ` · ${formatDate(lead.next_due_date)}` : ''}</span>}
        {!lead.due_state && lead.next_due_date && <span className="tag">Due {formatDate(lead.next_due_date)}</span>}
        {lead.callback_hold && lead.callback_date && <span className="tag good">Callback {formatDate(lead.callback_date)}</span>}
        {lead.pickup_state === 'LastChance' && <span className="tag bad">Pickup expires today</span>}
        {lead.trip_deadline && <span className="tag" title="Trip deadline">Trip {formatDate(String(lead.trip_deadline).slice(0,10))}</span>}
      </div>
      {lead.alert && <div className="banner bad">{lead.alert}</div>}
      {lead.return_reason && <div className="banner warn"><b>Returned by Incubation:</b> {lead.return_reason}</div>}
      {lead.must_close_next_call === 'Yes' && <div className="banner warn">This is the last LQT touch. Log Qualified, CNR or a final status.</div>}
      <div className="facts">
        {([['Source', lead.source], ['Funnel', lead.funnel], ['Business ID', lead.business_id], ['Registration Date', lead.registration_date], ['Qualified By', lead.qualified_by_name], ['Qualified On', lead.qualified_at ? formatDate(String(lead.qualified_at).slice(0, 10)) : ''], ['Assigned To', lead.assigned_to_name], ['Current Owner', lead.current_owner], ['Assign Date', lead.assign_date], ['First Contact', lead.first_contact_date], ['LQT Touches', lead.lqt_touches], ['CNR Count', lead.cnr_count], ['Points Covered', `${lead.points_covered} of ${scripts.length}`], ['Stage', lead.stage], ['Trip Deadline', lead.trip_deadline], ['1st Trip Date', lead.first_trip_date], ['First Order Date', lead.first_order_date], ['Care End Date', lead.care_end_date], ['Care Days Left', lead.care_days_left]] as [string, any][]).filter(([, value]) => value !== '' && value != null).map(([name, value]) => <div key={name}><span>{name}:</span> {String(value)}</div>)}
      </div>
      {lead.sheet_notes && <p className="mute small">Sheet notes: {lead.sheet_notes}</p>}

      <form id="call-form" onSubmit={e => saveCall(e, false)}>
        {lead.current_status === 'Qualified' && <section className="section"><h3>Handover from LQT</h3>
          <p className="mute small">Booked call: <b>{formatDateTime(lead.handover_booked_time)}</b> ({lead.handover_call_state || 'Pending'})<br />{lead.handover_note}</p>
          {(isLead || me.team === 'Incubation') && <div className="form-grid">
            <label className="field">Incubation agent<select className="select" value={incAgent} onChange={e => setIncAgent(e.target.value)}>{members.filter(m => m.active && m.team === 'Incubation').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label className="field">&nbsp;<button type="button" className="btn primary" onClick={accept} disabled={busy}>Accept handover</button></label>
            <label className="field full">Return to LQT — reason<input name="returnReason" className="input" placeholder="What is missing or wrong?" /></label>
            <button type="button" className="btn danger" onClick={giveBack} disabled={busy}>Return to LQT</button>
          </div>}
        </section>}

        <section className="section"><h3>Log this call</h3>
          {(me as any).lend_stage && <p className="mute small">Helping <b>{(me as any).lend_stage}</b> today — the statuses below are the {(me as any).lend_stage} ones, and the call is logged as {(me as any).lend_stage} work, not {(me as any).stage || me.team}.</p>}
          <div className="form-grid">
            <label className="field">Outcome / status<select className="select" required value={status} onChange={e => setStatus(e.target.value)}><option value="">Choose…</option>{allowedStatuses.map(r => <option key={r.status}>{r.status}</option>)}</select></label>
            <label className="field">Reason<select name="reason" className="select" required={rule?.reason_required}><option value="">{rule?.reason_required ? 'Choose a reason…' : '-'}</option>{rule?.allowed_reasons.map(r => <option key={r}>{r}</option>)}</select></label>
            <label className="field">Channel<select name="channel" className="select" defaultValue="Phone call">{list('Channel').map(x => <option key={x}>{x}</option>)}</select></label>
            {rule?.needs_next_date && <label className="field">Next follow-up date<input name="nextDate" className="input" type="date" required defaultValue={lead.next_date_default || ''} max={latestDate} />{heldBack && callbackAllowed
              ? <span>Lead-requested wait · up to {callbackMaxDays} days ({addDays(todayIso(), callbackMaxDays)})</span>
              : lead.next_date_max ? <span>Latest allowed: {lead.next_date_max}</span> : null}</label>}
          </div>
          {rule?.needs_next_date && callbackAllowed && <div className="callback-hold">
            <label className="checkbox"><input type="checkbox" checked={heldBack} onChange={e => setHeldBack(e.target.checked)} />
              <b>Lead asked for a later call</b></label>
            <span className="mute small">{heldBack
              ? `Book any date up to ${callbackMaxDays} days ahead. The lead is parked as "Callback requested" and stops counting as overdue until then — the SLA clock pauses.`
              : 'Tick this when the lead asks to be called after the normal follow-up window, e.g. "call me next month".'}</span>
          </div>}
          {status === 'Qualified' && <div className="form-grid">
            <label className="field full">Booked call with Incubation (Dhaka time)<input name="bookedTime" className="input" type="datetime-local" required /></label>
            <label className="field full">Handover note — needs, expected parcels, pickup<textarea name="handoverNote" className="input" rows={3} required /></label>
          </div>}
          {rule?.stage === 'Incubation' && <div className="form-grid">
            <label className="field">1st trip date<input name="tripDate" className="input" type="date" defaultValue={lead.first_trip_date || ''} /></label>
            <label className="field">1st trip CID<input name="tripCid" className="input" defaultValue={lead.first_trip_cid} /></label>
            <label className="field">Onboarded form<select name="onboardedForm" className="select" defaultValue={lead.onboarded_form}><option value="">-</option>{list('Yes/No').map(x => <option key={x}>{x}</option>)}</select></label>
            <label className="field">Pickup miss<select name="pickupMiss" className="select" defaultValue={lead.pickup_miss}><option value="">-</option>{list('Yes/No').map(x => <option key={x}>{x}</option>)}</select></label>
          </div>}
          <div className="points"><b>Talking points <span className="mute small">({lead.points_covered} of {scripts.length} covered)</span></b>
            <p className="mute small" style={{ margin: '2px 0 8px' }}>Optional on a normal call — tick what you actually covered. All {scripts.length} are required before the lead can be marked <b>Qualified</b>.</p>
            {scripts.map(p => { const done = lead.points?.includes(p.point_number); return <label className={`checkbox ${done ? 'done' : ''}`} key={p.point_number}><input type="checkbox" name="points" value={p.point_number} defaultChecked={done} disabled={done} />{p.talking_point}{done ? ' (covered)' : ''}</label>; })}
          </div>
          <label className="field">Call note<textarea name="note" className="input" rows={3} placeholder="What the merchant said; next step" /></label>
        </section>

        <details open={!!lead.missing_business_id}><summary>Lead details <span className="mute small">(saved with the call, or separately)</span></summary>
          <div className="form-grid">{profileFields.map(name => {
            const value = profile[name] ?? '';
            const setValue = (next: string) => setProfile(current => ({ ...current, [name]: next }));
            if (name === 'Product Category') return <label className="field" key={name}>{name}
              <SearchableSelect name={`profile_${name}`} options={list(name)} value={value} onChange={setValue}
                searchPlaceholder="Type a category, e.g. cloth, food, gadget" emptyText="No category matches" />
            </label>;
            return <label className="field" key={name}>{name}{listCategories.has(name) ? <select className="select" name={`profile_${name}`} value={value} onChange={e => setValue(e.target.value)}><option value="">-</option>{list(name).map(x => <option key={x}>{x}</option>)}</select> : <input className="input" name={`profile_${name}`} value={value} onChange={e => setValue(e.target.value)} />}</label>;
          })}</div>
          <button className="btn" type="button" onClick={saveProfile} disabled={busy}>Save details only</button>
        </details>
        <div className="error" role="alert">{error}</div>
        <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save call'}</button>{fromQueue && <button className="btn primary" type="button" disabled={busy} onClick={e => saveCall(e as any, true)}>Save and next call</button>}</div>
      </form>

      <section className="section"><h3>Call history</h3><div className="history">
        {history.length ? history.map(log => <div className="history-item" key={log.id}>
          <b>{formatDateTime(log.call_time)}</b> · {log.agent_name} ({log.team}) · {log.event_type} {log.entry_source === 'Legacy' && <span className="tag">old tracker</span>}
          {log.status && <div className="tags"><span className="tag status">{log.status}</span>{log.reason && <span>{log.reason}</span>}</div>}
          {log.next_date && <div>Next: {log.next_date}</div>}{log.note && <p>{log.note}</p>}
        </div>) : <span className="mute">No calls logged yet.</span>}
      </div></section>
    </aside>
  </div>;
}
