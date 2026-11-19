'use client';
/**
 * Management dashboard for the LQT / Incubation operation.
 *
 * All figures come from one aggregated RPC (`dashboard_stats`) rather than from
 * the 15,000+ call_logs rows, so the page renders in a single round trip and
 * never re-computes anything in the browser.
 *
 * Charts are hand-drawn SVG: no charting dependency, no CDN, and they inherit
 * the CRM's light/dark CSS variables so they theme correctly.
 */

export type DashDaily = { day: string; lqt: number; inc: number };
export type DashAgent = {
  id: string; name: string; team: string; role: string;
  new_open: number; old_open: number; inc_open: number;
  late_new: number; due_today: number;
  calls_today: number; calls_7d: number; calls_30d: number;
  last_call: string | null;
};
export type DashTotals = {
  open_all: number; new_open: number; old_open: number; inc_open: number;
  overdue: number; due_today: number; unassigned: number; late_new: number;
  old_never_called: number; new_never_called: number;
  handover_inbox: number; in_care: number;
};
export type DashboardData = {
  totals: DashTotals;
  activity: { today: number; yesterday: number; avg7: number };
  daily: DashDaily[];
  agents: DashAgent[];
  funnel: { bucket: string; n: number }[];
};

const C = { new: '#2f7d4f', old: '#b8860b', inc: '#3f6fa8', bad: '#b23a48', mute: '#948c7c' };

