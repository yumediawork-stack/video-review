import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { user, loading, signIn, isMock } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/admin" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate('/admin', { replace: true });
    } catch {
      setError(
        isMock
          ? 'Mock-режим: введіть будь-які дані.'
          : 'Невірний email або пароль.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm">
        {isMock && (
          <div className="mb-3 rounded-card border border-ink-warn/30 bg-[#33261A]/40 px-3 py-2 text-center text-xs text-ink-warn">
            MOCK-режим: демо-дані, будь-який email/пароль дасть вхід.
          </div>
        )}
        <form onSubmit={submit} className="vr-card p-6" noValidate>
          <h1 className="text-lg font-semibold">Video Review</h1>
          <p className="mt-1 text-xs text-ink-muted">Приватний вхід для власника сервісу.</p>

          <div className="mt-5">
            <label className="vr-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="vr-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </div>
          <div className="mt-3">
            <label className="vr-label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="vr-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="mt-3 text-xs text-ink-danger" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="vr-btn vr-btn-accent mt-5 w-full" disabled={busy}>
            {busy && <span className="vr-spinner inline-block h-4 w-4 rounded-full border-2 border-white/50 border-t-transparent" />}
            Увійти
          </button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-ink-muted/70">
            Реєстрація недоступна. Користувача адміністратора створюють вручну в Supabase Dashboard.
          </p>
        </form>
      </div>
    </main>
  );
}
