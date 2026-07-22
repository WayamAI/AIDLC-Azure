import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="app-page-bg flex min-h-screen items-center justify-center px-4">
      <div className="page-card max-w-md p-8 text-center">
        <div className="dash-panel-icon mx-auto mb-6 h-14 w-14">
          <span className="text-lg font-semibold text-primary">404</span>
        </div>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
          The route <code className="rounded bg-muted/60 px-1.5 py-0.5 text-xs">{location.pathname}</code> does
          not exist in {BRAND_NAME}.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="default" className="gap-2">
            <Link to="/dashboard">
              <Home className="h-4 w-4" />
              Go to dashboard
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