function Card({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card dash-card">
      <div className="dash-card-head">
        <div><h3>{title}</h3>{sub && <p className="mute small">{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Stacked bar chart: calls per day, split by team. */
function CallVolumeChart({ daily }: { daily: DashDaily[] }) {
  if (!daily.length) return <p className="mute small">No calls in this period.</p>;
  const W = 760, H = 190, pad = { l: 34, r: 8, t: 10, b: 24 };
  const max = Math.max(1, ...daily.map(d => d.lqt + d.inc));
  const bw = (W - pad.l - pad.r) / daily.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Calls per day by team">
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeWidth="1" />
          <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize="9" fill="var(--mute)">{Math.round(max * f)}</text>
        </g>
      ))}
      {daily.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.15;
        const w = bw * 0.7;
        const hOld = y(0) - y(d.lqt);
        const hInc = y(0) - y(d.inc);
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.lqt} LQT, ${d.inc} Incubation`}</title>
            <rect x={x} y={y(d.lqt)} width={w} height={Math.max(0, hOld)} fill={C.old} rx="2" />
            <rect x={x} y={y(d.lqt + d.inc)} width={w} height={Math.max(0, hInc)} fill={C.inc} rx="2" />
            {i % Math.ceil(daily.length / 12) === 0 && (
              <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="8.5" fill="var(--mute)">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal funnel with conversion percentages. */
function FunnelChart({ funnel }: { funnel: { bucket: string; n: number }[] }) {
  // Stages overlap (a lead can be "contacted" and "follow up" at once), so a
  // stage-to-stage conversion % would be fiction. Bars are scaled to the
  // largest stage and the % column is that stage's share of the largest.
  const biggest = Math.max(1, ...funnel.map(f => f.n));
  return (
    <div className="funnel">
      {funnel.map((f, i) => {
        const pct = (f.n / biggest) * 100;
        return (
          <div className="funnel-row" key={f.bucket}>
            <span className="funnel-label">{f.bucket}</span>
            <div className="funnel-track">
              <div className="funnel-fill" style={{ width: `${Math.max(pct, 1.5)}%`, opacity: 1 - i * 0.1 }} />
            </div>
            <b className="funnel-n">{f.n.toLocaleString()}</b>
            <span className="mute small funnel-pct">{pct.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

/** Donut: open book split by generation / stage. */
function BookDonut({ totals }: { totals: DashTotals }) {
  const openAll = totals.open_all || 0;
  const parts = [
    { label: 'New LQT', v: totals.new_open, c: C.new },
    { label: 'Old LQT', v: totals.old_open, c: C.old },
    { label: 'Incubation', v: totals.inc_open, c: C.inc },
  ];
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  const R = 54, r = 34, cx = 70, cy = 70;
  let a0 = -Math.PI / 2;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Open leads by queue">
        {parts.map(p => {
          const a1 = a0 + (p.v / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} L ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} A ${r} ${r} 0 ${large} 0 ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} Z`;
          a0 = a1;
          return <path key={p.label} d={d} fill={p.c}><title>{`${p.label}: ${p.v.toLocaleString()}`}</title></path>;
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--ink)">{(openAll || total).toLocaleString()}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="9" fill="var(--mute)">OPEN</text>
      </svg>
      <ul className="donut-legend">
        {parts.map(p => (
          <li key={p.label}>
            <i style={{ background: p.c }} />
            <span>{p.label}</span>
            <b>{p.v.toLocaleString()}</b>
            <em>{((p.v / total) * 100).toFixed(0)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({ label, value, hint, tone = '', onClick }: { label: string; value: React.ReactNode; hint?: string; tone?: string; onClick?: () => void }) {
  return (
    <button className={`kpi ${tone}`} onClick={onClick} disabled={!onClick} type="button">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint && <em className="kpi-hint">{hint}</em>}
    </button>
  );
}

export function Dashboard({
  stats, loading, days, onDays, team, onTeam, go,
  periodFrom, periodTo, onPeriodFrom, onPeriodTo, liveToday, onLiveToday, meName, myQueue, myStats,
}: {
  stats: DashboardData | null;
  loading: boolean;
  days: number;
  onDays: (d: number) => void;
  team: string;
  onTeam: (t: string) => void;
  go: (id: string) => void;
  periodFrom?: string;
  periodTo?: string;
  onPeriodFrom?: (v: string) => void;
  onPeriodTo?: (v: string) => void;
  liveToday?: boolean;
  onLiveToday?: (v: boolean) => void;
  meName?: string;
  myQueue?: any[];
  myStats?: { pending: number; overdue: number; dueToday: number; newOpen: number; callsToday: number; oldOpen: number };
}) {
  if (!stats) return <div className="card empty">{loading ? 'Loading dashboard…' : 'Dashboard data unavailable.'}</div>;
  const { totals: t, activity: a } = stats;
  const agents = stats.agents.filter(x => !team || x.team === team);
  const activeToday = stats.agents.filter(x => x.calls_today > 0).length;
  const silent = stats.agents.filter(x => x.calls_7d === 0);
  const delta = a.today - a.avg7;

  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="page-title">Team performance</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            Live from Supabase · last synced {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            {loading && <span className="mute"> · refreshing…</span>}
          </p>
        </div>
        <div className="dash-filters">
          <label className="field-inline">Period
            <select className="select" value={days} onChange={e => onDays(Number(e.target.value))} aria-label="Reporting period">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          {/* Calendar range */}
          <div className="dash-cal" style={{ display: 'flex', gap: 6, alignItems: 'flex-end', border: '1px solid var(--line)', borderRadius: 10, padding: '6px 8px', background: 'var(--panel)' }}>
            <label className="field-inline" style={{ minWidth: 135 }}>From
              <input className="input" type="date" value={periodFrom || ''} onChange={e => onPeriodFrom?.(e.target.value)} style={{ height: 34, minHeight: 34, padding: '6px 8px', width: 138 }} />
            </label>
            <label className="field-inline" style={{ minWidth: 135 }}>To
              <input className="input" type="date" value={periodTo || ''} onChange={e => onPeriodTo?.(e.target.value)} style={{ height: 34, minHeight: 34, padding: '6px 8px', width: 138 }} />
            </label>
            {(periodFrom || periodTo) && <button className="btn" style={{ height: 34, minHeight: 34, padding: '6px 10px' }} onClick={() => { onPeriodFrom?.(''); onPeriodTo?.(''); }}>Clear</button>}
          </div>
          <label className="field-inline">Team
            <select className="select" value={team} onChange={e => onTeam(e.target.value)} aria-label="Team filter">
              <option value="">All teams</option>
              <option value="LQT">LQT</option>
              <option value="Incubation">Incubation</option>
            </select>
          </label>
          <label className="field-inline" style={{ flexDirection: 'row', alignItems: 'center', gap: 7, background: liveToday ? 'var(--brandbg)' : 'var(--panel)', border: `1px solid ${liveToday ? 'var(--accent2)' : 'var(--line)'}`, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={!!liveToday} onChange={e => onLiveToday?.(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent2)' }} />
            <span style={{ fontWeight: 750, color: liveToday ? 'var(--brand)' : 'var(--mute)', fontSize: 12.5 }}>Today’s live</span>
          </label>
        </div>
      </div>

      {/* Live: My Today — personal actionable view */}
      {liveToday && meName && myStats && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent2)', background: 'var(--brandbg)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <div><h3 style={{ margin: 0, fontSize: 15 }}>My today — {meName}</h3><p className="mute small" style={{ margin: '2px 0 0' }}>Live now · what you own and what’s due. Click a card to jump to your queue.</p></div>
            <span className="tag good">Live</span>
          </div>
          <div className="kpis" style={{ margin: '12px 0 0' }}>
            <Kpi label="My pending" value={myStats.pending} tone={myStats.pending > 20 ? 'bad' : myStats.pending > 8 ? 'warn' : 'good'} hint="open leads you own" onClick={() => go('queue')} />
            <Kpi label="My overdue" value={myStats.overdue} tone={myStats.overdue ? 'bad' : 'good'} hint="needs call now" onClick={() => go('queue')} />
            <Kpi label="Due today" value={myStats.dueToday} tone={myStats.dueToday ? 'warn' : ''} hint="today’s must-dos" onClick={() => go('queue')} />
            <Kpi label="New to call" value={myStats.newOpen} tone={myStats.newOpen ? 'warn' : 'good'} hint="new LQT you own" onClick={() => go('new-gen')} />
            <Kpi label="Old book" value={myStats.oldOpen} hint="backlog you own" onClick={() => go('oldbook')} />
            <Kpi label="My calls today" value={myStats.callsToday} tone={myStats.callsToday === 0 ? 'bad' : 'good'} hint="logged today" onClick={() => go('queue')} />
          </div>
          {myQueue && myQueue.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b className="small" style={{ color: 'var(--brand)' }}>Next up for you ({myQueue.length} in queue):</b>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {myQueue.slice(0, 5).map((l: any) => (
                  <button key={l.lead_id} className="btn" onClick={() => go('queue')} title={`${l.business_name} — ${l.current_status} — due ${l.next_due_date}`}>
                    <span style={{ fontWeight: 700 }}>{l.lead_id}</span>
                    <span className="mute small">{l.business_name?.slice(0, 18) || l.current_status}</span>
                    <ChevronRight size={12} />
                  </button>
                ))}
                {myQueue.length > 5 && <span className="pill">+{myQueue.length - 5} more in My call queue</span>}
              </div>
            </div>
          )}
          {myQueue && myQueue.length === 0 && <p className="mute small" style={{ marginTop: 10 }}>Your queue is clear — check Old book or New to LQT for upcoming work.</p>}
        </div>
      )}

      {/* 1 — today's productivity */}
      <h2 className="section-title">Today — is the team working?</h2>
      <div className="kpis">
        <Kpi label="Calls logged today" value={a.today} tone={a.today === 0 ? 'bad' : 'good'}
          hint={`7-day avg ${a.avg7}/day · yesterday ${a.yesterday}`} onClick={() => go('all')} />
        <Kpi label="Agents active today" value={`${activeToday}/${stats.agents.length}`}
          tone={activeToday === 0 ? 'bad' : activeToday < stats.agents.length ? 'warn' : 'good'}
          hint={silent.length ? `${silent.length} with no call in 7 days` : 'all agents dialling'} />
        <Kpi label="New leads never called" value={t.new_never_called} tone="warn"
          hint="needs first contact" onClick={() => go('new-gen')} />
        <Kpi label="New work late (SLA)" value={t.late_new} tone="bad"
          hint="first contact overdue" onClick={() => go('new-gen')} />
        <Kpi label="Due today" value={t.due_today} tone="warn" hint="across all queues" onClick={() => go('all')} />
      </div>

      {/* 2 — work mix */}
      <h2 className="section-title">Work mix — what the team owns</h2>
      <div className="dash-grid">
        <Card title="Open book by queue" sub={`${t.open_all.toLocaleString()} open leads`}>
          <BookDonut totals={t} />
        </Card>
        <Card title="Calls per day by team" sub={`Last ${days} days — watch for gaps and zero days`}
          right={<Legend items={[['LQT', C.old], ['Incubation', C.inc]]} />}>
          <CallVolumeChart daily={stats.daily} />
        </Card>
      </div>

      <div className="kpis">
        <Kpi label="New to LQT open" value={t.new_open} tone="good" hint="this month's work" onClick={() => go('new-gen')} />
        <Kpi label="Old book open" value={t.old_open} tone="warn" hint="backlog, not today's work" onClick={() => go('old')} />
        <Kpi label="Incubation open" value={t.inc_open} hint="handover → care" onClick={() => go('tab:Incubation Queue')} />
        <Kpi label="Overdue (all)" value={t.overdue} tone="bad" hint="includes old backlog" onClick={() => go('all')} />
        <Kpi label="Unassigned" value={t.unassigned} tone={t.unassigned > 0 ? 'warn' : ''} hint="nobody owns these" onClick={() => go('all')} />
        <Kpi label="Old never called" value={t.old_never_called} hint="leads with zero calls" onClick={() => go('old')} />
        <Kpi label="In care period" value={t.in_care} hint="1st trip done" onClick={() => go('tab:Care Period')} />
        <Kpi label="Handover inbox" value={t.handover_inbox} tone={t.handover_inbox > 0 ? 'warn' : ''} hint="waiting for Incubation" onClick={() => go('tab:Handover Inbox')} />
      </div>

      {/* 3 — funnel */}
      <h2 className="section-title">Pipeline — where the book sits</h2>
      <Card title="Where the book sits today" sub="Live counts per stage. Stages overlap, so bars are scaled to the largest stage — this is not a stage-to-stage conversion rate.">
        <FunnelChart funnel={stats.funnel} />
      </Card>

      {/* 4 — per agent */}
      <h2 className="section-title">By agent{team ? ` — ${team}` : ''}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agent</th><th>Team</th><th>New open</th><th>Old open</th><th>Inc. open</th>
              <th>Late (new)</th><th>Calls today</th><th>7d</th><th>30d</th><th>Last call</th><th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map(x => {
              const stale = x.calls_7d === 0;
              return (
                <tr key={x.id}>
                  <td><b>{x.name}</b>{x.role !== 'Agent' && <span className="tag" style={{ marginLeft: 6 }}>{x.role}</span>}</td>
                  <td>{x.team}</td>
                  <td>{x.new_open || '—'}</td>
                  <td>{x.old_open || '—'}</td>
                  <td>{x.inc_open || '—'}</td>
                  <td>{x.late_new ? <span className="tag bad">{x.late_new}</span> : '—'}</td>
                  <td>{x.calls_today ? <span className="tag good">{x.calls_today}</span> : <span className="tag bad">0</span>}</td>
                  <td>{x.calls_7d || '—'}</td>
                  <td>{x.calls_30d || '—'}</td>
                  <td>{stale ? <span className="tag bad">7d+ silent</span> : x.last_call || '—'}</td>
                  <td><ProdBar v={x.calls_30d} max={Math.max(1, ...stats.agents.map(y => y.calls_30d))} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">“7d+ silent” = no call logged in the last 7 days. Period filter applies to the charts; agent columns are always today / 7d / 30d.</p>
    </>
  );
}

function ProdBar({ v, max }: { v: number; max: number }) {
  const pct = Math.round((v / max) * 100);
  return <div className="prodbar" title={`${v} calls in 30 days`}><i style={{ width: `${pct}%` }} /></div>;
}

function Legend({ items }: { items: [string, string][] }) {
  return <ul className="legend">{items.map(([l, c]) => <li key={l}><i style={{ background: c }} />{l}</li>)}</ul>;
}
