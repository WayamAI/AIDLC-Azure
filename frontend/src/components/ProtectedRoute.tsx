import { Navigate, Outlet } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";

function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <EmptyState kind="loading">Checking your session…</EmptyState>
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
