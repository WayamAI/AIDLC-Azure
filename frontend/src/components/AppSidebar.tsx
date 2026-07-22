import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LogOut, User } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BRAND_NAME, BRAND_TAGLINE, LOGO_ICON_SRC, LOGO_SRC } from "@/lib/brand";
import {
  dashboardItem,
  pipelineItem,
  platformSections,
  betaSection,
  findSectionForPath,
  type NavItem,
  type NavSection,
} from "@/lib/nav-config";
import { useAuth } from "@/context/AuthContext";

const OPEN_SECTION_KEY = "wayam-sidebar-open-section";

const allSections = [...platformSections, betaSection];

function loadOpenSection(): string | null {
  try {
    const raw = localStorage.getItem(OPEN_SECTION_KEY);
    if (raw && allSections.some((s) => s.id === raw)) return raw;
  } catch {
    /* ignore */
  }
  return "build";
}

function NavMenuLink({
  item,
  collapsed,
  sub = false,
}: {
  item: NavItem;
  collapsed: boolean;
  sub?: boolean;
}) {
  const location = useLocation();
  const active = location.pathname === item.url;
  const Icon = item.icon;

  if (sub) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={active}>
          <NavLink to={item.url} end title={item.hint ?? item.title}>
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{item.title}</span>
          </NavLink>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
        <NavLink to={item.url} end title={item.hint ?? item.title}>
          <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
          {!collapsed && <span>{item.title}</span>}
        </NavLink>
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
  const isActive = (path: string) => location.pathname === path;
  const SectionIcon = section.icon;
  const hasActiveChild = section.items.some((item) => isActive(item.url));

  if (collapsed) {
    return (
      <>
        {section.items.map((item) => (
          <NavMenuLink key={item.url} item={item} collapsed={collapsed} />
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
              "h-9 font-semibold uppercase tracking-wide text-[11px] text-muted-foreground hover:text-foreground",
              hasActiveChild && "text-primary",
            )}
          >
            <SectionIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="flex-1 truncate text-left">{section.label}</span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
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
  const { logout } = useAuth();

  const [openSectionId, setOpenSectionId] = useState<string | null>(loadOpenSection);

  const activeSectionId = useMemo(
    () => findSectionForPath(location.pathname),
    [location.pathname],
  );

  useEffect(() => {
    if (activeSectionId) {
      setOpenSectionId(activeSectionId);
      localStorage.setItem(OPEN_SECTION_KEY, activeSectionId);
    }
  }, [activeSectionId]);

  const handleSectionOpenChange = (sectionId: string, open: boolean) => {
    const next = open ? sectionId : openSectionId === sectionId ? null : openSectionId;
    setOpenSectionId(next);
    if (next) {
      localStorage.setItem(OPEN_SECTION_KEY, next);
    } else {
      localStorage.removeItem(OPEN_SECTION_KEY);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className={cn("shrink-0 border-b border-sidebar-border/60", collapsed ? "p-2" : "px-3 py-3")}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "min-w-0")}>
          {!collapsed ? (
            <div className="min-w-0">
              <img
                src={LOGO_SRC}
                alt={BRAND_NAME}
                className="h-7 w-auto max-w-[140px] object-contain object-left"
              />
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{BRAND_TAGLINE}</p>
            </div>
          ) : (
            <img src={LOGO_ICON_SRC} alt={BRAND_NAME} className="h-8 w-8 object-contain" />
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-y-auto overflow-x-hidden p-0">
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
              Platform Tools
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

        <SidebarSeparator />

        <SidebarGroup className="py-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <CollapsibleNavSection
                section={betaSection}
                collapsed={collapsed}
                open={openSectionId === betaSection.id}
                onOpenChange={(open) => handleSectionOpenChange(betaSection.id, open)}
              />
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
            <LogOut className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 rounded-lg px-1 py-1">
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-sidebar-accent"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-foreground">My Workspace</p>
                <p className="truncate text-[10px] text-muted-foreground">Project engineer</p>
              </div>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
