import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogoMark } from '../components/ui/Logo.jsx';
import { useNotifications } from '../hooks/useNotifications.js';
import { useAuthStore } from '../store/authStore.js';

function BootScreen() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <div className="animate-pulse"><LogoMark size={44} /></div>
    </div>
  );
}

export function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  useNotifications(status === 'authenticated');
  if (status === 'loading') return <BootScreen />;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function GuestRoute() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') return <BootScreen />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}
