'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ThemeButton } from '@/components/theme-button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(e: FormEvent) {
    e.preventDefault(); setError(''); setMessage(''); setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace('/'); router.refresh();
  }
  async function reset() {
    setError(''); setMessage('');
    if (!email.trim()) return setError('Enter your email first, then choose “Forgot password”.');
    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${location.origin}/update-password`,
    });
    setBusy(false);
    if (error) setError(error.message); else setMessage('Check your email for a secure password-reset link.');
  }
  return <main className="auth-page">
    <ThemeButton floating />
    <form className="auth-card" onSubmit={login}>
      <div className="brand">carry<span>bee</span></div>
      <h1>Lead CRM</h1>
      <p className="mute" style={{ margin: '0 0 22px' }}>Sign in with your invited work email.</p>
      {busy && <div className="busy" />}
      <div className="stack">
        <label className="field">Work email<input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@carrybee.com" /></label>
        <label className="field">Password<input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" /></label>
      </div>
      <div className="error" role="alert">{error}</div>
      {message && <p className="success small">{message}</p>}
      <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
      <button className="btn" type="button" style={{ border: 0, color: 'var(--mute)' }} onClick={reset} disabled={busy}>Forgot password?</button>
      <p className="auth-foot">Access is by admin invitation only.<br />Your session is secured by Supabase Auth.</p>
    </form>
  </main>;
}
