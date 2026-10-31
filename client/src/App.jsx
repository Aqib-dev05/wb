import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/Toaster.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { GuestRoute, ProtectedRoute } from './routes/guards.jsx';
import { useAuthStore } from './store/authStore.js';

// Route-level splitting keeps Fabric.js (Phase 2) out of the dashboard bundle.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const EditorPage = lazy(() => import('./pages/EditorPage.jsx'));

export default function App() {
  const init = useAuthStore((s) => s.init);
  useEffect(() => { init(); }, [init]);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/board/:id" element={<EditorPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}
