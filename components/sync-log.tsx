'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Run = {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  calls_received: number;
  calls_imported: number;
  care_received: number;
  care_imported: number;
  organic_received: number;
  organic_imported: number;
  error_count: number;
  message: string;
};

export function SyncLog({ supabase }: { supabase: SupabaseClient }) {
  const [rows, setRows] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    const { data, error } = await supabase
      .from('sheet_sync_runs')
      .select('id,started_at,completed_at,status,calls_received,calls_imported,care_received,care_imported,organic_received,organic_imported,error_count,message')
      .order('id', { ascending: false })
      .limit(20);
    if (error) setErr(error.message);
    else setRows((data as any) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="mute">Loading sync history…</p>;
  if (err) return <p className="banner bad">{err} — only Leads/Admins can view sync runs.</p>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Sync history — last 20 runs</h3>
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <p className="mute small" style={{ marginTop: 0 }}>
        Apps Script daily at 08:00 Dhaka → <code>/api/sheets-intake</code> → <code>sheet_sync_runs</code>. A missing run after 10:00 Dhaka is stale; a <code>failed</code>/<code>partial</code> with errors is failed. Both create a bell notification and this banner.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Started (Dhaka)</th>
              <th>Status</th>
              <th>Care</th>
              <th>Organic/Pickup</th>
              <th>Errors</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ background: r.status === 'failed' ? '#fdecea' : r.status === 'partial' ? '#fff8e1' : undefined }}>
                <td>{r.id}</td>
                <td>{new Date(r.started_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td><span className={`tag ${r.status === 'success' ? '' : r.status === 'partial' ? 'warn' : 'bad'}`}>{r.status}</span></td>
                <td>{r.care_imported}/{r.care_received}</td>
                <td>{r.organic_imported}/{r.organic_received}</td>
                <td>{r.error_count}</td>
                <td style={{ maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.message}>{r.message || '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="mute">No runs yet — Apps Script has never called /api/sheets-intake, or RLS hides them from this user.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
