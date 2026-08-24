import { useCallback, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSearch, useGlobalSearchHotkey } from "@/components/GlobalSearch";
import { cn } from "@/lib/utils";
import { getBreadcrumbForPath } from "@/lib/nav-config";
import { BRAND_NAME, LOGO_ICON_SRC } from "@/lib/brand";

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

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export default function DashboardLayout() {
  const location = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.some((route) => location.pathname.startsWith(route));
  const { section, page } = getBreadcrumbForPath(location.pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useGlobalSearchHotkey(openSearch);

  const shortcutLabel = isMacPlatform() ? "⌘K" : "Ctrl K";

  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-svh w-full bg-[var(--color-page)]">
        <AppSidebar />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[var(--color-page)] px-3 sm:px-4">
            <SidebarTrigger
              className="h-8 w-8 text-[var(--color-tertiary)] hover:bg-[var(--color-raised)] hover:text-[var(--color-primary)]"
              title="Collapse or expand sidebar"
            />
            <div className="hidden h-4 w-px bg-border sm:block" />
            <div className="flex min-w-0 items-center gap-2">
              <img src={LOGO_ICON_SRC} alt="" className="hidden h-6 w-6 object-contain sm:block" />
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className="truncate text-[var(--color-quaternary)]">{section}</span>
                <span className="text-[var(--color-quaternary)]/60">/</span>
                <span className="truncate text-[var(--color-secondary)]">{page}</span>
              </nav>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={openSearch}
                className="hidden min-w-[220px] items-center gap-2 rounded-lg border border-border bg-[var(--color-raised)] px-3 py-1.5 text-left text-sm text-[var(--color-quaternary)] transition-colors hover:border-[var(--color-stroke)] hover:text-[var(--color-tertiary)] lg:flex"
                aria-label={`Search ${BRAND_NAME}`}
              >
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Search {BRAND_NAME}…</span>
                <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-[var(--color-quaternary)]">
                  {shortcutLabel}
                </kbd>
              </button>
              <button
                type="button"
                onClick={openSearch}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-[var(--color-raised)] text-[var(--color-tertiary)] hover:text-[var(--color-primary)] lg:hidden"
                aria-label={`Search ${BRAND_NAME}`}
              >
                <Search className="h-4 w-4" />
              </button>
              <ThemeToggle />
            </div>
          </header>

          <main
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-auto",
              isFullBleed
                ? "bg-[var(--color-page)] p-0"
                : "bg-[var(--color-page)] px-4 py-5 sm:px-6 lg:px-8",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
}
