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

/** Email + 6-digit code sign-in. No passwords, no browser redirect. */
export function SignIn({ reason }: { reason: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) return <p className="error">This build isn&apos;t connected to the server.</p>;
  const client = supabase;

  async function send() {
    setBusy(true);
    setError(null);
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await client.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <div className="signin">
      <p className="muted">{reason}</p>
      {!sent ? (
        <div className="signin-row">
          <input
            type="text"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || !email.includes('@')}
            onClick={() => void send()}
          >
            Email me a code
          </button>
        </div>
      ) : (
        <div className="signin-row">
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || code.trim().length < 6}
            onClick={() => void verify()}
          >
            Sign in
          </button>
          <button onClick={() => setSent(false)}>Back</button>
        </div>
      )}
      {sent && <p className="muted small">Check {email} for a code.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
