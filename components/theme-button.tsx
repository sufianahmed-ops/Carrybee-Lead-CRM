'use client';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeButton({ floating = false }: { floating?: boolean }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('crm_theme', next);
    setDark(!dark);
  }
  return <button className={`btn icon ${floating ? 'theme-float' : ''}`} onClick={toggle} aria-label="Toggle light and dark mode" title="Light / dark mode">{dark ? <Sun /> : <Moon />}</button>;
}
