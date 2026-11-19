'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Users, Clock3, Target, ArrowRight, Sparkles, BarChart3, CalendarDays, Filter, RefreshCw, Settings2, ChevronRight } from 'lucide-react';
import type { CommandCenterData } from '@/lib/command-center-types';

const C = { accent: '#ffd600', accent2: '#f3b900', ok: '#277449', warn: '#9d5b00', bad: '#aa3441', inc: '#3f6fa8', lqt: '#b8860b', new: '#2f7d4f' };

function fmt(n: number) { return n.toLocaleString(); }
function fmtPct(n: number | null) { if (n == null) return '—'; return `${n.toFixed(1)}%`; }

export function CommandCenter() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [after13, setAfter13] = useState(true);
  const [dateMode, setDateMode] = useState<'registration' | 'activity' | 'milestone'>('registration');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams({ from, to, after13nov: after13 ? '1' : '0', dateMode });
      const r = await fetch(`/api/command-center?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load');
      setData(j.data);
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  }, [from, to, after13, dateMode]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="loading">Loading Command Center — crunching 12k leads…</div>;
  if (err) return <div className="card" style={{ margin: 24 }}><b>Could not load Command Center</b><p className="error">{err}</p><button className="btn" onClick={load}>Retry</button></div>;
  if (!data) return null;

  const o = data.overview;
  const funnel = data.funnel;

  return (
    <div className="cc">
      <style>{`
        .cc { --cc-line: var(--line); --cc-panel: var(--panel); }
        .cc-head { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end; justify-content:space-between; margin-bottom:18px }
        .cc-head h1{ margin:0; font-size:24px; letter-spacing:-0.5px }
        .cc-head p{ margin:4px 0 0; color:var(--mute) }
        .cc-filters{ display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px }
        .cc-filters label{ display:flex; flex-direction:column; gap:4px; font-size:11.5px; font-weight:650; color:var(--mute) }
        .cc-filters input, .cc-filters select{ width:150px }
        .cc-grid{ display:grid; gap:14px }
        .cc-kpis{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:11px }
        .cc-kpi{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 14px 12px; position:relative; overflow:hidden }
        .cc-kpi h4{ margin:0; font-size:12px; color:var(--mute); text-transform:uppercase; letter-spacing:.06em }
        .cc-kpi strong{ font-size:28px; display:block; line-height:1.1; margin:6px 0 2px }
        .cc-kpi .meta{ display:flex; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--mute); margin-top:8px }
        .cc-kpi .bar{ height:4px; background:var(--bg); border-radius:4px; margin-top:10px; overflow:hidden }
        .cc-kpi .bar i{ display:block; height:100%; background:var(--accent2); border-radius:4px }
        .cc-kpi.good strong{ color:var(--ok) } .cc-kpi.bad strong{ color:var(--bad) } .cc-kpi.warn strong{ color:var(--warn) }
        .cc-section{ background:var(--panel); border:1px solid var(--line); border-radius:13px; padding:16px 18px }
        .cc-section h2{ margin:0 0 4px; font-size:16px } .cc-section .sub{ color:var(--mute); font-size:12.5px; margin:0 0 14px }
        .cc-funnel{ display:grid; gap:0 }
        .funnel-step{ display:grid; grid-template-columns: 22px 1fr auto; gap:12px; align-items:center; padding:11px 0; border-bottom:1px solid var(--line) }
        .funnel-step:last-child{ border-bottom:0 }
        .funnel-dot{ width:22px; height:22px; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:800; color:#fff }
        .funnel-main b{ font-size:14px } .funnel-main .small{ display:flex; gap:10px; flex-wrap:wrap; margin-top:3px }
        .cc-table{ width:100%; border-collapse:collapse; font-size:13px } .cc-table th{ text-align:left; padding:8px 10px; color:var(--mute); font-size:11.5px; border-bottom:1px solid var(--line); white-space:nowrap } .cc-table td{ padding:9px 10px; border-bottom:1px solid var(--line); white-space:nowrap }
        .cc-table tr:hover td{ background:var(--bg) }
        .pill{ display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; font-size:11.5px; font-weight:600; border:1px solid var(--line); background:var(--bg) }
        .pill.good{ background:var(--okbg); color:var(--ok); border-color:transparent } .pill.bad{ background:var(--badbg); color:var(--bad); border-color:transparent } .pill.warn{ background:var(--warnbg); color:var(--warn); border-color:transparent }
        .alert-list{ display:grid; gap:10px } .alert-card{ display:flex; gap:12px; padding:12px 14px; border-radius:10px; border:1px solid var(--line); border-left:4px solid var(--accent2); background:var(--panel) }
        .alert-card.high{ border-left-color:var(--bad) } .alert-card.medium{ border-left-color:var(--warn) }
        .cohort-table{ overflow:auto } .cohort-table table{ min-width:760px }
        .vs-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px } @media(max-width:900px){ .vs-grid{ grid-template-columns:1fr } }
        .cc-cols{ display:grid; grid-template-columns:1.55fr 1fr; gap:14px } @media(max-width:1000px){ .cc-cols{ grid-template-columns:1fr } }
        .exec-table{ overflow:auto }
      `}</style>

      {/* Header */}
      <div className="cc-head">
        <div>
          <h1>Command Center <span style={{ color: 'var(--accent2)', fontWeight: 800 }}>• Admin</span></h1>
          <p>Real-time onboarding health — <b>{data.meta.totalLeads.toLocaleString()}</b> leads in range • {data.meta.from} → {data.meta.to} {data.meta.after13nov && '• After 13 Nov only'} • {data.meta.dateMode} date</p>
          {data.bottleneck && <p className="small" style={{ marginTop: 6, color: 'var(--warn)', fontWeight: 600 }}>Bottleneck: <b>{data.bottleneck.stage}</b> — {data.bottleneck.stuckCount.toLocaleString()} stuck</p>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="pill"><Clock3 size={12} /> Last sync: {new Date(data.meta.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <button className="btn" onClick={load} disabled={loading}><RefreshCw size={14} />{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {/* Filters */}
      <div className="cc-filters">
        <label>From<input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>Date meaning<select className="select" value={dateMode} onChange={e => setDateMode(e.target.value as any)}><option value="registration">Registration date</option><option value="activity">Assign / activity date</option><option value="milestone">First-trip date</option></select></label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 }}><input type="checkbox" checked={after13} onChange={e => setAfter13(e.target.checked)} /> After 13 Nov only</label>
        <span className="grow" />
        <span className="mute small">Tip: “After 13 Nov” isolates the new CRM period (from 2026-11-14). Registration vs Activity vs Milestone changes the cohort filter without distorting conversion.</span>
      </div>

      {/* Alerts — Action Center first (G) */}
      {data.alerts.length > 0 && (
        <section className="cc-section" style={{ marginTop: 14, borderLeft: '4px solid var(--bad)' }}>
          <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} /> Alerts & Action Center — {data.alerts.length} items need attention</h2>
          <p className="sub">Prioritized by severity. Each alert shows owner and affected lead IDs — act directly from your queue.</p>
          <div className="alert-list">
            {data.alerts.map((a, i) => (
              <div key={i} className={`alert-card ${a.severity}`}>
                <div style={{ flex: 1 }}>
                  <b>{a.title}</b><p className="mute small" style={{ margin: '4px 0 0' }}>{a.body} {a.owner && <>• Owner: <b>{a.owner}</b></>}</p>
                  {a.leadIds && a.leadIds.length > 0 && <p className="small" style={{ marginTop: 6, color: 'var(--mute)', wordBreak: 'break-all' }}>{a.leadIds.slice(0, 8).join(' • ')}{a.leadIds.length > 8 ? ` +${a.leadIds.length - 8} more` : ''}</p>}
                </div>
                <span className={`pill ${a.severity === 'high' ? 'bad' : a.severity === 'medium' ? 'warn' : ''}`}>{a.count} leads</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* A — Executive Overview with Targets */}
      <section className="cc-section" style={{ marginTop: 14 }}>
        <h2><Target size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Executive Overview — Target vs Actual</h2>
        <p className="sub">Every KPI vs monthly target. Achievement % = Actual / Target. Targets editable in Team & system → dashboard_targets (default global 1,000 onboarded).</p>
        <div className="cc-kpis">
          {data.overview.kpis.map(k => {
            const tone = k.achievement >= 100 ? 'good' : k.achievement >= 80 ? 'warn' : 'bad';
            const Icon = k.trend === 'up' ? TrendingUp : k.trend === 'down' ? TrendingDown : Minus;
            return (
              <div key={k.metric} className={`cc-kpi ${tone}`}>
                <h4>{k.metric}</h4>
                <strong>{fmt(k.actual)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--mute)' }}>/ {fmt(k.target)}</span></strong>
                <div className="meta"><span className="pill good">{k.achievement.toFixed(1)}% achieved</span><span style={{ color: k.variance >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{k.variance >= 0 ? `+${fmt(k.variance)}` : fmt(k.variance)} vs target</span><Icon size={14} /></div>
                <div className="bar"><i style={{ width: `${Math.min(100, k.achievement)}%`, background: tone === 'good' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)' }} /></div>
              </div>
            );
          })}
          {/* Overall conv card */}
          <div className="cc-kpi" style={{ background: 'var(--brandbg)', borderColor: 'var(--accent2)' }}>
            <h4>Overall conversion</h4><strong>{data.overview.totals.overallConv.toFixed(1)}%</strong>
            <div className="meta"><span>First Trip / Registered</span><span>• {fmt(data.overview.totals.firstTrip)} / {fmt(data.overview.totals.registered)}</span></div>
            <div className="bar"><i style={{ width: `${Math.min(100, data.overview.totals.overallConv)}%` }} /></div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <span className="pill"><Users size={12} /> Registered: <b>{fmt(data.overview.totals.registered)}</b></span>
          <span className="pill">Contacted: <b>{fmt(data.overview.totals.contacted)}</b></span>
          <span className="pill">Qualified: <b>{fmt(data.overview.totals.qualified)}</b></span>
          <span className="pill">First Trip: <b>{fmt(data.overview.totals.firstTrip)}</b></span>
          <span className="pill good">7-Day: <b>{fmt(data.overview.totals.activation7)}</b></span>
        </div>
      </section>

      {/* B — Funnel */}
      <section className="cc-section" style={{ marginTop: 14 }}>
        <h2><BarChart3 size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Onboarding Funnel — where merchants get stuck</h2>
        <p className="sub">7 stages: Registration → Contacted → Verified → Qualified → Onboarded → First Trip → 7-Day. Conversion and drop-off are vs previous stage. Avg days = registration to milestone. Verified = Business ID + Category/Volume/Zone/Area complete.</p>
        <div className="cc-funnel">
          {funnel.map((s, i) => {
            const colors = ['#242119', '#2f7d4f', '#b8860b', '#3f6fa8', '#795c00', '#277449', '#1a7f4b'];
            const pctBar = i === 0 ? 100 : (s.count / funnel[0].count * 100);
            return (
              <div key={s.key} className="funnel-step">
                <div className="funnel-dot" style={{ background: colors[i] }}>{i + 1}</div>
                <div className="funnel-main">
                  <b>{s.label} — {fmt(s.count)}</b>
                  <div className="small">
                    {s.convPrev != null && <span className="pill">{s.convPrev.toFixed(1)}% conv</span>}
                    {s.dropPrev != null && <span className="pill bad">{s.dropPrev.toFixed(1)}% drop</span>}
                    {s.avgDays != null && <span className="pill"><Clock3 size={11} /> avg {s.avgDays}d</span>}
                    {s.topReason && <span className="mute">Top reason: <b>{s.topReason}</b> ({s.topReasonCount})</span>}
                    {s.owners.length > 0 && <span className="mute">Owners: {s.owners.map(o => `${o.owner} ${o.count}`).join(' • ')}</span>}
                  </div>
                  <div style={{ height: 6, background: 'var(--bg)', borderRadius: 6, marginTop: 8, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pctBar}%`, background: colors[i], borderRadius: 6 }} /></div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 80 }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(s.count)}</div>
                  <div className="mute small">{pctBar.toFixed(0)}% of reg</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="cc-cols" style={{ marginTop: 14 }}>
        {/* C — Status */}
        <section className="cc-section">
          <h2>Merchant Status Distribution</h2><p className="sub">Current snapshot. Final statuses = closed; others = pending. Use date filter to isolate new-CRM period.</p>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="cc-table">
              <thead><tr><th>Status</th><th>Count</th><th>%</th><th>Type</th><th>Bar</th></tr></thead>
              <tbody>{data.statusDist.map(s => (
                <tr key={s.status}><td><b>{s.status}</b></td><td>{fmt(s.count)}</td><td>{s.pct}%</td><td><span className={`pill ${s.isFinal ? 'good' : 'warn'}`}>{s.isFinal ? 'Final' : 'Pending'}</span></td><td><div style={{ width: 70, height: 8, background: 'var(--bg)', borderRadius: 6, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${s.pct}%`, background: s.isFinal ? 'var(--ok)' : 'var(--accent2)' }} /></div></td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        {/* Aging */}
        <section className="cc-section">
          <h2><Clock3 size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Lead Aging & Bottleneck</h2><p className="sub">Overdue buckets (by next_due_date). 20d+ = old book cleanup candidate.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            {data.aging.map(b => (
              <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ minWidth: 110, fontSize: 13 }}>{b.bucket}</span>
                <div style={{ flex: 1, height: 14, background: 'var(--bg)', borderRadius: 7, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${data.aging[0].count ? b.count / Math.max(...data.aging.map(x => x.count)) * 100 : 0}%`, background: b.bucket.includes('20d') ? 'var(--bad)' : b.bucket.includes('8-') ? 'var(--warn)' : 'var(--ok)' }} /></div>
                <b style={{ minWidth: 50, textAlign: 'right' }}>{fmt(b.count)}</b>
              </div>
            ))}
          </div>
          {data.bottleneck && <p className="small" style={{ marginTop: 12, background: 'var(--warnbg)', padding: '8px 10px', borderRadius: 8, color: 'var(--warn)' }}>Pipeline bottleneck: <b>{data.bottleneck.stage}</b> holding {fmt(data.bottleneck.stuckCount)} pending — prioritize there.</p>}
        </section>
      </div>

      {/* D — Cohort */}
      <section className="cc-section" style={{ marginTop: 14 }}>
        <h2><CalendarDays size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Cohort Analysis — activation journey</h2>
        <p className="sub">Rows = registration cohorts (last 14 days). Immature cohorts (&lt;30d old) greyed to avoid false comparison. % = conversions within cohort. Avg days to first trip per cohort.</p>
        <div className="cohort-table">
          <table className="cc-table">
            <thead><tr><th>Cohort</th><th>Reg</th><th>Contacted</th><th>Verified</th><th>Qualified</th><th>Onboarded</th><th>First Trip</th><th>7-Day</th><th>Avg TAT</th></tr></thead>
            <tbody>{data.cohorts.map(c => (
              <tr key={c.cohort} style={{ opacity: c.mature ? 1 : 0.55 }}>
                <td><b>{c.cohort}</b> {!c.mature && <span className="pill">immature</span>}</td>
                <td>{fmt(c.registered)}</td>
                <td>{fmt(c.contacted)} <span className="mute">({c.contactedPct}%)</span></td>
                <td>{fmt(c.verified)} <span className="mute">({c.verifiedPct}%)</span></td>
                <td>{fmt(c.qualified)} <span className="mute">({c.qualifiedPct}%)</span></td>
                <td>{fmt(c.onboarded)} <span className="mute">({c.onboardedPct}%)</span></td>
                <td>{c.firstTrip ? <span className="pill good">{fmt(c.firstTrip)} {c.firstTripPct}%</span> : '—'}</td>
                <td>{c.activation7 ? `${fmt(c.activation7)} ${c.activation7Pct}%` : '—'}</td>
                <td>{c.avgDaysToFirstTrip != null ? `${c.avgDaysToFirstTrip}d` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {/* E — LQT vs Incubation */}
      <section className="cc-section" style={{ marginTop: 14 }}>
        <h2><Users size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />LQT vs Incubation — side-by-side</h2><p className="sub">Same cohort, same definitions. Delta = Inc − LQT (positive means Inc ahead on that %). Uses stage LQT vs Incubation/Handover.</p>
        <div className="vs-grid">
          <div>
            <table className="cc-table">
              <thead><tr><th>Metric</th><th>LQT</th><th>Incubation</th><th>Delta</th></tr></thead>
              <tbody>{data.lqtVsInc.rows.map(r => (
                <tr key={r.metric}><td>{r.metric}</td><td>{fmt(r.lqt)} {r.lqtPct != null && <span className="mute">({r.lqtPct}%)</span>}</td><td>{fmt(r.inc)} {r.incPct != null && <span className="mute">({r.incPct}%)</span>}</td><td style={{ color: r.delta > 0 ? 'var(--ok)' : r.delta < 0 ? 'var(--bad)' : 'var(--mute)', fontWeight: 700 }}>{r.delta > 0 ? `+${r.delta.toFixed(1)}%` : `${r.delta.toFixed(1)}%`}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 14 }}>
            <h4 style={{ margin: '0 0 8px' }}>How to read</h4><p className="mute small" style={{ margin: 0 }}>LQT owns New/Old LQT work; Incubation owns Handover+Incubation Queue & Care. Conversion denominator is always Total leads in each team's stage. Gap {'>'}5 points = coaching / process gap. Negative delta on Contacted = LQT dialing issue; positive on First Trip = Incubation executing.</p>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="pill" style={{ justifyContent: 'center', padding: 10 }}><span style={{ width: 10, height: 10, background: C.lqt, borderRadius: 3, display: 'inline-block' }} /> LQT: {fmt((data.lqtVsInc as any).lqt.registered || 0)}</div>
              <div className="pill" style={{ justifyContent: 'center', padding: 10 }}><span style={{ width: 10, height: 10, background: C.inc, borderRadius: 3, display: 'inline-block' }} /> Inc: {fmt((data.lqtVsInc as any).inc.registered || 0)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* F — Exec Performance */}
      <section className="cc-section" style={{ marginTop: 14 }}>
        <h2><Sparkles size={16} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Team & Executive Performance — workload & outcomes</h2><p className="sub">Top 12 by assigned. Pending = active non-final; Overdue = due_state Overdue; On-time % = 1 − Overdue/Pending; TAT = registration → first trip avg.</p>
        <div className="exec-table">
          <table className="cc-table">
            <thead><tr><th>Executive</th><th>Team</th><th>Assigned</th><th>Contacted</th><th>Qualified</th><th>First Trip</th><th>Pending</th><th>Overdue</th><th>On-time</th><th>TAT</th><th>Activation</th></tr></thead>
            <tbody>{data.execs.map(e => (
              <tr key={e.id}><td><b>{e.name}</b></td><td><span className="pill">{e.team}</span></td><td>{fmt(e.assigned)}</td><td>{fmt(e.contacted)}</td><td>{fmt(e.qualified)}</td><td>{e.firstTrip ? <span className="pill good">{fmt(e.firstTrip)}</span> : '—'}</td><td>{fmt(e.pending)}</td><td>{e.overdue ? <span className="pill bad">{fmt(e.overdue)}</span> : '0'}</td><td>{e.onTimePct != null ? `${e.onTimePct}%` : '—'}</td><td>{e.tatAvg != null ? `${e.tatAvg}d` : '—'}</td><td>{e.activationRate != null ? `${e.activationRate}%` : '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <p className="mute small" style={{ marginTop: 14, textAlign: 'center' }}>Definitions: Verified = Business ID + Category/Volume/Zone/Area complete. 7-Day = first_trip +7d still in Care/Completed (proxy; true retention needs trip fact). Targets from dashboard_targets (monthly global). — Phase 1 uses live snapshot; Phase 2 will add stage_history + daily_status_snapshot for exact time-in-stage & trends.</p>
    </div>
  );
}
