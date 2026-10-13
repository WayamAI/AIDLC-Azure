import { useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Mark } from "@/components/Mark";
import { BRAND_NAME } from "@/lib/brand";
import { useAuth } from "@/context/AuthContext";

const NotFound = () => {
  const location = useLocation();

  const { isAuthenticated } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-md rounded-lg border border-stroke-muted bg-container p-6">
        <Mark id="mark-empty-not-found" size={72} className="mb-4" />
        <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Error 404</p>
        <h1 className="mt-2 font-display text-[22px] font-normal leading-tight text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-ink-tertiary">
          The route <code className="break-all font-mono text-xs text-ink-secondary">{location.pathname}</code> does not
          exist in {BRAND_NAME}.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {isAuthenticated ? (
            <Button asChild>
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotFound;
