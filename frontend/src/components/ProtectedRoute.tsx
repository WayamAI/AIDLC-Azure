import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page text-sm text-[var(--color-tertiary)]">
      Checking session…
    </div>
  );
}

export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <SessionLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <SessionLoading />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
