import {
  Activity,
  AppWindow,
  ArrowUpDown,
  BrainCircuit,
  Bug,
  CalendarCheck,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  Filter,
  FolderCode,
  GitCompare,
  Layers,
  LayoutGrid,
  LineChart,
  Network,
  Rocket,
  ScanSearch,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube,
  TestTubes,
  TriangleAlert,
  Workflow,
  Wrench,
  ClipboardList,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";

export type NavIcon = LucideIcon;

export type NavItem = {
  title: string;
  url: string;
  icon: NavIcon;
  hint?: string;
};

export type NavSection = {
  id: string;
  label: string;
  icon: NavIcon;
  items: NavItem[];
};

export const dashboardItem: NavItem = {
  title: "Dashboard",
  url: "/dashboard",
  icon: LayoutGrid,
};

export const pipelineItem: NavItem = {
  title: "SDLC Pipeline",
  url: "/pipeline",
  icon: Workflow,
  hint: "End-to-end delivery workflow",
};

/** All shipped product areas no Beta bucket for live features. */
export const platformSections: NavSection[] = [
  {
    id: "build",
    label: "Build & Code",
    icon: Layers,
    items: [
      { title: "App Studio", url: "/ai-ide", icon: Sparkles, hint: "Build an app from a description" },
      { title: "Code Workspace", url: "/workspace", icon: FolderCode, hint: "Editor, Git and assistant" },
      { title: "Code Review", url: "/code-review", icon: GitCompare, hint: "Inline pull request review" },
      { title: "Code Impact", url: "/code-impact", icon: Network, hint: "Dependency graph and affected tests" },
      { title: "Product Specs", url: "/prd", icon: FileText, hint: "Write a product requirements document" },
    ],
  },
  {
    id: "requirements",
    label: "Requirements & Planning",
    icon: ClipboardList,
    items: [
      { title: "Requirements", url: "/requirements", icon: ClipboardCheck, hint: "Capture and analyze requirements" },
      {
        title: "Requirement Insights",
        url: "/requirements-intelligence",
        icon: LineChart,
        hint: "Story quality and coverage insights",
      },
      {
        title: "Sprint Health",
        url: "/sprint-intelligence",
        icon: CalendarCheck,
        hint: "Sprint risk and delivery signals",
      },
      { title: "Test Data", url: "/synthetic-data", icon: Database, hint: "Generate test datasets" },
    ],
  },
  {
    id: "testing",
    label: "Testing & Quality",
    icon: FlaskConical,
    items: [
      { title: "Test Baseline", url: "/repo-baseline", icon: ScanSearch, hint: "Playwright test scan" },
      { title: "Tests from Docs", url: "/doc-tests", icon: FileSearch, hint: "Docs → test scenarios" },
      { title: "Test Suite", url: "/generated-tests", icon: TestTube, hint: "Generated and managed test cases" },
      { title: "Test Execution", url: "/test-execution", icon: TestTubes, hint: "Run test cases in a real browser" },
      { title: "Live Test Run", url: "/live-testing", icon: AppWindow, hint: "Watch a test run in a real browser" },
      { title: "Risk Ranking", url: "/prioritization", icon: ArrowUpDown, hint: "Ranked by failure history and severity" },
      { title: "Change Hotspots", url: "/defect-prediction", icon: Bug, hint: "Files ranked by churn and bug fixes" },
      { title: "Root Cause Analysis", url: "/root-cause", icon: BrainCircuit, hint: "Failure diagnosis" },
      {
        title: "Test Selection",
        url: "/test-selection",
        icon: Filter,
        hint: "Change-based test selection",
      },
      {
        title: "Test Repair",
        url: "/self-healing",
        icon: Wrench,
        hint: "Live selector repair with approval",
      },
    ],
  },
  {
    id: "release",
    label: "Release & Ops",
    icon: Rocket,
    items: [
      { title: "Deployments", url: "/deployments", icon: Rocket, hint: "Vercel deploy tracking" },
      { title: "Release Gate", url: "/release-gate", icon: ShieldCheck, hint: "Go / no-go decision" },
      { title: "CI Health", url: "/ci-intelligence", icon: Server, hint: "Workflow run health" },
      { title: "Metric Anomalies", url: "/monitoring", icon: Activity, hint: "Analyse a demo or pasted series" },
      { title: "Incidents", url: "/incidents", icon: TriangleAlert, hint: "Incident response and postmortems" },
      { title: "Connectors", url: "/settings/connectors", icon: Settings, hint: "GitHub, Vercel, Ollama, Jira keys" },
    ],
  },
];

export const allNavItems: NavItem[] = [
  dashboardItem,
  pipelineItem,
  ...platformSections.flatMap((s) => s.items),
];

export function findSectionForPath(pathname: string): string | null {
  for (const section of platformSections) {
    if (section.items.some((item) => item.url === pathname || pathname.startsWith(`${item.url}/`))) {
      return section.id;
    }
  }
  return null;
}

export function findNavItemForPath(pathname: string): NavItem | null {
  return allNavItems.find((item) => item.url === pathname || pathname.startsWith(`${item.url}/`)) ?? null;
}

const extraPageMeta: Record<string, { title: string; section: string }> = {
  "/profile": { title: "Profile", section: "Account" },
  "/settings/connectors": { title: "Connectors", section: "Settings" },
  "/cost-tracker": { title: "Usage & Cost", section: "Admin" },
};

export function getBreadcrumbForPath(pathname: string): { section: string; page: string } {
  const extra = extraPageMeta[pathname];
  if (extra) return { section: extra.section, page: extra.title };

  const item = findNavItemForPath(pathname);
  if (!item) {
    const label = pathname.split("/").filter(Boolean).pop() ?? "Page";
    return {
      section: "Chakram",
      page: label.charAt(0).toUpperCase() + label.slice(1).replace(/-/g, " "),
    };
  }

  if (pathname === dashboardItem.url) return { section: "Overview", page: item.title };
  if (pathname === pipelineItem.url) return { section: "Pipeline", page: item.title };

  const sectionId = findSectionForPath(pathname);
  const platformSection = platformSections.find((s) => s.id === sectionId);
  return {
    section: platformSection?.label ?? "Platform",
    page: item.title,
  };
}

export type Crumb = { label: string; href?: string };

/** Names for the segment after a page's own URL, e.g. /root-cause/<id>. */
const detailLabels: Record<string, string> = {
  "/root-cause": "Analysis",
};

/**
 * Trail for the top bar: section, page, and a detail level when the URL goes
 * deeper than the page. Only crumbs the user can actually navigate to get an
 * href; the last crumb is the current location.
 */
export function getBreadcrumbs(pathname: string): Crumb[] {
  const { section, page } = getBreadcrumbForPath(pathname);
  const item = findNavItemForPath(pathname);
  const sectionId = findSectionForPath(pathname);
  const sectionHome = platformSections.find((s) => s.id === sectionId)?.items[0]?.url;

  const crumbs: Crumb[] = [];
  if (pathname !== dashboardItem.url) {
    crumbs.push({ label: section, href: sectionHome && sectionHome !== item?.url ? sectionHome : undefined });
  } else {
    crumbs.push({ label: section });
  }

  const onDetail = !!item && pathname !== item.url && pathname.startsWith(`${item.url}/`);
  if (onDetail) {
    crumbs.push({ label: page, href: item.url });
    crumbs.push({ label: detailLabels[item.url] ?? "Details" });
  } else {
    crumbs.push({ label: page });
  }
  return crumbs;
}
