import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight01Icon, Logout01Icon, Settings01Icon, UserIcon } from "@hugeicons/core-free-icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AppIcon } from "@/components/AppIcon";
import { cn } from "@/lib/utils";
import { BRAND_NAME, BRAND_TAGLINE, LOGO_ICON_SRC } from "@/lib/brand";
import { BrandLogo } from "@/components/BrandLogo";
import {
  dashboardItem,
  pipelineItem,
  platformSections,
  findSectionForPath,
  type NavItem,
  type NavSection,
} from "@/lib/nav-config";
import { useAuth } from "@/context/AuthContext";

const OPEN_SECTION_KEY = "aidlc-sidebar-open-section";

function loadOpenSection(): string | null {
  try {
    const raw = localStorage.getItem(OPEN_SECTION_KEY);
    if (raw && platformSections.some((s) => s.id === raw)) return raw;
  } catch {
    /* ignore */
  }
  return "build";
}

function NavMenuLink({ item, collapsed, sub = false }: { item: NavItem; collapsed: boolean; sub?: boolean }) {
  const location = useLocation();
  const active = location.pathname === item.url || location.pathname.startsWith(`${item.url}/`);

  const link = (
    <NavLink to={item.url} end title={item.hint ?? item.title}>
      <AppIcon icon={item.icon} size={sub ? 15 : 17} strokeWidth={1.6} className="text-current" />
      {(sub || !collapsed) && <span>{item.title}</span>}
    </NavLink>
  );

  if (sub) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={active}>
          {link}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
        {link}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function CollapsibleNavSection({
  section,
  collapsed,
  open,
  onOpenChange,
}: {
  section: NavSection;
  collapsed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const location = useLocation();
  const hasActiveChild = section.items.some(
    (item) => location.pathname === item.url || location.pathname.startsWith(`${item.url}/`),
  );

  if (collapsed) {
    return (
      <>
        {section.items.map((item) => (
          <NavMenuLink key={item.url} item={item} collapsed />
        ))}
      </>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={section.label}
            className={cn(
              "h-9 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground",
              hasActiveChild && "text-foreground",
            )}
          >
            <AppIcon icon={section.icon} size={17} strokeWidth={1.6} className="text-current" />
            <span className="flex-1 truncate text-left">{section.label}</span>
            <AppIcon
              icon={ArrowRight01Icon}
              size={14}
              strokeWidth={1.75}
              className="ml-auto text-current transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {section.items.map((item) => (
              <NavMenuLink key={item.url} item={item} collapsed={false} sub />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [openSectionId, setOpenSectionId] = useState<string | null>(loadOpenSection);

  const activeSectionId = useMemo(() => findSectionForPath(location.pathname), [location.pathname]);

  useEffect(() => {
    if (activeSectionId) {
      setOpenSectionId(activeSectionId);
      localStorage.setItem(OPEN_SECTION_KEY, activeSectionId);
    }
  }, [activeSectionId]);

  const handleSectionOpenChange = (sectionId: string, open: boolean) => {
    const next = open ? sectionId : openSectionId === sectionId ? null : openSectionId;
    setOpenSectionId(next);
    if (next) localStorage.setItem(OPEN_SECTION_KEY, next);
    else localStorage.removeItem(OPEN_SECTION_KEY);
  };

  const handleLogout = () => {
    void logout().then(() => navigate("/login"));
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-[var(--color-container)]">
      <SidebarHeader className={cn("shrink-0 border-b border-border", collapsed ? "p-2" : "px-3 py-3")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "min-w-0")}>
          {collapsed ? (
            <img src={LOGO_ICON_SRC} alt={BRAND_NAME} className="h-8 w-8 object-contain" />
          ) : (
            <div className="min-w-0">
              <BrandLogo className="h-16 w-auto max-w-[260px] scale-110 origin-left" />
              <p className="mt-1 truncate text-[11px] text-[var(--color-quaternary)]">{BRAND_TAGLINE}</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-x-hidden overflow-y-auto p-0">
        <SidebarGroup className="py-2">
          {!collapsed && (
            <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Overview
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <NavMenuLink item={dashboardItem} collapsed={collapsed} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup className="py-2">
          {!collapsed && (
            <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Pipeline
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <NavMenuLink item={pipelineItem} collapsed={collapsed} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup className="py-2">
          {!collapsed && (
            <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Platform
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {platformSections.map((section) => (
                <CollapsibleNavSection
                  key={section.id}
                  section={section}
                  collapsed={collapsed}
                  open={openSectionId === section.id}
                  onOpenChange={(open) => handleSectionOpenChange(section.id, open)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-sidebar-border/60 p-2">
        {collapsed ? (
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <AppIcon icon={Logout01Icon} size={16} />
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 rounded-lg px-1 py-1">
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-sidebar-accent"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-raised)] text-[var(--color-secondary)] ring-1 ring-border">
                <AppIcon icon={UserIcon} size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-foreground">
                  {user?.name || user?.email || "My Workspace"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">{user?.org_name || "Signed in"}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings/connectors")}
              title="Connectors"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <AppIcon icon={Settings01Icon} size={14} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <AppIcon icon={Logout01Icon} size={14} />
            </button>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
