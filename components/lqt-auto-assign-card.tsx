'use client';
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function LqtAutoAssignCard() {
  const supabase = createClient();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [cap, setCap] = useState('30');
  const [today, setToday] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('key,value').in('key', ['LQT_AUTO_ASSIGN_ENABLED', 'LQT_AUTO_ASSIGN_DAILY_CAP']);
    if (data) {
      setEnabled((data.find(d => d.key === 'LQT_AUTO_ASSIGN_ENABLED')?.value || 'true') === 'true');
      setCap(data.find(d => d.key === 'LQT_AUTO_ASSIGN_DAILY_CAP')?.value || '30');
    }
    const { data: t } = await supabase.rpc('crm_today' as any);
    const todayStr = (t as any) ? String(t) : new Date().toISOString().slice(0,10);
    const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assign_date', todayStr);
    setToday(count ?? null);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setMsg('');
    const res = await fetch('/api/admin/auto-assign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, cap: Number(cap) })
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) setMsg(j.error || 'Failed');
    else { setMsg('Saved — auto-assign ' + (j.enabled ? 'ON' : 'OFF') + ', cap ' + j.cap + '/agent/day'); load(); }
  }

  if (enabled === null) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>LQT auto-assign — New leads</h2>
      <p className="mute small">
        When a <b>Self Registered</b> lead lands with <code>registration_date ≥ LQT_CUTOVER_DATE (2026-11-01)</code> and no owner, it is auto-assigned to the LQT agent with fewest <b>received today / open LQT</b> (skips <code>on_leave</code>, respects daily cap). Runs as a <code>BEFORE INSERT</code> trigger — no cron. Turn off for bulk-import days.
      </p>
      <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 10 }}>
        <label className="field" style={{ minWidth: 140 }}>
          <span>Auto-assign</span>
          <select className="select" value={enabled ? 'true' : 'false'} onChange={e => setEnabled(e.target.value === 'true')}>
            <option value="true">ON — auto-route New LQT</option>
            <option value="false">OFF — leave unassigned for bulk</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 140 }}>
          <span>Daily cap / agent</span>
          <input className="input" type="number" min={1} max={200} value={cap} onChange={e => setCap(e.target.value)} />
        </label>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <span className="mute small">Today assigned: <b>{today ?? '—'}</b> leads (assign_date = crm_today())</span>
      </div>
      {msg && <div className="banner status" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
