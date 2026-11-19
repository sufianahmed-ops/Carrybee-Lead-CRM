'use client';
/**
 * Phase 2 — manual batch assignment.
 *
 * Deliberately manual: no cron, no scheduled batch. Management decides the day's
 * batch when they know the team is actually working (year-end, government
 * holidays, Fridays off). One click slots N leads into the queue, a second click
 * assigns them round robin across the chosen LQT agents, and each agent's own
 * daily cap is enforced server side.
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Member } from '@/lib/types';

type Status = {
  cap: number; eligible: number; queued: number; moved_total: number; moved_today: number;
  last_run: string | null; by_agent_today: Record<string, number>;
};
type PreviewRow = { lead_id: string; from: string; to: string };
type RunResult = { assigned: number; skipped: number; queued_left: number; dry_run: boolean; preview: PreviewRow[]; cap: number };

export function Phase2Assign({ members }: { members: Member[] }) {
  const supabase = createClient();
  // Follow the stage a person works in, not the team they sit on: people can sit in
  // the Incubation team and still work the LQT stage. Anyone out today stays out of
  // the rotation but can still be picked by hand for a single lead.
  const worksLqt = (m: Member) => (m.lend_stage || m.stage || m.team) === 'LQT';
  const lqt = members.filter(m => m.active && worksLqt(m));
  const away = lqt.filter(m => m.on_leave).map(m => m.name);
  const borrowed = lqt.filter(m => m.lend_stage).map(m => `${m.name} (helping LQT today, max ${m.lend_cap})`);
  const [status, setStatus] = useState<Status | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [cap, setCap] = useState(30);
  const [batch, setBatch] = useState(50);
  const [queuedFor, setQueuedFor] = useState(0);
  const [preview, setPreview] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('phase2_status');
    if (error) { setNote(error.message); return; }
    setStatus(data as Status);
  }, [supabase]);

  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => { if (lqt.length && !agents.length) setAgents(lqt.map(m => m.id)); }, [lqt.length]);

  function toggle(id: string) {
    setAgents(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setPreview(null);
  }

  async function slotIn() {
    setBusy(true); setNote('');
    const { data, error } = await supabase.rpc('phase2_enqueue', { p: { total: queuedFor || batch } });
    setBusy(false); setPreview(null);
    if (error) return setNote(error.message);
    const d = data as { added: number; eligible: number };
    setNote(`${d.added} leads slotted in (${d.eligible} eligible were available).`);
    await load();
  }

  async function run(dry: boolean) {
    if (!agents.length) return setNote('Choose at least one LQT agent.');
    setBusy(true); setNote('');
    const { data, error } = await supabase.rpc('phase2_assign_now', {
      p: { agentIds: agents, batchSize: batch, cap }, p_dry_run: dry,
    });
    setBusy(false);
    if (error) return setNote(error.message);
    const d = data as RunResult;
    setPreview(d);
    if (!dry) {
      setNote(`Assigned ${d.assigned} lead${d.assigned === 1 ? '' : 's'}${d.skipped ? `, ${d.skipped} held back by the cap` : ''}. ${d.queued_left} still queued.`);
      await load();
    }
  }

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <>
      <h1 className="page-title">Assign old book — Phase 2</h1>
      <p className="subtitle">
        Nothing runs on a timer. You decide when a batch goes out — useful at year end, on government
        holidays and on days the team is short-staffed. Today is {today}.
      </p>

      <div className="kpis">
        <div className="kpi"><strong>{status?.eligible ?? '—'}</strong><span>Old leads still movable</span><em className="kpi-hint">worked in October, assigned before 1 Nov</em></div>
        <div className="kpi"><strong>{status?.queued ?? '—'}</strong><span>Slotted in, not yet assigned</span><em className="kpi-hint">waiting for your click</em></div>
        <div className="kpi"><strong>{status?.moved_today ?? '—'}</strong><span>Assigned today</span><em className="kpi-hint">across all agents</em></div>
        <div className="kpi"><strong>{status?.moved_total ?? '—'}</strong><span>Assigned in total</span><em className="kpi-hint">since Phase 2 started</em></div>
      </div>

      <div className="card">
        <h3>1 · Rotation</h3>
        <p className="mute small">Leads are handed out in this order, one at a time, and each agent stops at their own daily cap.
            {away.length > 0 && <>{' '}<b>Out today, left out of the rotation: {away.join(', ')}.</b></>}
            {borrowed.length > 0 && <>{' '}<b>Borrowed in: {borrowed.join(', ')}.</b></>}</p>
        <div className="agent-picker-menu" style={{ position: 'static', boxShadow: 'none', padding: 0 }}>
          {lqt.map(m => (
            <label className="agent-choice" key={m.id}>
              <input type="checkbox" checked={agents.includes(m.id)} onChange={() => toggle(m.id)} />
              <span>{m.name}</span>
              {agents.includes(m.id) && <b>#{agents.indexOf(m.id) + 1}</b>}
              <em className="mute small" style={{ marginLeft: 8 }}>
                {status?.by_agent_today?.[m.name] ? `${status.by_agent_today[m.name]} today` : 'none today'}
              </em>
            </label>
          ))}
          {!lqt.length && <p className="error">No active LQT agents found.</p>}
        </div>

        <div className="dash-filters" style={{ marginTop: 14 }}>
          <label className="field-inline">Daily cap per agent
            <select className="select" value={cap} onChange={e => { setCap(Number(e.target.value)); setPreview(null); }}>
              <option value={0}>No cap</option>
              <option value={20}>20 a day</option>
              <option value={25}>25 a day</option>
              <option value={30}>30 a day</option>
              <option value={40}>40 a day</option>
            </select>
          </label>
          <label className="field-inline">Batch size
            <select className="select" value={batch} onChange={e => { setBatch(Number(e.target.value)); setPreview(null); }}>
              <option value={20}>20 leads</option>
              <option value={50}>50 leads</option>
              <option value={100}>100 leads</option>
              <option value={200}>200 leads</option>
              <option value={500}>500 leads</option>
            </select>
          </label>
          <label className="field-inline">Slot in this many
            <input className="input" type="number" min={1} max={500} value={queuedFor || batch}
              onChange={e => setQueuedFor(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn" disabled={busy} onClick={slotIn}>Slot them in (no assignment yet)</button>
          <button className="btn" disabled={busy || !agents.length} onClick={() => run(true)}>Preview batch</button>
          <button className="btn primary" disabled={busy || !agents.length} onClick={() => run(false)}>
            {busy ? 'Working…' : `Assign ${batch} now`}
          </button>
        </div>
        {note && <p className={/error|Choose|must|cannot/i.test(note) ? 'error' : 'mute small'} style={{ marginTop: 12 }}>{note}</p>}
        <p className="table-note" style={{ marginTop: 10 }}>
          “Preview batch” writes nothing. “Assign now” is the only button that moves leads, and every move is
          logged with the old owner, the new owner and who pressed the button. Cap is per receiving agent, per day —
          if both agents are already at their cap the button reports 0 assigned and nothing changes.
        </p>
      </div>

      {preview && (
        <div className="card">
          <h3>{preview.dry_run ? 'Preview — nothing has moved' : 'Just assigned'}</h3>
          <p className="mute small">
            {preview.dry_run ? `Would assign ${preview.assigned}` : `Assigned ${preview.assigned}`}
            {preview.skipped ? ` · ${preview.skipped} held back by the cap` : ''} · cap {preview.cap || 'none'} per agent
          </p>
          {preview.assigned === 0 && (
            <p className="error">
              Nothing can move right now: {preview.skipped} lead{preview.skipped === 1 ? '' : 's'} held back by the
              per-agent cap{preview.cap ? ` of ${preview.cap} a day` : ''}. Try again tomorrow, raise the cap, or add
              another LQT agent to the rotation.
            </p>
          )}
          {preview.assigned > 0 && <div className="table-wrap">
            <table>
              <thead><tr><th>Lead</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {preview.preview.map((p, i) => (
                  <tr key={`${p.lead_id}-${i}`}><td>{p.lead_id}</td><td>{p.from}</td><td><b>{p.to}</b></td></tr>
                ))}
              </tbody>
            </table>
          </div>}
          {preview.assigned > 40 && <p className="table-note">Showing the first 40 of {preview.assigned}.</p>}
        </div>
      )}
    </>
  );
}
