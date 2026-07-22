import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  GitBranch,
  Wand2,
  Terminal,
  GitPullRequest,
  Share2,
  ClipboardList,
  ScanSearch,
  FileSearch,
  MonitorPlay,
  ShieldAlert,
  Rocket,
  ShieldCheck,
  Radar,
  FileText,
  TestTubes,
  FlaskConical,
  ListOrdered,
  Database,
  Layers,
  Bug,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  hint?: string;
};

export type NavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const dashboardItem: NavItem = {
  title: "Dashboard",
  url: "/dashboard",
  icon: LayoutDashboard,
};

export const pipelineItem: NavItem = {
  title: "SDLC Pipeline",
  url: "/pipeline",
  icon: GitBranch,
  hint: "End-to-end delivery workflow",
};

export const platformSections: NavSection[] = [
  {
    id: "build",
    label: "Build & Code",
    icon: Layers,
    items: [
      { title: "AI App Builder", url: "/ai-ide", icon: Wand2, hint: "Generate React apps from prompts" },
      { title: "AI Workspace", url: "/workspace", icon: Terminal, hint: "Editor + Copilot + Git" },
      { title: "Code Reviewer", url: "/code-review", icon: GitPullRequest, hint: "AI inline PR review" },
      { title: "Code Impact", url: "/code-impact", icon: Share2, hint: "Dependency graph + tests" },
      { title: "PRD Generator", url: "/prd", icon: ClipboardList, hint: "AI requirements doc" },
    ],
  },
  {
    id: "testing",
    label: "Testing & Quality",
    icon: Bug,
    items: [
      { title: "Repo Test Baseline", url: "/repo-baseline", icon: ScanSearch, hint: "Playwright test scan" },
      { title: "Doc-Driven Tests", url: "/doc-tests", icon: FileSearch, hint: "Docs → test scenarios" },
      { title: "Live Test Runner", url: "/live-testing", icon: MonitorPlay, hint: "AI browser execution" },
      { title: "Defect Prediction", url: "/defect-prediction", icon: ShieldAlert, hint: "File risk scoring" },
    ],
  },
  {
    id: "release",
    label: "Release & Ops",
    icon: Rocket,
    items: [
      { title: "Deployments", url: "/deployments", icon: Rocket, hint: "Vercel deploy tracking" },
      { title: "Release Gate", url: "/release-gate", icon: ShieldCheck, hint: "Go / no-go decision" },
      { title: "Monitoring", url: "/monitoring", icon: Radar, hint: "Anomaly detection" },
    ],
  },
];

export const betaSection: NavSection = {
  id: "beta",
  label: "Beta / In Progress",
  icon: FlaskConical,
  items: [
    { title: "Requirements", url: "/requirements", icon: FileText },
    { title: "Test Suite", url: "/generated-tests", icon: TestTubes },
    { title: "Test Execution", url: "/test-execution", icon: FlaskConical },
    { title: "Risk Ranking", url: "/prioritization", icon: ListOrdered },
    { title: "Synthetic Data", url: "/synthetic-data", icon: Database },
  ],
};

export const allNavItems: NavItem[] = [
  dashboardItem,
  pipelineItem,
  ...platformSections.flatMap((s) => s.items),
  ...betaSection.items,
];

export function findSectionForPath(pathname: string): string | null {
  for (const section of platformSections) {
    if (section.items.some((item) => item.url === pathname)) return section.id;
  }
  if (betaSection.items.some((item) => item.url === pathname)) return betaSection.id;
  return null;
}

const extraPageMeta: Record<string, { title: string; section: string }> = {
  "/profile": { title: "Profile", section: "Account" },
  "/cost-tracker": { title: "API Costs", section: "Admin" },
};

export function findNavItemForPath(pathname: string): NavItem | null {
  return allNavItems.find((item) => item.url === pathname) ?? null;
}

export function getBreadcrumbForPath(pathname: string): { section: string; page: string } {
  const extra = extraPageMeta[pathname];
  if (extra) return extra;

  const item = findNavItemForPath(pathname);
  if (!item) {
    const label = pathname.split("/").filter(Boolean).pop() ?? "Page";
    return { section: "AIDLC", page: label.charAt(0).toUpperCase() + label.slice(1).replace(/-/g, " ") };
  }

  if (pathname === dashboardItem.url) return { section: "Overview", page: item.title };
  if (pathname === pipelineItem.url) return { section: "Pipeline", page: item.title };

  const sectionId = findSectionForPath(pathname);
  if (sectionId === betaSection.id) return { section: betaSection.label, page: item.title };

  const platformSection = platformSections.find((s) => s.id === sectionId);
  return {
    section: platformSection?.label ?? "Platform Tools",
    page: item.title,
  };
}
