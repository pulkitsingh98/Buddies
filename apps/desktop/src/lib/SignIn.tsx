import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Current Supabase session (null = signed out, undefined = still loading). */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** Email + password sign-in / sign-up. No emails are sent (confirmation is off server-side). */
export function SignIn({ reason }: { reason: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) return <p className="error">This build isn&apos;t connected to the server.</p>;
  const client = supabase;

  async function submit() {
    setBusy(true);
    setError(null);
    const creds = { email: email.trim(), password };
    const { data, error } =
      mode === 'signup'
        ? await client.auth.signUp(creds)
        : await client.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) {
      // Signing up with an existing email: switch to sign-in for them.
      if (mode === 'signup' && /already registered/i.test(error.message)) {
        setMode('signin');
        setError('You already have an account — enter your password to sign in.');
      } else setError(error.message);
    } else if (mode === 'signup' && !data.session) {
      setError('Account created, but the server still requires email confirmation.');
    }
  }

  const valid = email.includes('@') && password.length >= 6;
  return (
    <form
      className="signin"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void submit();
      }}
    >
      <p className="muted">{reason}</p>
      <div className="signin-row">
        <input
          type="text"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder="Password (6+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy || !valid}>
          {mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </div>
      <p className="muted small">
        {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
        <button
          type="button"
          className="link"
          onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
        >
          {mode === 'signup' ? 'Sign in' : 'Create one'}
        </button>
      </p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
