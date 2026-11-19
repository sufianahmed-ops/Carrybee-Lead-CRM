import { useEffect, useMemo, useState } from 'react';
import type { Lead } from '@/lib/types';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Column headings. Kept here so every table in the workspace reads the same.
 */
const labels: Record<string, string> = {
  lead_id: 'Lead ID', business_id: 'Business ID', business_name: 'Business', merchant_name: 'Merchant',
  phone_clean: 'Phone', phone: 'Phone', source: 'Source', registration_date: 'Registration date',
  assign_date: 'Assign date', current_status: 'Status', stage: 'Stage', last_reason: 'Last reason',
  handover_booked_time: 'Booked handover', handover_call_state: 'Handover call', trip_deadline: 'Trip deadline',
  first_trip_date: '1st trip', first_order_date: 'First order', care_end_date: 'Care ends',
  care_days_left: 'Care days left', last_status_date: 'Status date', onboarded_form: 'Onboarded form',
  first_trip_cid: '1st trip CID', pickup_miss: 'Pickup miss', next_due_date: 'Next due',
  due_state: 'Due state', alert: 'Alert', current_owner: 'Owner', lqt_touches: 'Touches',
  points: 'Points', qualified_by_name: 'Qualified by', qualified_at: 'Qualified on',
  lead_generation: 'Gen', last_note: 'Last note', duplicate_phone: 'Duplicate phone',
  pickup_state: 'Pickup',
};

const dateColumns = new Set(['next_due_date','trip_deadline','first_trip_date','first_order_date','care_end_date','last_status_date','registration_date','assign_date','qualified_at','callback_date']);

const PAGE_SIZES = [25, 50, 100, 250];

export function Highlight({ text, query }: { text: string; query: string }) {
  const t = String(text ?? ''); if (!t) return null;
  const q = query.trim().toLowerCase(); if (!q || q.length < 2) return <>{t}</>;
  const i = t.toLowerCase().indexOf(q); if (i < 0) return <>{t}</>;
  return <>{t.slice(0,i)}<mark className="hl">{t.slice(i,i+q.length)}</mark>{t.slice(i+q.length)}</>;
}
export function DueChip({ lead }: { lead: Lead }) {
  const s = String((lead as any).due_state || ''); const d = String((lead as any).next_due_date || '').slice(0,10);
  if (!s && !d) return null;
  const cls = /overdue/i.test(s) ? 'tag bad' : /today/i.test(s) ? 'tag warn' : /tomorrow/i.test(s) ? 'tag' : 'tag';
  const dot = /overdue/i.test(s) ? '● ' : /today/i.test(s) ? '◐ ' : '';
  return <span className={cls} title={d ? `Due ${d}` : s}>{dot}{s || d}{d && s ? ` · ${d}` : ''}</span>;
}
function Cell({ lead, column, query }: { lead: Lead; column: string; query?: string }) {
  const raw = (lead as any)[column];
  const value = String(raw ?? '');
  if (column === 'phone_clean') return value ? <a href={`tel:${value}`} onClick={e => e.stopPropagation()}><Highlight text={value} query={query||''} /></a> : null;
  if (column === 'current_status' || column === 'stage') return value ? <span className={column === 'current_status' ? 'tag status' : 'tag'}><Highlight text={value} query={query||''} /></span> : null;
  if (column === 'due_state') {
    const cls = /overdue/i.test(value) ? 'tag bad' : /today/i.test(value) ? 'tag warn' : 'tag';
    return value ? <span className={cls}>{value}</span> : null;
  }
  if (column === 'alert') return value ? <span className="alert-text" title={value}>{value}</span> : null;
  if (column === 'pickup_state') {
    if (!value) return null;
    const cls = value === 'LastChance' ? 'tag bad' : value === 'Cancelled' ? 'tag warn' : value === 'Received' ? 'tag good' : 'tag';
    const text = value === 'LastChance' ? 'Expires today' : value === 'Pending' ? 'Awaiting pickup' : value;
    return <span className={cls}>{text}</span>;
  }
  if (column === 'business_name' || column === 'merchant_name' || column === 'lead_id') return <span className="lead-name"><Highlight text={value} query={query||''} /></span>;
  if (dateColumns.has(column) && value) return <>{value.slice(0, 10)}</>;
  return <><Highlight text={value} query={query||''} /></>;
}

