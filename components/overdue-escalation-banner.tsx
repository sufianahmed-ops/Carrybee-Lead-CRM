'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';

type Row = { owner: string; overdue: number; member_id: string|null; last_escalated_at: string|null; last_count: number|null };

const DISMISS_KEY = 'crm:dismiss:overdueEscalation';
const DISMISS_TTL = 60 * 60 * 1000; // 1 hour

function useDismissTtl(key: string, ttl: number) {
  const [dismissed, setDismissed] = useState(false);
  const check = useCallback(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      if (!raw) { setDismissed(false); return; }
      const ts = Number(raw);
      if (!Number.isFinite(ts)) { setDismissed(false); return; }
      setDismissed(Date.now() - ts < ttl);
    } catch { setDismissed(false); }
  }, [key, ttl]);
  useEffect(() => {
    check();
    const t = setInterval(check, 60 * 1000);
    const onStorage = (e: StorageEvent) => { if (e.key === key) check(); };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(t); window.removeEventListener('storage', onStorage); };
  }, [check]);
  const dismiss = useCallback(() => {
    try { window.localStorage.setItem(key, String(Date.now())); } catch {}
    setDismissed(true);
  }, [key]);
  return { dismissed, dismiss };
}

export function OverdueEscalationBanner({ onOpenProfile }: { onOpenProfile?: (owner: string)=>void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<{days:number; min:number; enabled:boolean}|null>(null);
  const [busy, setBusy] = useState(false);
  const { dismissed, dismiss } = useDismissTtl(DISMISS_KEY, DISMISS_TTL);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/escalations', { cache:'no-store' });
      const j = await r.json();
      if (j.ok) { setRows(j.overdue||[]); setMeta({days:j.days,min:j.min,enabled:j.enabled}); }
    } catch {}
  }, []);

  useEffect(()=>{ load(); const t=setInterval(load, 5*60*1000); return ()=>clearInterval(t); }, [load]);

  async function recheck() {
    setBusy(true);
    try {
      await fetch('/api/escalations', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
      await load();
    } finally { setBusy(false); }
  }

  if (!meta?.enabled) return null;
  if (!rows.length) return null;
  if (dismissed) return null;

  const top = rows.slice(0,4);
  return (
    <div className="banner warn" role="alert" style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'10px 12px', borderRadius:8, marginBottom:12, border:'1px solid #ffe69c', background:'#fff8e1', fontSize:13, lineHeight:1.4 }}>
      <AlertTriangle size={18} style={{ color:'#7a5c00', marginTop:1, flexShrink:0 }} />
      <div style={{ flex:1 }}>
        <b>Overdue escalations — {rows.length} agent{rows.length===1?'':'s'} ≥{meta.min} leads overdue &gt;{meta.days}d</b>
        <div className="mute small" style={{ marginTop:6, display:'flex', gap:8, flexWrap:'wrap' }}>
          {top.map(r=>(
            <button key={r.owner} className="tag bad" style={{ cursor: onOpenProfile? 'pointer':'default' }} onClick={()=>onOpenProfile?.(r.owner)} title={`Last escalated: ${r.last_escalated_at? new Date(r.last_escalated_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'never'}`}>
              {r.owner}: <b>{r.overdue}</b> &gt;{meta.days}d
            </button>
          ))}
          {rows.length>4 && <span className="mute">+{rows.length-4} more</span>}
        </div>
        <div className="mute small" style={{ marginTop:6 }}>
          Runs daily 09:00 Dhaka + on demand. Dedup 24h — nudges managers + owner. Check <b>Old book — due now</b> / <b>Follow Up</b> and consider Lending help.
        </div>
      </div>
      <div className="row" style={{ gap:6, flexShrink:0 }}>
        <button className="btn primary" onClick={recheck} disabled={busy}>{busy?'Checking…':'Check now'}</button>
        <button className="btn" onClick={load} title="Refresh"><RefreshCw size={14}/></button>
        <button className="btn icon" aria-label="Dismiss for 1 hour" onClick={dismiss} title="Dismiss for 1 hour"><X size={14}/></button>
      </div>
    </div>
  );
}
