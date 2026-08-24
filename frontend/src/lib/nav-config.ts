import {
  DashboardSquare01Icon,
  WorkflowSquare01Icon,
  AiInnovation01Icon,
  CodeFolderIcon,
  GitCompareIcon,
  HierarchyIcon,
  DocumentValidationIcon,
  FileValidationIcon,
  ChartLineData01Icon,
  TaskDaily01Icon,
  DatabaseSync01Icon,
  SearchVisualIcon,
  FileSearchIcon,
  TestTube01Icon,
  TestTube02Icon,
  BrowserIcon,
  AnalyticsUpIcon,
  Bug02Icon,
  AiBrain01Icon,
  FilterIcon,
  RepairIcon,
  Rocket01Icon,
  SecurityValidationIcon,
  ServerStack01Icon,
  Activity01Icon,
  Alert02Icon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";

export type NavIcon = typeof DashboardSquare01Icon;

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
  icon: DashboardSquare01Icon,
};

export const pipelineItem: NavItem = {
  title: "SDLC Pipeline",
  url: "/pipeline",
  icon: WorkflowSquare01Icon,
  hint: "End-to-end delivery workflow",
};

/** All shipped product areas no Beta bucket for live features. */
export const platformSections: NavSection[] = [
  {
    id: "build",
    label: "Build & Code",
    icon: Layers01Icon,
    items: [
      { title: "AI App Builder", url: "/ai-ide", icon: AiInnovation01Icon, hint: "Generate React apps from prompts" },
      { title: "AI Workspace", url: "/workspace", icon: CodeFolderIcon, hint: "Editor + Copilot + Git" },
      { title: "Code Reviewer", url: "/code-review", icon: GitCompareIcon, hint: "AI inline PR review" },
      { title: "Code Impact", url: "/code-impact", icon: HierarchyIcon, hint: "Dependency graph + tests" },
      { title: "PRD Generator", url: "/prd", icon: DocumentValidationIcon, hint: "AI requirements doc" },
    ],
  },
  {
    id: "requirements",
    label: "Requirements & Planning",
    icon: FileValidationIcon,
    items: [
      { title: "Requirements", url: "/requirements", icon: FileValidationIcon, hint: "Capture and analyze requirements" },
      {
        title: "Requirements Intelligence",
        url: "/requirements-intelligence",
        icon: ChartLineData01Icon,
        hint: "Story quality and coverage insights",
      },
      {
        title: "Sprint Intelligence",
        url: "/sprint-intelligence",
        icon: TaskDaily01Icon,
        hint: "Sprint risk and delivery signals",
      },
      { title: "Synthetic Data", url: "/synthetic-data", icon: DatabaseSync01Icon, hint: "Generate test datasets" },
    ],
  },
  {
    id: "testing",
    label: "Testing & Quality",
    icon: Bug02Icon,
    items: [
      { title: "Repo Test Baseline", url: "/repo-baseline", icon: SearchVisualIcon, hint: "Playwright test scan" },
      { title: "Doc-Driven Tests", url: "/doc-tests", icon: FileSearchIcon, hint: "Docs → test scenarios" },
      { title: "Test Suite", url: "/generated-tests", icon: TestTube01Icon, hint: "Generated and managed test cases" },
      { title: "Test Execution", url: "/test-execution", icon: TestTube02Icon, hint: "Run and track test runs" },
      { title: "Live Test Runner", url: "/live-testing", icon: BrowserIcon, hint: "AI browser execution" },
      { title: "Risk Ranking", url: "/prioritization", icon: AnalyticsUpIcon, hint: "Risk-based test prioritization" },
      { title: "Defect Prediction", url: "/defect-prediction", icon: Bug02Icon, hint: "File risk scoring" },
      { title: "AI Root Cause Analysis", url: "/root-cause", icon: AiBrain01Icon, hint: "Failure diagnosis" },
      {
        title: "Intelligent Test Selection",
        url: "/test-selection",
        icon: FilterIcon,
        hint: "Change-based test selection",
      },
      {
        title: "Self-Healing Tests",
        url: "/self-healing",
        icon: RepairIcon,
        hint: "Live selector repair with approval",
      },
    ],
  },
  {
    id: "release",
    label: "Release & Ops",
    icon: Rocket01Icon,
    items: [
      { title: "Deployments", url: "/deployments", icon: Rocket01Icon, hint: "Vercel deploy tracking" },
      { title: "Release Gate", url: "/release-gate", icon: SecurityValidationIcon, hint: "Go / no-go decision" },
      { title: "CI Intelligence", url: "/ci-intelligence", icon: ServerStack01Icon, hint: "Pipeline health and flaky tests" },
      { title: "Monitoring", url: "/monitoring", icon: Activity01Icon, hint: "Anomaly detection" },
      { title: "Incidents", url: "/incidents", icon: Alert02Icon, hint: "Incident response and postmortems" },
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
  "/cost-tracker": { title: "API Costs", section: "Admin" },
};

export function getBreadcrumbForPath(pathname: string): { section: string; page: string } {
  const extra = extraPageMeta[pathname];
  if (extra) return { section: extra.section, page: extra.title };

  const item = findNavItemForPath(pathname);
  if (!item) {
    const label = pathname.split("/").filter(Boolean).pop() ?? "Page";
    return {
      section: "AIDLC",
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
