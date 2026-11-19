'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, Filter, CalendarDays, Users, Tag, ListTree, Search, Loader2, FileSpreadsheet, Eye, X, ChevronDown } from 'lucide-react';

const DATE_FIELDS = [
  { v: 'registration_date', l: 'Registration date' },
  { v: 'assign_date', l: 'Assign date' },
  { v: 'last_status_date', l: 'Last status date' },
  { v: 'next_due_date', l: 'Next due date' },
  { v: 'first_contact_date', l: 'First contact' },
  { v: 'qualified_at', l: 'Qualified date' },
  { v: 'first_trip_date', l: 'First trip date' },
] as const;

const STAGES = ['LQT','Handover','Incubation','Final'];
const GENERATIONS = ['New','Old'];
const DUE_STATES = ['Overdue','Due Today','Up to date'];

type PreviewRow = Record<string, any>;

export function Reports({ isLead }: { isLead?: boolean }) {
  if (!isLead) {
    return (
      <div className="card" style={{ borderLeft: '4px solid var(--bad)', padding: 18 }}>
        <h3 style={{ margin: '0 0 6px' }}>🔒 Reports — Admin only</h3>
        <p className="mute" style={{ margin: 0 }}>This export is restricted to <b>Lead / Admin</b> accounts. Ask your Team Lead for the file, or ask Admin to grant you access in <b>Team &amp; system</b>.</p>
      </div>
    );
  }
  const [dateField, setDateField] = useState('registration_date');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [stage, setStage] = useState<string[]>([]);
  const [generation, setGeneration] = useState<string[]>([]);
  const [owner, setOwner] = useState('');
  const [dueState, setDueState] = useState<string[]>([]);
  const [isFinal, setIsFinal] = useState('');
  const [source, setSource] = useState('');
  const [zone, setZone] = useState('');

  const [count, setCount] = useState<number | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [opts, setOpts] = useState<{ statuses: string[]; owners: string[]; sources: string[]; zones: string[] }>({ statuses: [], owners: [], sources: [], zones: [] });
  const [showMore, setShowMore] = useState(false);

  function buildQS() {
    const p = new URLSearchParams();
    if (dateField) p.set('dateField', dateField);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (status.length) p.set('status', status.join(','));
    if (stage.length) p.set('stage', stage.join(','));
    if (generation.length) p.set('generation', generation.join(','));
    if (owner) p.set('owner', owner);
    if (dueState.length) p.set('dueState', dueState.join(','));
    if (isFinal) p.set('isFinal', isFinal);
    if (source) p.set('source', source);
    if (zone) p.set('zone', zone);
    return p;
  }

  const qsPreview = useMemo(() => buildQS().toString(), [dateField, from, to, status, stage, generation, owner, dueState, isFinal, source, zone]);

  async function doPreview() {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/reports?${qsPreview}&limit=100`, { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed');
      setCount(j.count);
      setRows(j.rows);
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  }

  async function doDownload() {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/reports/export?${qsPreview}`, { cache: 'no-store' });
      if (!r.ok) { const j = await r.json().catch(()=>null); throw new Error(j?.error || `HTTP ${r.status}`); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cd = r.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      a.download = m ? m[1] : `carrybee-report-${new Date().toISOString().slice(0,10)}.csv`;
      a.href = url; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  }

  function clearAll() {
    setDateField('registration_date'); setFrom(''); setTo(''); setStatus([]); setStage([]); setGeneration([]); setOwner(''); setDueState([]); setIsFinal(''); setSource(''); setZone('');
    setCount(null); setRows([]); setErr('');
  }

  // Load distinct options from bootstrap-like endpoint: we cheat by fetching first 1 row to infer owners? Instead fetch members/rules via supabase client quickly
  useEffect(() => {
    (async () => {
      try {
        // lightweight: use existing dashboard stats agents + try to fetch members via client
        const { createClient } = await import('@/lib/supabase/client');
        const supa = createClient();
        const [{ data: rules }, { data: members }] = await Promise.all([
          supa.from('status_rules').select('status'),
          supa.from('team_members').select('name').eq('active', true).order('name'),
        ]);
        // sources/zones via distinct snapshot? approximate from lead_list_snapshot distinct query fallback
        const [{ data: srcRows }, { data: zoneRows }] = await Promise.all([
          supa.from('lead_list_snapshot').select('source').limit(500),
          supa.from('lead_list_snapshot').select('zone').limit(500),
        ]);
        const statuses = [...new Set((rules as any[] || []).map(r=>r.status))].filter(Boolean).sort();
        const owners = (members as any[] || []).map(m=>m.name);
        const sources = [...new Set((srcRows as any[] || []).map(r=>r.source))].filter(Boolean).sort();
        const zones = [...new Set((zoneRows as any[] || []).map(r=>r.zone))].filter(Boolean).sort();
        setOpts({ statuses, owners, sources, zones });
      } catch {}
    })();
  }, []);

  // auto-preview on mount
  useEffect(() => { doPreview(); }, []);

  function toggle(arr: string[], v: string, setter: (x: string[])=>void) {
    setter(arr.includes(v) ? arr.filter(x=>x!==v) : [...arr, v]);
  }

  const activeFilters = [from,to,status.length,stage.length,generation.length,owner,dueState.length,isFinal,source,zone].filter(Boolean).length;

  return (
    <div className="reports">
      <style>{`
        .reports { --r-line: var(--line); --r-panel: var(--panel); --r-bg: var(--bg); }
        .r-head { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; justify-content:space-between; margin-bottom:14px }
        .r-head h1{ margin:0; font-size:22px; letter-spacing:-0.4px }
        .r-head p{ margin:3px 0 0; color:var(--mute); font-size:12.5px }
        .r-filters{ border:1px solid var(--line); background:var(--panel); border-radius:12px; padding:14px }
        .r-row{ display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; margin-bottom:10px }
        .r-row label{ display:flex; flex-direction:column; gap:4px; font-size:12px; font-weight:650; color:var(--mute); min-width:150px }
        .r-row label.wide{ min-width:180px }
        .r-row input, .r-row select{ height:36px }
        .chips{ display:flex; flex-wrap:wrap; gap:6px; margin-top:4px }
        .chip{ display:inline-flex; align-items:center; gap:6px; padding:4px 9px; border:1px solid var(--line); border-radius:999px; background:var(--bg); font-size:12px; cursor:pointer; user-select:none }
        .chip.on{ background:var(--brandbg); border-color:var(--accent2); color:var(--brand); font-weight:650 }
        .chip input{ display:none }
        .r-actions{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; border-top:1px solid var(--line); margin-top:10px; padding-top:12px }
        .r-actions .left{ display:flex; gap:8px; flex-wrap:wrap; align-items:center }
        .stat{ display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border-radius:10px; background:var(--bg); border:1px solid var(--line); font-size:12.5px }
        .stat b{ color:var(--ink) }
        .preview{ margin-top:14px; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--panel) }
        .preview-head{ display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--bg) }
        .tbl{ width:100%; border-collapse:collapse; font-size:12.5px }
        .tbl th{ text-align:left; padding:8px 10px; color:var(--mute); font-size:11px; border-bottom:1px solid var(--line); white-space:nowrap; background:var(--panel) }
        .tbl td{ padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis }
        .tbl tr:hover td{ background:var(--bg) }
        .empty{ padding:18px; text-align:center; color:var(--mute) }
      `}</style>

      <div className="r-head">
        <div>
          <h1><FileSpreadsheet size={18} style={{ display:'inline', verticalAlign:'-3px', marginRight:6 }}/>Reports — CSV Export</h1>
          <p>Filter by date, lead status and more → preview → download as Excel-ready CSV (UTF-8 with BOM).</p>
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="btn" onClick={clearAll}><X size={14}/>Clear</button>
          <button className="btn" onClick={doPreview} disabled={loading}><Eye size={14}/>{loading ? ' Loading…' : ' Preview'}</button>
          <button className="btn primary" onClick={doDownload} disabled={loading}><Download size={14}/>{loading ? ' Working…' : ' Download CSV'}</button>
        </div>
      </div>

      <div className="r-filters">
        {/* Row 1: date */}
        <div className="r-row">
          <label className="wide">Date field
            <select className="select" value={dateField} onChange={e=>setDateField(e.target.value)}>
              {DATE_FIELDS.map(d=><option key={d.v} value={d.v}>{d.l}</option>)}
            </select>
          </label>
          <label>From
            <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)} />
          </label>
          <label>To
            <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)} />
          </label>
          <label>Quick
            <select className="select" value="" onChange={e=>{
              const v=e.target.value; const now=new Date(); const fmt=(d:Date)=>d.toISOString().slice(0,10);
              if(v==='today'){ const t=fmt(now); setFrom(t); setTo(t); }
              if(v==='7'){ const t=new Date(now); const f=new Date(now); f.setDate(f.getDate()-6); setFrom(fmt(f)); setTo(fmt(t)); }
              if(v==='30'){ const t=new Date(now); const f=new Date(now); f.setDate(f.getDate()-29); setFrom(fmt(f)); setTo(fmt(t)); }
              if(v==='mtd'){ const f=new Date(now.getFullYear(), now.getMonth(), 1); setFrom(fmt(f)); setTo(fmt(now)); }
              e.target.value='';
            }}>
              <option value="">— presets —</option>
              <option value="today">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="mtd">This month</option>
            </select>
          </label>
          {activeFilters>0 && <span className="tag" style={{ height:28, display:'inline-flex', alignItems:'center' }}>{activeFilters} filter{activeFilters>1?'s':''} active</span>}
        </div>

        {/* Row 2: status as chips */}
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--mute)', display:'flex', alignItems:'center', gap:6 }}><Tag size={12}/> Lead Status — tap to toggle <span className="mute" style={{ fontWeight:400 }}>({status.length? status.length+' selected':'any'})</span></div>
          <div className="chips">
            {(opts.statuses.length? opts.statuses : ['New','CNR','Follow Up','Qualified','Onboarded (complete profile)','1st Trip Complete','Care Completed','Not Interested','Silent Lead','Fake Lead']).map(s=>
              <label key={s} className={`chip ${status.includes(s)?'on':''}`}><input type="checkbox" checked={status.includes(s)} onChange={()=>toggle(status,s,setStatus)} />{s}</label>
            )}
          </div>
        </div>

        {/* Row 3: stage / generation / due */}
        <div className="r-row">
          <label>Stage
            <div className="chips" style={{ marginTop:2 }}>
              {STAGES.map(s=><span key={s} className={`chip ${stage.includes(s)?'on':''}`} onClick={()=>toggle(stage,s,setStage)}>{s}</span>)}
            </div>
          </label>
          <label>Generation
            <div className="chips" style={{ marginTop:2 }}>
              {GENERATIONS.map(g=><span key={g} className={`chip ${generation.includes(g)?'on':''}`} onClick={()=>toggle(generation,g,setGeneration)}>{g}</span>)}
            </div>
          </label>
          <label>Due State
            <div className="chips" style={{ marginTop:2 }}>
              {DUE_STATES.map(d=><span key={d} className={`chip ${dueState.includes(d)?'on':''}`} onClick={()=>toggle(dueState,d,setDueState)}>{d}</span>)}
            </div>
          </label>
          <label>Is Final
            <select className="select" value={isFinal} onChange={e=>setIsFinal(e.target.value)}>
              <option value="">Any</option><option value="Yes">Final only</option><option value="No">Open only</option>
            </select>
          </label>
        </div>

        {/* collapsible */}
        <button className="btn" style={{ margin:'6px 0 0' }} onClick={()=>setShowMore(!showMore)}><Filter size={14}/>{showMore? ' Fewer filters' : ' More filters'} <ChevronDown size={14} style={{ transform: showMore? 'rotate(180deg)':'' }}/></button>
        {showMore && (
          <div className="r-row" style={{ marginTop:10 }}>
            <label>Owner
              <select className="select" value={owner} onChange={e=>setOwner(e.target.value)}>
                <option value="">Any owner</option>
                {opts.owners.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label>Source
              <select className="select" value={source} onChange={e=>setSource(e.target.value)}>
                <option value="">Any source</option>
                {opts.sources.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Zone
              <select className="select" value={zone} onChange={e=>setZone(e.target.value)}>
                <option value="">Any zone</option>
                {opts.zones.map(z=><option key={z} value={z}>{z}</option>)}
              </select>
            </label>
            <label title="Column: zone, area, product_category etc can be added on request">Need more?
              <span className="mute small" style={{ marginTop:6 }}>Ask Admin to add Business ID / phone / area filters.</span>
            </label>
          </div>
        )}

        <div className="r-actions">
          <div className="left">
            <span className="stat">{loading ? <Loader2 size={14} className="spin"/> : <Search size={14}/>} <b>{count==null? '—' : count.toLocaleString()}</b> lead{count===1?'':'s'} match</span>
            {err && <span className="tag bad">{err}</span>}
            {!err && <span className="muted small">Preview shows first 100. Download gets all matching (up to 50k).</span>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn" onClick={doPreview} disabled={loading}><Eye size={14}/> Preview</button>
            <button className="btn primary" onClick={doDownload} disabled={loading || (count!==null && count===0)}><Download size={14}/> Download CSV</button>
          </div>
        </div>
      </div>

      <div className="preview">
        <div className="preview-head">
          <b>Preview (first 100)</b><span className="mute small">{count!=null? `${count.toLocaleString()} total — downloading gives all` : 'Run Preview to see rows'}</span>
        </div>
        {!rows.length ? (
          <div className="empty">{count===0? 'No leads match these filters. Loosen date or status.' : 'No preview yet — click Preview.'}</div>
        ) : (
          <div style={{ overflow:'auto' }}>
            <table className="tbl">
              <thead><tr><th>Lead ID</th><th>Business</th><th>Merchant</th><th>Phone</th><th>Status</th><th>Stage</th><th>Owner</th><th>{DATE_FIELDS.find(d=>d.v===dateField)?.l || dateField}</th><th>Next due</th><th>Due</th><th>Gen</th></tr></thead>
              <tbody>
                {rows.map(r=>(
                  <tr key={r.lead_id}>
                    <td>{r.lead_id}</td><td>{r.business_name || '—'}</td><td>{r.merchant_name || '—'}</td><td>{r.phone_clean || '—'}</td>
                    <td><span className="tag" style={{ fontSize:11 }}>{r.current_status}</span></td><td>{r.stage}</td><td>{r.current_owner || '—'}</td>
                    <td>{String((r as any)[dateField] || '—').slice(0,10)}</td><td>{r.next_due_date?.slice(0,10) || '—'}</td><td>{r.due_state || '—'}</td><td>{r.lead_generation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mute small" style={{ marginTop:10 }}>Tip: Use date presets + status chips for fastest reporting. CSV opens cleanly in Excel/Google Sheets (UTF-8 BOM) and includes 44 columns — from Lead ID to Trip/Care. Need custom columns or scheduled email? Ask Admin.</p>
    </div>
  );
}
