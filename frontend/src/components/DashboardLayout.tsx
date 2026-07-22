import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { cn } from "@/lib/utils";
import { getBreadcrumbForPath } from "@/lib/nav-config";

const FULL_BLEED_ROUTES = [
  "/pipeline",
  "/workspace",
  "/ai-ide",
  "/prd",
  "/code-impact",
  "/live-testing",
  "/live-test-runner",
  "/doc-tests",
];

const DashboardLayout = () => {
  const location = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.some((route) => location.pathname.startsWith(route));
  const { section, page } = getBreadcrumbForPath(location.pathname);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-4 backdrop-blur-sm">
            <SidebarTrigger className="h-8 w-8 text-muted-foreground hover:text-foreground" />
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="truncate text-muted-foreground">{section}</span>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-medium text-foreground">{page}</span>
            </nav>
          </header>
          <main
            className={cn(
              "flex-1 overflow-auto",
              isFullBleed ? "bg-background p-0" : "app-page-bg px-4 py-5 sm:px-6",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardLayout;
