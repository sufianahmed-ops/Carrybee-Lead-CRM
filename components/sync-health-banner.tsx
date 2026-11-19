'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, X } from 'lucide-react';

type Health = {
  last_success_at: string | null;
  last_any_at: string | null;
  last_status: string | null;
  last_error_count: number | null;
  hours_since_success: number | null;
  is_stale: boolean;
  checked_at: string;
  today_dhaka: string;
  last_success_date_dhaka: string | null;
};

type ApiResp = {
  ok: boolean;
  status: 'ok' | 'stale' | 'failed';
  message: string;
  health: Health;
  checked_at?: string;
  error?: string;
};

function fmtDhaka(iso: string | null) {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Dhaka',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const DISMISS_KEY = 'crm:dismiss:syncHealth';
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

export function SyncHealthBanner({ onOpenDetails }: { onOpenDetails?: () => void }) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const { dismissed, dismiss } = useDismissTtl(DISMISS_KEY, DISMISS_TTL);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/sync-health', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) setData(j);
      else setData({ ok: false, status: 'failed', message: j.error || 'Unknown', health: j.health } as any);
    } catch (e: any) {
      setData({ ok: false, status: 'failed', message: e.message || String(e), health: {} as any } as any);
    } finally {
      setLoading(false);
    }
  }, []);

  const forceCheck = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch('/api/sync-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check' }),
      });
      const j = await r.json();
      if (j.ok) await load();
    } finally {
      setChecking(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  if (loading || !data) return null;
  if (dismissed) return null;
  if (data.status === 'ok') {
    return (
      <div className="banner ok" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 12px', background: '#e6f4ea', border: '1px solid #b7e0c1', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
        <CheckCircle2 size={16} style={{ color: '#137333', flexShrink: 0 }} />
        <span>Sync ok — last success {fmtDhaka(data.health.last_success_at)} Dhaka ({data.health.hours_since_success != null ? Number(data.health.hours_since_success).toFixed(1) + 'h ago' : 'just now'})</span>
        <span className="grow" />
        <button className="btn" onClick={load} title="Recheck"><RefreshCw size={14} />Recheck</button>
        <button className="btn icon" aria-label="Dismiss for 1 hour" onClick={dismiss} title="Dismiss for 1 hour"><X size={14} /></button>
      </div>
    );
  }

  const isStale = data.status === 'stale';
  return (
    <div
      className={`banner ${isStale ? 'bad' : 'warn'}`}
      role="alert"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 8,
        marginBottom: 12,
        border: `1px solid ${isStale ? '#f5c6cb' : '#ffe69c'}`,
        background: isStale ? '#fdecea' : '#fff8e1',
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <AlertTriangle size={18} style={{ color: isStale ? '#b3261e' : '#7a5c00', marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <b>{isStale ? 'Sync missing' : 'Sync failed'}</b> — {data.message}
        <div className="mute small" style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span><Clock3 size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> Last success: {fmtDhaka(data.health.last_success_at)} Dhaka</span>
          <span>Last run: {fmtDhaka(data.health.last_any_at)} · {data.health.last_status} {data.health.last_error_count ? `· ${data.health.last_error_count} errors` : ''}</span>
          <span>Expected: daily 08:00 Dhaka · window: {data.health.hours_since_success != null ? Number(data.health.hours_since_success).toFixed(1) + 'h' : '?'} since success</span>
        </div>
        {data.health.last_status === 'failed' || data.health.last_status === 'partial' ? (
          <div className="mute small" style={{ marginTop: 6 }}>
            Check: <b>Apps Script → Sync_Log tab</b>, <b>Vercel → CRON_SECRET</b>, sheet tab names (<code>1st_Order_Date_Dump*</code>), and <code>sheet_sync_runs</code> message.
          </div>
        ) : (
          <div className="mute small" style={{ marginTop: 6 }}>
            Check: <b>Apps Script trigger</b> still at 08:00 Dhaka (Extensions → Apps Script → Triggers), <b>CRON_SECRET</b> matches Vercel, and sheet is not paused.
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
        <button className="btn primary" onClick={forceCheck} disabled={checking} title="Ask the database to re-check and notify admins/leads now">
          {checking ? 'Checking…' : 'Check now'}
        </button>
        <button className="btn" onClick={onOpenDetails} title="Open sync log">Details</button>
        <button className="btn icon" aria-label="Dismiss for 1 hour" onClick={dismiss} title="Dismiss for 1 hour"><X size={14} /></button>
      </div>
    </div>
  );
}