export function LeadTable({ leads, columns, onOpen, selected, onToggle, onSelectAll, searchQuery, serverMode, totalCount, serverPage, serverPageSize, onPageChange }: {
  leads: Lead[]; columns: string[]; onOpen: (id: string) => void;
  selected?: Set<string>; onToggle?: (id: string, checked: boolean) => void; onSelectAll?: (checked: boolean) => void;
  searchQuery?: string;
  serverMode?: boolean; totalCount?: number; serverPage?: number; serverPageSize?: number; onPageChange?: (page:number, pageSize:number)=>void;
}) {
  const [pageSize, setPageSize] = useState(serverPageSize || 50);
  const [page, setPage] = useState(serverPage || 1);
  useEffect(()=>{ if(serverPage) setPage(serverPage); }, [serverPage]);
  useEffect(()=>{ if(serverPageSize) setPageSize(serverPageSize); }, [serverPageSize]);

  // Server mode: pagination handled by parent — slice is already the page
  if (serverMode) {
    const total = totalCount ?? leads.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(page, pages);
    const from = total ? (current - 1) * pageSize + 1 : 0;
    const to = Math.min(current * pageSize, total);
    const bulk = !!selected && !!onToggle;
    if (!leads.length) return <div className="table-wrap"><div className="empty">Nothing here right now.</div></div>;
    return (
      <div className="table-wrap">
        <table>
          <thead><tr>
            {bulk && <th className="sel"><input type="checkbox" aria-label="Select all" checked={leads.length > 0 && leads.every(l => selected!.has(l.lead_id))} onChange={e => onSelectAll?.(e.target.checked)} /></th>}
            {columns.map(c => <th key={c}>{labels[c] || c}</th>)}
          </tr></thead>
          <tbody>
            {leads.map(lead => <tr key={lead.id} className="clickable" onClick={() => onOpen(lead.lead_id)}>
              {bulk && <td className="sel" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${lead.lead_id}`} checked={selected!.has(lead.lead_id)} onChange={e => onToggle!(lead.lead_id, e.target.checked)} /></td>}
              {columns.map(c => <td key={c}><Cell lead={lead} column={c} query={searchQuery} /></td>)}
            </tr>)}
          </tbody>
        </table>
        <div className="pager">
          <span className="pager-info">Showing <b>{from}–{to}</b> of <b>{total.toLocaleString('en-GB')}</b></span>
          <label className="pager-size">Rows
            <select className="select" aria-label="Rows per page" value={pageSize} onChange={e => { const ns=Number(e.target.value); setPageSize(ns); setPage(1); onPageChange?.(1, ns); }}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="pager-page">Page <b>{current}</b> of <b>{pages}</b></span>
          <div className="pager-btns">
            <button className="btn icon" aria-label="Previous page" disabled={current <= 1} onClick={() => { const np=current-1; setPage(np); onPageChange?.(np, pageSize); }}><ChevronLeft /></button>
            <button className="btn icon" aria-label="Next page" disabled={current >= pages} onClick={() => { const np=current+1; setPage(np); onPageChange?.(np, pageSize); }}><ChevronRight /></button>
          </div>
        </div>
      </div>
    );
  }

  const shape = useMemo(() => leads.length + ':' + columns.join(','), [leads.length, columns]);
  useEffect(() => { if(!serverMode) setPage(1); }, [shape, pageSize]);

  const pages = Math.max(1, Math.ceil(leads.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const slice = leads.slice(start, start + pageSize);

  if (!leads.length) return <div className="table-wrap"><div className="empty">Nothing here right now.</div></div>;
  const bulk = !!selected && !!onToggle;
  const from = leads.length ? start + 1 : 0;
  const to = Math.min(start + pageSize, leads.length);

  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          {bulk && <th className="sel"><input type="checkbox" aria-label="Select all" checked={slice.length > 0 && slice.every(l => selected!.has(l.lead_id))} onChange={e => onSelectAll?.(e.target.checked)} /></th>}
          {columns.map(c => <th key={c}>{labels[c] || c}</th>)}
        </tr></thead>
        <tbody>
          {slice.map(lead => <tr key={lead.id} className="clickable" onClick={() => onOpen(lead.lead_id)}>
            {bulk && <td className="sel" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${lead.lead_id}`} checked={selected!.has(lead.lead_id)} onChange={e => onToggle!(lead.lead_id, e.target.checked)} /></td>}
            {columns.map(c => <td key={c}><Cell lead={lead} column={c} query={searchQuery} /></td>)}
          </tr>)}
        </tbody>
      </table>

      <div className="pager">
        <span className="pager-info">Showing <b>{from}–{to}</b> of <b>{leads.length.toLocaleString('en-GB')}</b></span>
        <label className="pager-size">Rows
          <select className="select" aria-label="Rows per page" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="pager-page">Page <b>{current}</b> of <b>{pages}</b></span>
        <div className="pager-btns">
          <button className="btn icon" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft /></button>
          <button className="btn icon" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight /></button>
        </div>
      </div>
    </div>
  );
}
