import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/** Захищений маршрут: очікує сесію; при відсутності — /login. */
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading, isMock } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-muted">
        <span className="vr-spinner inline-block h-6 w-6 rounded-full border-2 border-ink-accent border-t-transparent" aria-label="Завантаження" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  void isMock;
  return <>{children}</>;
}
