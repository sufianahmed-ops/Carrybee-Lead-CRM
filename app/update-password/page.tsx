'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ThemeButton } from '@/components/theme-button';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else setError('Open this page from the invitation or reset link in your email.');
    });
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace('/');
  }
  return <main className="auth-page"><ThemeButton floating /><form className="auth-card" onSubmit={submit}>
    <div className="brand">carry<span>bee</span></div><h1>Set your password</h1>
    <p className="mute" style={{ margin: '0 0 22px' }}>Choose a private password for your CRM account.</p>
    {busy && <div className="busy" />}<div className="stack">
      <label className="field">New password<input className="input" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="field">Repeat password<input className="input" type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
    </div><div className="error">{error}</div>
    <button className="btn primary" disabled={!ready || busy}>Save password and open CRM</button>
  </form></main>;
}
