'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronRight, X } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Handover notifications (Request 24).
 *
 * One row per person per event is written by the database at the moment a qualified lead is
 * assigned. This component reads the signed-in person's unacknowledged rows, shows the newest
 * three as popups, keeps the rest behind the bell, and only clears one when the person presses
 * Dismiss. Nothing is ever auto-hidden: that is what "until acknowledged" has to mean.
 *
 * Realtime gives near-instant delivery; the parent's 120 s refresh re-reads as a fallback, so a
 * dropped channel degrades to the old cadence instead of losing the notification.
 */
export type Notification = {
  id: string;
  kind: string;
  lead_id: string | null;
  lead_ref: string | null;
  title: string;
  body: string | null;
  created_at: string;
  seen_at: string | null;
  ack_at: string | null;
};

const MAX_POPUPS = 3;

export function Notifications({ supabase, memberId, onOpenLead }: {
  supabase: SupabaseClient;
  memberId: string | null;
  onOpenLead: (leadRef: string) => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [browserOn, setBrowserOn] = useState(false);
  const [askBrowser, setAskBrowser] = useState(false);
  const pushed = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!memberId) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('id,kind,lead_id,lead_ref,title,body,created_at,seen_at,ack_at')
      .eq('member_id', memberId)
      .is('ack_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return;
    setItems((data || []) as Notification[]);
  }, [supabase, memberId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: one tiny table, one row per event — not the 12,000-row list snapshot.
  useEffect(() => {
    if (!memberId) return;
    const channel = supabase
      .channel('notifications:' + memberId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `member_id=eq.${memberId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, memberId, load]);

  // Desktop notification is a bonus where the browser allows it; it never replaces the popup.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') setBrowserOn(true);
    else if (Notification.permission === 'default') setAskBrowser(true);
  }, []);

  useEffect(() => {
    if (!browserOn) return;
    const fresh = items.filter(n => !pushed.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach(n => {
      pushed.current.add(n.id);
      try { new Notification(n.title, { body: n.body || '', tag: n.id }); } catch { /* browser refused */ }
    });
  }, [items, browserOn]);

  async function ack(id: string) {
    setItems(prev => prev.filter(n => n.id !== id));
    await supabase.from('notifications').update({ ack_at: new Date().toISOString() }).eq('id', id);
  }

  async function ackAll() {
    const ids = items.map(n => n.id);
    setItems([]);
    if (ids.length) await supabase.from('notifications').update({ ack_at: new Date().toISOString() }).in('id', ids);
  }

  async function enableBrowser() {
    try {
      const res = await Notification.requestPermission();
      setBrowserOn(res === 'granted');
    } catch { /* ignored */ }
    setAskBrowser(false);
  }

  function openLead(n: Notification) {
    if (n.lead_ref) onOpenLead(n.lead_ref);
    ack(n.id);
    setBellOpen(false);
  }

  if (!memberId) return null;

  const popups = items.slice(0, MAX_POPUPS);

  return <>
    {askBrowser && <div className="card notify-ask">
      <div><b>Get notified when a lead lands</b><p className="mute small" style={{ margin: '3px 0 0' }}>Allow desktop notifications so you see it even when this tab is in the background.</p></div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary" onClick={enableBrowser}>Enable</button>
        <button className="btn icon" aria-label="Not now" onClick={() => setAskBrowser(false)}><X /></button>
      </div>
    </div>}

    <div className="notify-dock">
      {popups.map(n => <div className="notify-card" key={n.id} role="alert">
        <button className="notify-x" aria-label="Dismiss" onClick={() => ack(n.id)}><X /></button>
        <b>{n.title}</b>
        {n.body && <p>{n.body}</p>}
        <div className="notify-actions">
          {n.lead_ref && <button className="btn primary" onClick={() => openLead(n)}>Open lead<ChevronRight /></button>}
          <button className="btn" onClick={() => ack(n.id)}><Check />Dismiss</button>
        </div>
      </div>)}
      {items.length > MAX_POPUPS && <button className="notify-more" onClick={() => setBellOpen(true)}>
        +{items.length - MAX_POPUPS} more waiting
      </button>}
    </div>

    <div className="notify-bell">
      <button className={`btn icon ${items.length ? 'has-new' : ''}`} aria-label={`Notifications (${items.length})`} onClick={() => setBellOpen(v => !v)}>
        <Bell />
        {items.length > 0 && <span className="notify-count">{items.length > 99 ? '99+' : items.length}</span>}
      </button>
      {bellOpen && <div className="notify-panel">
        <div className="notify-panel-head">
          <b>Notifications</b>
          {items.length > 0 && <button className="btn" onClick={ackAll}>Dismiss all</button>}
        </div>
        {!items.length && <p className="mute small" style={{ padding: '10px 4px' }}>Nothing waiting. Handovers will appear here.</p>}
        {items.map(n => <div className="notify-row" key={n.id}>
          <div>
            <b>{n.title}</b>
            {n.body && <p className="mute small" style={{ margin: '2px 0 0' }}>{n.body}</p>}
            <span className="mute small">{new Date(n.created_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {n.lead_ref && <button className="btn" onClick={() => openLead(n)}>Open</button>}
            <button className="btn icon" aria-label="Dismiss" onClick={() => ack(n.id)}><Check /></button>
          </div>
        </div>)}
      </div>}
    </div>
  </>;
}
