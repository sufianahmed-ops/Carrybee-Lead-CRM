'use client';
import { FormEvent, useState } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { ListValue, Member } from '@/lib/types';

export function AddLead({ members, lists, onClose, onSaved }: { members: Member[]; lists: ListValue[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    const f = new FormData(e.currentTarget);
    const payload = {
      source: String(f.get('source') || ''), phone: String(f.get('phone') || ''), merchantName: String(f.get('merchantName') || ''),
      businessName: String(f.get('businessName') || ''), businessId: String(f.get('businessId') || ''), email: String(f.get('email') || ''),
      assignedTo: String(f.get('assignedTo') || ''), assignDate: String(f.get('assignDate') || ''),
    };
    const { error } = await createClient().rpc('add_lead', { p: payload });
    setBusy(false);
    if (error) return setError(error.message);
    await onSaved();
  }
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="drawer">
    {busy && <div className="busy" />}<div className="drawer-head"><div><h2>Add lead</h2><p className="mute">Add one lead directly to Supabase.</p></div><button className="btn icon" onClick={onClose}><X /></button></div>
    <form onSubmit={submit}><div className="form-grid">
      <label className="field">Source<select className="select" name="source"><option value="">-</option>{lists.filter(x => x.category === 'Source').map(x => <option key={x.value}>{x.value}</option>)}</select></label>
      <label className="field">Phone *<input className="input" name="phone" required placeholder="01XXXXXXXXX" /></label>
      <label className="field">Merchant name<input className="input" name="merchantName" /></label>
      <label className="field">Business name<input className="input" name="businessName" /></label>
      <label className="field">Business ID<input className="input" name="businessId" /></label>
      <label className="field">Email<input className="input" type="email" name="email" /></label>
      <label className="field">Assigned to<select className="select" name="assignedTo"><option value="">-</option>{members.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name} — {m.team}</option>)}</select></label>
      <label className="field">Assign date<input className="input" type="date" name="assignDate" /></label>
    </div><div className="error">{error}</div><button className="btn primary" disabled={busy}>Add lead</button></form>
  </aside></div>;
}
