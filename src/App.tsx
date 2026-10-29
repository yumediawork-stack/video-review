import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import RequireAdmin from './components/RequireAdmin';
import LoginPage from './routes/LoginPage';
import AdminDashboardPage from './routes/AdminDashboardPage';
import AdminProjectPage from './routes/AdminProjectPage';
import ReviewPage from './routes/ReviewPage';
import NotFoundPage from './routes/NotFoundPage';

function MockBadge() {
  const { isMock } = useAuth();
  if (!isMock) return null;
  return (
    <div
      className="fixed left-2 top-2 z-40 rounded bg-ink-warn/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-warn"
      title="Демо-дані у браузері (localStorage), не production"
    >
      MOCK
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <MockBadge />
        <Routes>
          <Route
            path="/login"
            element={
              // Логін і без AuthProvider доступний, але тримається в контексті сесії
              <LoginPage />
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboardPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/admin/projects/:projectId"
            element={
              <RequireAdmin>
                <AdminProjectPage />
              </RequireAdmin>
            }
          />
          <Route path="/review/:token" element={<ReviewPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  );
}
