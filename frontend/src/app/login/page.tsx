'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { api, DEMO_MODE, User } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { GOOGLE_CLIENT_ID } from '../providers';
import { GoogleButton, GoogleButtonUnavailable } from '@/components/GoogleButton';
import { Spinner } from '@/components/Spinner';

type Session = { token: string; user: User };

export default function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace('/scheduled');
  }, [user, loading, router]);

  async function complete(p: Promise<Session>) {
    setBusy(true);
    setError(null);
    try {
      const s = await p;
      signIn(s.token, s.user);
      router.replace('/scheduled');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    complete(
      api<Session>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(mode === 'register' ? { name } : {}) }),
      }),
    );
  }

  function googleLogin(accessToken: string) {
    complete(api<Session>('/api/auth/google', { method: 'POST', body: JSON.stringify({ accessToken }) }));
  }

  const input =
    'w-full rounded-lg bg-surface px-4 py-3 text-sm outline-none ring-1 ring-transparent transition placeholder:text-gray-400 focus:bg-white focus:ring-brand';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#eaf7ef] via-white to-[#dff1ff] px-4 py-10">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-[0_10px_40px_rgba(0,0,0,0.08)]">
        <h1 className="mb-8 text-center text-3xl font-semibold">{mode === 'login' ? 'Login' : 'Create account'}</h1>

        {GOOGLE_CLIENT_ID ? (
          <GoogleButton onAccessToken={googleLogin} onError={setError} disabled={busy} />
        ) : (
          <GoogleButtonUnavailable />
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or sign {mode === 'login' ? 'in' : 'up'} through email
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'register' && (
            <input className={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <input
            className={input}
            type="email"
            required
            placeholder="Email ID"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="relative">
            <input
              className={`${input} pr-11`}
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              placeholder="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-70"
          >
            {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            {mode === 'login' ? 'Login' : 'Sign up'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Login'}
          </button>
        </p>

        {DEMO_MODE && (
          <p className="mt-5 rounded-lg bg-surface px-3 py-2 text-center text-xs text-muted">
            Demo mode: the scheduler backend runs inside your browser and data is stored only on this
            device. Sign up with any email to try it.
          </p>
        )}
      </div>
    </main>
  );
}
