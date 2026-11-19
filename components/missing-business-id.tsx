'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Handshake, Search, X } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead } from '@/lib/types';

/**
 * Missing Business ID (LQT).
 *
 * A lead cannot leave the LQT book without a Business ID — the database refuses to mark it
 * Qualified or any final status while it is blank. So a blank Business ID is LQT's problem to
 * close, not an administration report: the LQT agents who own these leads are exactly the people
 * who can get the ID from the merchant.
 *
 * This view is therefore owned by LQT: an LQT agent sees the leads they own, an LQT Lead sees the
 * whole LQT book. Saving writes the Business ID straight to the lead, after checking it is not
 * already used by another lead.
 */
export function MissingBusinessId({ supabase, leads, mine, isLqtLead, onOpenLead, onSaved }: {
  supabase: SupabaseClient;
  leads: Lead[];
  mine: string;
  isLqtLead: boolean;
  onOpenLead: (leadRef: string) => void;
  onSaved: () => void;
}) {
  const [onlyMine, setOnlyMine] = useState(!isLqtLead);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => { setOnlyMine(!isLqtLead); }, [isLqtLead]);

  const missing = leads.filter(l => l.missing_business_id === 'Missing' && l.stage === 'LQT');
  const q = query.trim().toLowerCase();
  const rows = missing
    .filter(l => (onlyMine ? l.current_owner === mine : true))
    .filter(l => !q || [l.lead_id, l.business_name, l.merchant_name, l.phone, l.phone_clean]
      .some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.lead_id).localeCompare(String(b.lead_id)));

  const counts = { all: missing.length, mine: missing.filter(l => l.current_owner === mine).length };

  const save = useCallback(async (lead: Lead) => {
    const value = (draft[lead.id] || '').trim();
    setError(''); setNote('');
    if (!value) { setError('Type the Business ID before saving.'); return; }
    setSaving(lead.id);
    // Save through update_profile, the same path the lead drawer uses: it re-checks that the
    // Business ID is not already linked to another lead and writes an audit row to call_logs.
    // A direct table update would skip both.
    const { error: err } = await supabase.rpc('update_profile', {
      p: { leadId: lead.lead_id, profile: { 'Business ID': value } },
    });
    setSaving(null);
    if (err) { setError(err.message.replace(/^.*?ERROR:\s*/i, '')); return; }
    setDraft(d => ({ ...d, [lead.id]: '' }));
    setNote(`${lead.lead_id} now has Business ID ${value}.`);
    onSaved();
  }, [draft, supabase, onSaved]);

  return <div className="list-view">
    <div className="list-head mbib">
      <div className="mbib-top">
        <h1 className="page-title">Missing Business ID</h1>
        <span className="mbib-pill">{counts.mine} of yours · {counts.all} in LQT</span>
      </div>
      <p className="subtitle" style={{ margin: '2px 0 0' }}>
        A lead cannot be qualified or closed without a Business ID — the CRM will not take the
        status until this is filled. Get the ID from the merchant, then save it here.
      </p>
      <div className="mbib-tools">
        <div className="search" style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
          <Search style={{ position: 'absolute', left: 10, top: 9, width: 16, color: 'var(--mute)' }} />
          <input className="input" style={{ paddingLeft: 33, width: '100%' }} placeholder="Search lead, business or phone"
            value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {isLqtLead && <div className="seg">
          <button className={onlyMine ? 'on' : ''} onClick={() => setOnlyMine(true)}>My leads ({counts.mine})</button>
          <button className={!onlyMine ? 'on' : ''} onClick={() => setOnlyMine(false)}>Whole LQT book ({counts.all})</button>
        </div>}
      </div>
      {note && <p className="mbib-ok"><Check size={14} />{note}</p>}
      {error && <p className="mbib-bad"><AlertCircle size={14} />{error}</p>}
    </div>

    <div className="list-body">
      {!rows.length && <p className="empty">{missing.length
        ? 'No lead matches this search.'
        : 'Every LQT lead has a Business ID. Nothing to fix.'}</p>}
      {!!rows.length && <div className="table-wrap"><table>
        <thead><tr>
          <th>Lead</th><th>Business</th><th>Phone</th><th>Owner</th><th>Status</th><th style={{ minWidth: 260 }}>Business ID</th>
        </tr></thead>
        <tbody>{rows.map(l => <tr key={l.id}>
          <td><button className="link" onClick={() => onOpenLead(l.lead_id)}>{l.lead_id}</button></td>
          <td><div className="cell-clip" title={l.business_name || l.merchant_name}>{l.business_name || l.merchant_name || '—'}</div></td>
          <td>{l.phone}</td>
          <td>{l.current_owner || 'Unassigned'}</td>
          <td>{l.current_status}</td>
          <td>
            <div className="mbib-save">
              <input className="input" placeholder="Type the Business ID" value={draft[l.id] || ''}
                onChange={e => setDraft(d => ({ ...d, [l.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') save(l); }} />
              <button className="btn primary" disabled={saving === l.id} onClick={() => save(l)}>
                {saving === l.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          </td>
        </tr>)}</tbody>
      </table></div>}
      {!!rows.length && <div className="pager">
        <span>Showing 1–{rows.length} of {rows.length}{onlyMine ? ' owned by you' : ''}</span>
        <span className="mute">Page 1 of 1</span>
      </div>}
    </div>
  </div>;
}
