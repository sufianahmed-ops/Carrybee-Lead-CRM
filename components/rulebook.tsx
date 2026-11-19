'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Every follow-up rule in one place.
 *
 * Nothing here is hard-coded: the fields, their grouping, their limits and their
 * help text all come from public.setting_specs, and the values from
 * public.app_settings. Add a row to setting_specs and it appears on this screen.
 * Saving goes through update_settings(), which validates against the same table,
 * so the screen and the server can never disagree about what is allowed.
 */
type Spec = {
  key: string; label: string; group: string; kind: 'int' | 'bool' | 'date' | 'csv' | 'text';
  min: number | null; max: number | null; unit: string | null; note: string | null; value: string;
};

export function Rulebook() {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await createClient().rpc('settings_specs');
    setLoading(false);
    if (error) return setError(error.message);
    const list = (data || []) as Spec[];
    setSpecs(list);
    setDraft(Object.fromEntries(list.map(s => [s.key, s.value])));
  }
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const byGroup = new Map<string, Spec[]>();
    specs.forEach(s => {
      if (!byGroup.has(s.group)) byGroup.set(s.group, []);
      byGroup.get(s.group)!.push(s);
    });
    return [...byGroup.entries()];
  }, [specs]);

  const changed = specs.filter(s => (draft[s.key] ?? '') !== s.value);

  async function save() {
    if (!changed.length) return;
    setBusy(true); setError(''); setMessage('');
    const payload = Object.fromEntries(changed.map(s => [s.key, draft[s.key]]));
    const { data, error } = await createClient().rpc('update_settings', { p: payload });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(`${(data?.applied || []).length} rule${(data?.applied || []).length === 1 ? '' : 's'} saved. They apply to the next call logged — no deploy needed.`);
    await load();
  }
  function reset() { setDraft(Object.fromEntries(specs.map(s => [s.key, s.value]))); setError(''); setMessage(''); }

  if (loading) return <div className="card">Loading the rulebook…</div>;

  return <>
    <h1 className="page-title">Follow-up rulebook</h1>
    <p className="subtitle">Timings, gates and caps the CRM enforces. Change them here — every lead recalculates from these values immediately.</p>
    {busy && <div className="busy" />}
    {error && <div className="card"><div className="error">{error}</div></div>}
    {message && <div className="card"><div className="success small">{message}</div></div>}

    {groups.map(([group, items]) => (
      <div className="card" key={group} style={{ marginTop: 14 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>{group}</h2>
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table style={{ minWidth: 760 }}>
            <thead><tr><th style={{ width: '34%' }}>Rule</th><th style={{ width: 200 }}>Value</th><th>What it does</th></tr></thead>
            <tbody>
              {items.map(s => {
                const value = draft[s.key] ?? '';
                const isDirty = value !== s.value;
                return (
                  <tr key={s.key} style={isDirty ? { background: 'rgba(255, 196, 0, 0.08)' } : undefined}>
                    <td><b>{s.label}</b><br /><span className="mute small">{s.key}</span></td>
                    <td>
                      {s.kind === 'bool' ? (
                        <select className="select" value={value} onChange={e => setDraft({ ...draft, [s.key]: e.target.value })}>
                          <option value="TRUE">Yes</option>
                          <option value="FALSE">No</option>
                        </select>
                      ) : (
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <input
                            className="input"
                            style={{ maxWidth: 120 }}
                            type={s.kind === 'int' ? 'number' : s.kind === 'date' ? 'date' : 'text'}
                            min={s.min ?? undefined}
                            max={s.max ?? undefined}
                            value={value}
                            onChange={e => setDraft({ ...draft, [s.key]: e.target.value })}
                          />
                          {s.unit && <span className="mute small">{s.unit}</span>}
                        </div>
                      )}
                      {(s.min !== null || s.max !== null) && <span className="mute small">Allowed {s.min ?? '–'} to {s.max ?? '–'}</span>}
                    </td>
                    <td className="mute small">{s.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    ))}

    <div className="card" style={{ marginTop: 14, position: 'sticky', bottom: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <button className="btn primary" disabled={busy || !changed.length} onClick={save}>
          {changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'No changes'}
        </button>
        <button className="btn" disabled={busy || !changed.length} onClick={reset}>Discard</button>
        <span className="mute small">{changed.length ? `Changing: ${changed.map(c => c.label).join(', ')}` : 'Everything is at the saved value.'}</span>
      </div>
    </div>
  </>;
}
