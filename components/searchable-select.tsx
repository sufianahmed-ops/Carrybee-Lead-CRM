'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

// A list-select that can be typed into. Works as a normal form control:
// keep the form's `name` on the hidden input and read it with new FormData(form).
export function SearchableSelect({ name, options, value, onChange, placeholder = '-', searchPlaceholder = 'Type to search…', emptyText = 'No match' }: {
  name: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    // prefix matches first, then anywhere-in-the-name matches
    const starts = options.filter(o => o.toLowerCase().startsWith(needle));
    const has = options.filter(o => !starts.includes(o) && o.toLowerCase().includes(needle));
    return [...starts, ...has];
  }, [q, options]);

  function choose(next: string) { onChange(next); setOpen(false); setQ(''); }

  return <div className="searchable" ref={wrap}>
    {/* the value the form submits */}
    <input type="hidden" name={name} value={value} />
    <button type="button" className="select searchable-trigger" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
      <span className={value ? '' : 'mute'}>{value || placeholder}</span>
      <span className="searchable-icons">
        {value && <X className="clear" onClick={e => { e.stopPropagation(); choose(''); }} aria-label="Clear" />}
        <ChevronDown />
      </span>
    </button>
    {open && <div className="searchable-menu">
      <div className="searchable-search">
        <Search />
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={`Search ${name.replace('profile_', '')}`}
          onKeyDown={e => { if (e.key === 'Enter' && matches.length) { e.preventDefault(); choose(matches[0]); } if (e.key === 'Enter' && !matches.length && !q.trim()) { e.preventDefault(); choose(''); } }} />
        {q && <X className="clear" onClick={() => setQ('')} aria-label="Clear search" />}
      </div>
      <div className="searchable-list" role="listbox">
        {/* the blank choice is hidden while searching so it never gets in the way */}
        {!q.trim() && <button type="button" className={`searchable-option ${value === '' ? 'active' : ''}`} onClick={() => choose('')}>{placeholder}</button>}
        {matches.map(option => <button type="button" key={option} role="option" aria-selected={option === value}
          className={`searchable-option ${option === value ? 'active' : ''}`} onClick={() => choose(option)}>
          <span>{option}</span>{option === value && <Check />}
        </button>)}
        {!matches.length && <p className="searchable-empty">{emptyText}</p>}
      </div>
      <p className="searchable-count">{matches.length} of {options.length}</p>
    </div>}
  </div>;
}
