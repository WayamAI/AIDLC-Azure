import React, { useState } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  FileText,
  Download,
  Pencil,
  Eye,
  CheckCircle2,
  BookOpen,
  Users,
  Target,
  List,
  ClipboardList,
  BarChart3,
  XCircle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { AiIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiClient } from "@/lib/api";
import { BRAND_NAME } from "@/lib/brand";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseCase {
  title: string;
  actor: string;
  description: string;
  preconditions: string;
  steps: string[];
  postcondition: string;
}

interface UserStory {
  as_a: string;
  i_want: string;
  so_that: string;
  acceptance_criteria: string[];
  priority: "Must Have" | "Should Have" | "Nice to Have";
}

interface PRDData {
  product_name: string;
  version: string;
  created_at: string;
  executive_summary: string;
  problem_statement: string;
  goals: string[];
  target_users: { role: string; description: string }[];
  use_cases: UseCase[];
  user_stories: UserStory[];
  functional_requirements: { id: string; title: string; description: string }[];
  non_functional_requirements: { category: string; requirement: string }[];
  out_of_scope: string[];
  success_metrics: { metric: string; target: string }[];
  assumptions: string[];
  markdown: string;
}

// ── Client-side PRD Generator ─────────────────────────────────────────────────

function inferContext(name: string, desc: string) {
  const combined = `${name} ${desc}`.toLowerCase();
  const isFinance = /financ|payment|invoice|billing|budget|wallet|bank|tax|expense|calculat/.test(combined);
  const isHealth = /health|medical|patient|doctor|clinic|hospital|fitness|wellness/.test(combined);
  const isEcommerce = /shop|store|cart|product|order|checkout|inventory|marketplace/.test(combined);
  const isGallery = /gallery|photo|image|media|upload|visual|creative|portfolio/.test(combined);
  const isAuth = /auth|login|register|user|account|profile|password|access/.test(combined);
  const isSocial = /social|chat|message|feed|post|comment|follow|community/.test(combined);
  const isAnalytics = /analytic|dashboard|report|chart|metric|monitor|track|insight/.test(combined);
  const isSaas = /saas|platform|service|cloud|api|integration|workspace|team/.test(combined);

  return { isFinance, isHealth, isEcommerce, isGallery, isAuth, isSocial, isAnalytics, isSaas };
}

function generatePRDFromInput(name: string, description: string): PRDData {
  const ctx = inferContext(name, description);
  const now = new Date().toISOString();
  const version = "1.0";

  // ── Executive Summary ──
  const executive_summary = `${name} is ${description.charAt(0).toLowerCase() + description.slice(1).replace(/\.$/, "")}. This document outlines the complete product requirements, use cases, user stories, and acceptance criteria to guide design, development, and QA teams through the delivery lifecycle. The goal is to establish a shared understanding of what will be built, for whom, and how success will be measured.`;

  // ── Problem Statement ──
  const problem_statement = ctx.isFinance
    ? `Users currently lack a unified, intuitive tool to manage and visualize their financial data. Existing solutions are either overly complex for casual users or too limited for power users, leading to manual workarounds, data fragmentation, and poor financial decision-making. ${name} addresses this gap by providing a streamlined, accurate, and accessible financial management experience.`
    : ctx.isHealth
    ? `Healthcare workflows are burdened by disjointed systems, paper-based records, and poor patient-provider communication. ${name} aims to digitize and streamline these interactions, reducing administrative overhead and improving patient outcomes.`
    : ctx.isGallery
    ? `Photographers and creative professionals need a secure, organized way to share high-resolution work with clients while maintaining control over downloads, approvals, and brand presentation. Current tools sacrifice either security or usability. ${name} bridges this gap.`
    : ctx.isEcommerce
    ? `Buyers and sellers face friction in the discovery, transaction, and fulfilment process due to fragmented tools and poor UX. ${name} provides an end-to-end commerce experience that reduces drop-off and increases conversion.`
    : `Teams and individuals using existing solutions face inefficiency, lack of automation, and poor integration with their existing workflows. ${name} solves this by delivering a focused, well-designed product that reduces friction and increases productivity.`;

  // ── Goals ──
  const goals = ctx.isFinance
    ? [
        `Deliver an accurate, real-time ${name} that handles edge cases and currency precision`,
        "Enable users to save, compare, and share calculation results",
        "Provide a mobile-first experience accessible on all screen sizes",
        "Support multiple calculation modes and contextual help",
        "Achieve a task completion rate of ≥ 95% in usability testing",
      ]
    : ctx.isGallery
    ? [
        "Allow photographers to upload and organize galleries in under 2 minutes",
        "Provide clients with a branded, password-protected viewing experience",
        "Implement approval workflows that reduce email back-and-forth by 80%",
        "Support lossless image delivery with optional watermarking",
        "Achieve 99.9% uptime SLA for gallery delivery",
      ]
    : [
        `Launch a production-ready ${name} within the defined project timeline`,
        "Deliver an intuitive UX that requires no onboarding documentation for core tasks",
        "Achieve a Net Promoter Score (NPS) of ≥ 40 within 60 days of launch",
        "Support a minimum of 1,000 concurrent users without degradation",
        "Ensure all data handling complies with relevant regulatory requirements",
      ];

  // ── Target Users ──
  const target_users = ctx.isFinance
    ? [
        { role: "Individual Users", description: "People who need to perform quick, accurate financial calculations for personal budgeting or planning" },
        { role: "Business Professionals", description: "Finance teams and analysts requiring repeatable, auditable calculation workflows" },
        { role: "Developers / Integrators", description: "Teams embedding calculation functionality into their own products via API" },
      ]
    : ctx.isGallery
    ? [
        { role: "Photographer", description: "Primary creator who uploads, organizes, and shares gallery content with clients" },
        { role: "Client", description: "End recipient who views, approves, or requests revisions to delivered work" },
        { role: "Admin", description: "Platform administrator who manages accounts, billing, and system settings" },
      ]
    : [
        { role: "End User", description: `Primary user who interacts with ${name} to accomplish their core tasks` },
        { role: "Admin / Manager", description: "Power user with elevated permissions to configure and manage the platform" },
        { role: "Guest / Viewer", description: "Limited-access user who can view but not modify content" },
      ];

  // ── Use Cases ──
  const use_cases: UseCase[] = ctx.isFinance
    ? [
        {
          title: "Perform a Calculation",
          actor: "Individual User",
          description: "User inputs values and parameters to get an accurate calculated result",
          preconditions: "User has opened the application",
          steps: [
            "User navigates to the main calculator screen",
            "User selects the calculation type (e.g., loan, tax, compound interest)",
            "User enters the required input values",
            "System validates inputs in real-time and highlights errors",
            "User clicks 'Calculate'",
            "System displays the result with a breakdown of the computation",
            "User optionally saves or shares the result",
          ],
          postcondition: "Result is displayed accurately; user can export or share",
        },
        {
          title: "Save and Compare Results",
          actor: "Individual User",
          description: "User saves multiple calculation results and compares them side by side",
          preconditions: "User has performed at least one calculation",
          steps: [
            "User clicks 'Save Result' after a calculation",
            "System stores the result with a timestamp and label",
            "User navigates to the 'Saved Results' section",
            "User selects two or more results to compare",
            "System renders a side-by-side comparison table",
            "User can delete, export, or share the comparison",
          ],
          postcondition: "Saved results are persisted and accessible in future sessions",
        },
        {
          title: "Export Report",
          actor: "Business Professional",
          description: "User exports a formatted PDF or CSV of calculation results for reporting",
          preconditions: "User has a saved calculation result",
          steps: [
            "User selects one or more saved results",
            "User clicks 'Export'",
            "System presents format options: PDF, CSV, Excel",
            "User selects format and clicks 'Download'",
            "System generates the file and initiates a download",
          ],
          postcondition: "Formatted report file is downloaded to the user's device",
        },
      ]
    : ctx.isGallery
    ? [
        {
          title: "Upload and Publish Gallery",
          actor: "Photographer",
          description: "Photographer uploads a batch of images and creates a client-facing gallery",
          preconditions: "Photographer is authenticated and has a project created",
          steps: [
            "Photographer navigates to 'New Gallery'",
            "Photographer enters gallery name, client email, and optional expiry date",
            "Photographer drags and drops images or selects them via file picker",
            "System shows upload progress per image with success/error indicators",
            "Photographer optionally enables watermark and sets download permissions",
            "Photographer clicks 'Publish Gallery'",
            "System generates a shareable link and emails the client",
          ],
          postcondition: "Gallery is live; client receives an email with the secure access link",
        },
        {
          title: "Client Reviews and Approves",
          actor: "Client",
          description: "Client views the gallery and marks images as approved or requests revisions",
          preconditions: "Client has received the gallery link and opened it",
          steps: [
            "Client opens the gallery URL (optionally enters password)",
            "System displays the gallery in a full-screen viewer",
            "Client browses images and clicks 'Approve' or 'Request Revision' per image",
            "For revisions, client enters a comment",
            "Client submits the review",
            "System notifies the photographer with the approval status and comments",
          ],
          postcondition: "Photographer receives structured feedback; approval status is recorded",
        },
      ]
    : [
        {
          title: `Core ${name} Workflow`,
          actor: "End User",
          description: `User completes the primary action provided by ${name}`,
          preconditions: "User is authenticated and on the main dashboard",
          steps: [
            `User navigates to the main ${name} interface`,
            "User selects or creates a new item to work with",
            "User fills in the required fields and configures options",
            "System validates the input and shows inline feedback",
            "User submits the action",
            "System processes the request and displays a success confirmation",
            "User can view, edit, or share the result",
          ],
          postcondition: "Action is recorded; user can access the result from their history",
        },
        {
          title: "Manage Account Settings",
          actor: "End User",
          description: "User updates profile, preferences, and notification settings",
          preconditions: "User is authenticated",
          steps: [
            "User clicks on their avatar or 'Settings' in the navigation",
            "System displays the settings panel with tabs: Profile, Preferences, Notifications",
            "User edits the desired fields",
            "User clicks 'Save Changes'",
            "System validates and persists the updates",
            "System displays a success toast notification",
          ],
          postcondition: "Settings are saved and take effect immediately",
        },
        {
          title: "Admin: User Management",
          actor: "Admin / Manager",
          description: "Admin invites, deactivates, or changes roles for team members",
          preconditions: "Admin is authenticated with admin-level permissions",
          steps: [
            "Admin navigates to 'Team Management'",
            "Admin clicks 'Invite User' and enters the email address and role",
            "System sends an invitation email with a signup link",
            "Admin can view pending invites and revoke them if needed",
            "Admin can deactivate existing users from the users table",
            "System immediately revokes session for deactivated users",
          ],
          postcondition: "Team membership reflects the admin's changes",
        },
      ];

  // ── User Stories ──
  const user_stories: UserStory[] = ctx.isFinance
    ? [
        {
          as_a: "individual user",
          i_want: "enter loan amount, interest rate, and tenure to get my monthly EMI",
          so_that: "I can plan my monthly budget before taking a loan",
          acceptance_criteria: [
            "Input fields accept numeric values only with appropriate validation",
            "Result updates in real-time as inputs change",
            "Amortization schedule is displayed below the result",
            "Result is displayed to 2 decimal places",
          ],
          priority: "Must Have",
        },
        {
          as_a: "business professional",
          i_want: "export my calculation history as a PDF report",
          so_that: "I can present financial projections in client meetings",
          acceptance_criteria: [
            "Export button is visible on the results screen",
            "PDF includes the product name, date, inputs, and result",
            "Download initiates within 3 seconds",
            "File is named with date and calculation type",
          ],
          priority: "Should Have",
        },
        {
          as_a: "user",
          i_want: "save and label multiple calculations",
          so_that: "I can compare different financial scenarios",
          acceptance_criteria: [
            "Save button is available after every calculation",
            "User can assign a custom label to each saved result",
            "Saved results persist across sessions (local storage or account)",
            "Compare view shows inputs and outputs side by side",
          ],
          priority: "Should Have",
        },
        {
          as_a: "mobile user",
          i_want: "use the calculator on my phone with a clean layout",
          so_that: "I can perform calculations on the go",
          acceptance_criteria: [
            "Layout is fully responsive at 375px and above",
            "Input fields are large enough for touch interaction",
            "No horizontal scrolling occurs on mobile",
            "All features work on iOS Safari and Android Chrome",
          ],
          priority: "Must Have",
        },
      ]
    : [
        {
          as_a: "end user",
          i_want: `complete the core workflow of ${name} in under 3 steps`,
          so_that: "I can accomplish my goal quickly without friction",
          acceptance_criteria: [
            "Primary action is reachable within 2 clicks from the dashboard",
            "Form validation provides inline feedback without page reload",
            "Success state is clearly communicated with a confirmation message",
            "User can undo or edit the last action",
          ],
          priority: "Must Have",
        },
        {
          as_a: "new user",
          i_want: "register and get started without reading documentation",
          so_that: "I can begin using the product immediately",
          acceptance_criteria: [
            "Onboarding flow is completable in under 2 minutes",
            "Key features are surfaced with contextual tooltips on first visit",
            "Empty states include actionable prompts",
            "Registration requires only email and password",
          ],
          priority: "Must Have",
        },
        {
          as_a: "admin",
          i_want: "view usage analytics and manage team members",
          so_that: "I can monitor adoption and maintain access control",
          acceptance_criteria: [
            "Admin dashboard shows active users, actions per day, and error rates",
            "User list supports search, filter by role, and bulk actions",
            "Role changes take effect immediately without requiring re-login",
            "Audit log records all admin actions with timestamps",
          ],
          priority: "Should Have",
        },
        {
          as_a: "returning user",
          i_want: "see my recent activity and pick up where I left off",
          so_that: "I don't have to search for my previous work",
          acceptance_criteria: [
            "Dashboard shows last 5 items with timestamps",
            "Quick-access links restore the user's last context",
            "Draft state is auto-saved every 30 seconds",
          ],
          priority: "Should Have",
        },
        {
          as_a: "user on mobile",
          i_want: "access all core features on my smartphone",
          so_that: "I'm not limited to desktop use",
          acceptance_criteria: [
            "Responsive layout at 375px, 768px, and 1280px breakpoints",
            "All touch targets are at least 44×44px",
            "No functionality is hidden or disabled on mobile",
          ],
          priority: "Must Have",
        },
      ];

  // ── Functional Requirements ──
  const functional_requirements = ctx.isFinance
    ? [
        { id: "FR-01", title: "Calculation Engine", description: "System must support loan EMI, compound interest, tax estimation, and currency conversion calculations with precision to 6 decimal places internally" },
        { id: "FR-02", title: "Real-time Input Validation", description: "All input fields must validate on change; invalid inputs must show contextual error messages without form submission" },
        { id: "FR-03", title: "Result Breakdown", description: "Each result must include a step-by-step breakdown showing how the final value was computed" },
        { id: "FR-04", title: "Calculation History", description: "System must persist the last 50 calculations per user session; authenticated users get unlimited history" },
        { id: "FR-05", title: "Save & Label", description: "Users must be able to save any result with a custom label and retrieve it in a dedicated 'Saved' section" },
        { id: "FR-06", title: "Compare Mode", description: "Users can select 2–5 saved results to view side-by-side in a comparison table" },
        { id: "FR-07", title: "Export", description: "Results must be exportable as PDF and CSV; PDF must include a branded header, inputs, result, and breakdown" },
        { id: "FR-08", title: "Share Link", description: "Users can generate a shareable read-only link to any calculation result" },
        { id: "FR-09", title: "Responsive Layout", description: "All screens must be fully functional on viewport widths from 320px to 2560px" },
        { id: "FR-10", title: "Accessibility", description: "All interactive elements must be keyboard navigable and ARIA-labelled; WCAG 2.1 AA compliance required" },
      ]
    : [
        { id: "FR-01", title: "User Authentication", description: "System must support email/password registration, login, logout, and password reset via email verification link" },
        { id: "FR-02", title: "Role-Based Access Control", description: "System must enforce End User, Admin, and Guest roles with distinct permission sets; role changes take effect immediately" },
        { id: "FR-03", title: `Core ${name} Functionality`, description: `System must implement all primary features of ${name} as described in the use cases, with complete CRUD operations` },
        { id: "FR-04", title: "Real-time Feedback", description: "All form submissions must provide inline validation and display success or error states without full page reload" },
        { id: "FR-05", title: "Search & Filter", description: "All list views must support text search, column-level filtering, and sorting; results must update within 300ms" },
        { id: "FR-06", title: "Notifications", description: "System must send email and in-app notifications for key events; users can configure notification preferences" },
        { id: "FR-07", title: "Audit Log", description: "All create, update, and delete actions must be recorded with actor, timestamp, and before/after state" },
        { id: "FR-08", title: "Data Export", description: "Users must be able to export their data in CSV and JSON formats from any list view" },
        { id: "FR-09", title: "Responsive Design", description: "All screens must be fully functional on viewport widths from 320px to 2560px with no horizontal scroll" },
        { id: "FR-10", title: "Onboarding Flow", description: "New users must be guided through key features on first login via a dismissible step-by-step tour" },
      ];

  // ── Non-Functional Requirements ──
  const non_functional_requirements = [
    { category: "Performance", requirement: "Page load time must be ≤ 2 seconds on a 4G connection; API responses must be ≤ 500ms at the 95th percentile under normal load" },
    { category: "Scalability", requirement: "System must support 1,000 concurrent users without degradation; architecture must allow horizontal scaling" },
    { category: "Availability", requirement: "Target 99.9% uptime SLA; planned maintenance windows must not exceed 4 hours per month and must occur between 02:00–06:00 UTC" },
    { category: "Security", requirement: "All data in transit must use TLS 1.2+; passwords must be hashed with bcrypt (cost factor ≥ 12); input sanitization must prevent XSS and SQL injection" },
    { category: "Data Privacy", requirement: "System must comply with GDPR and applicable data protection regulations; PII must be encrypted at rest; users have the right to data deletion" },
    { category: "Usability", requirement: "Core tasks must be completable by a first-time user with no training; System Usability Scale (SUS) score target ≥ 75" },
    { category: "Maintainability", requirement: "Code coverage for unit tests must be ≥ 80%; all public APIs must be documented with OpenAPI 3.0 spec" },
    { category: "Browser Support", requirement: "Must support the latest 2 versions of Chrome, Firefox, Safari, and Edge on desktop and mobile" },
  ];

  // ── Out of Scope ──
  const out_of_scope = ctx.isFinance
    ? [
        "Integration with external banking APIs or live market data feeds in v1.0",
        "Native mobile applications (iOS / Android); web-only in v1.0",
        "Multi-currency real-time conversion with live exchange rates",
        "AI-powered financial advice or investment recommendations",
        "Third-party SSO (Google, Microsoft) in v1.0",
      ]
    : [
        `Native mobile app (iOS/Android) web app only in ${version}`,
        "Third-party SSO integrations (Google, Microsoft, GitHub) beyond email/password in v1.0",
        "AI-powered content recommendations or predictive features in v1.0",
        "Offline mode or PWA functionality",
        "Multi-language / i18n support beyond English in v1.0",
      ];

  // ── Success Metrics ──
  const success_metrics = ctx.isFinance
    ? [
        { metric: "Task Completion Rate", target: "≥ 95% of users complete a calculation without error within their first session" },
        { metric: "Time-on-Task", target: "Core calculation completed in ≤ 60 seconds on first use" },
        { metric: "Export Usage", target: "≥ 30% of active users export at least one result per month" },
        { metric: "Return Rate", target: "≥ 50% of registered users return within 7 days of first use" },
        { metric: "Bug Rate", target: "Zero calculation accuracy bugs in production; < 2 P1 bugs per release" },
      ]
    : [
        { metric: "Activation Rate", target: "≥ 60% of registered users complete the onboarding flow and perform their first core action" },
        { metric: "DAU / MAU Ratio", target: "≥ 0.3 (indicating strong daily engagement among monthly active users)" },
        { metric: "Net Promoter Score (NPS)", target: "≥ 40 within 60 days of launch" },
        { metric: "API Error Rate", target: "< 0.1% of API requests result in 5xx errors in production" },
        { metric: "Time to First Value", target: "New user achieves first meaningful outcome in ≤ 5 minutes from signup" },
      ];

  // ── Assumptions ──
  const assumptions = [
    "Users have access to a modern web browser and a stable internet connection",
    "The development team has access to all required infrastructure and third-party credentials before sprint 1",
    "Design mockups will be approved by stakeholders before development begins on each feature",
    "Backend API contracts will be agreed upon and documented before frontend development starts",
  ];

  // ── Build Markdown ──
  const md = buildMarkdown({
    product_name: name,
    version,
    created_at: now,
    executive_summary,
    problem_statement,
    goals,
    target_users,
    use_cases,
    user_stories,
    functional_requirements,
    non_functional_requirements,
    out_of_scope,
    success_metrics,
    assumptions,
    markdown: "",
  });

  return {
    product_name: name,
    version,
    created_at: now,
    executive_summary,
    problem_statement,
    goals,
    target_users,
    use_cases,
    user_stories,
    functional_requirements,
    non_functional_requirements,
    out_of_scope,
    success_metrics,
    assumptions,
    markdown: md,
  };
}

function buildMarkdown(d: PRDData): string {
  const lines: string[] = [];
  const fmt = (s: string) => s;

  lines.push(`# Product Requirements Document ${d.product_name}`);
  lines.push(`**Version:** ${d.version}  |  **Date:** ${new Date(d.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}  |  **Status:** Draft`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 1. Executive Summary");
  lines.push("");
  lines.push(fmt(d.executive_summary));
  lines.push("");

  lines.push("## 2. Problem Statement");
  lines.push("");
  lines.push(fmt(d.problem_statement));
  lines.push("");

  lines.push("## 3. Goals & Objectives");
  lines.push("");
  d.goals.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
  lines.push("");

  lines.push("## 4. Target Users");
  lines.push("");
  d.target_users.forEach((u) => {
    lines.push(`### ${u.role}`);
    lines.push(u.description);
    lines.push("");
  });

  lines.push("## 5. Use Cases");
  lines.push("");
  d.use_cases.forEach((uc, i) => {
    lines.push(`### UC-${String(i + 1).padStart(2, "0")} ${uc.title}`);
    lines.push("");
    lines.push(`| Field | Detail |`);
    lines.push(`|---|---|`);
    lines.push(`| **Actor** | ${uc.actor} |`);
    lines.push(`| **Description** | ${uc.description} |`);
    lines.push(`| **Preconditions** | ${uc.preconditions} |`);
    lines.push(`| **Postcondition** | ${uc.postcondition} |`);
    lines.push("");
    lines.push("**Main Flow:**");
    lines.push("");
    uc.steps.forEach((s, j) => lines.push(`${j + 1}. ${s}`));
    lines.push("");
  });

  lines.push("## 6. User Stories");
  lines.push("");
  d.user_stories.forEach((s, i) => {
    lines.push(`### US-${String(i + 1).padStart(2, "0")} · ${s.priority}`);
    lines.push("");
    lines.push(`> As a **${s.as_a}**, I want to **${s.i_want}**, so that **${s.so_that}**.`);
    lines.push("");
    lines.push("**Acceptance Criteria:**");
    lines.push("");
    s.acceptance_criteria.forEach((ac) => lines.push(`- [ ] ${ac}`));
    lines.push("");
  });

  lines.push("## 7. Functional Requirements");
  lines.push("");
  lines.push("| ID | Title | Description |");
  lines.push("|---|---|---|");
  d.functional_requirements.forEach((fr) => lines.push(`| **${fr.id}** | ${fr.title} | ${fr.description} |`));
  lines.push("");

  lines.push("## 8. Non-Functional Requirements");
  lines.push("");
  lines.push("| Category | Requirement |");
  lines.push("|---|---|");
  d.non_functional_requirements.forEach((nfr) => lines.push(`| **${nfr.category}** | ${nfr.requirement} |`));
  lines.push("");

  lines.push("## 9. Out of Scope");
  lines.push("");
  d.out_of_scope.forEach((s) => lines.push(`- ${s}`));
  lines.push("");

  lines.push("## 10. Success Metrics / KPIs");
  lines.push("");
  lines.push("| Metric | Target |");
  lines.push("|---|---|");
  d.success_metrics.forEach((m) => lines.push(`| ${m.metric} | ${m.target} |`));
  lines.push("");

  lines.push("## 11. Assumptions");
  lines.push("");
  d.assumptions.forEach((a) => lines.push(`- ${a}`));
  lines.push("");

  lines.push("---");
  lines.push(`*Generated by ${BRAND_NAME} PRD Generator on ${new Date(d.created_at).toLocaleString()}*`);

  return lines.join("\n");
}

// ── Section Blocks ─────────────────────────────────────────────────────────────

function SectionBlock({
  icon: Icon,
  number,
  title,
  color = "text-primary",
  children,
}: {
  icon: React.ElementType;
  number: string;
  title: string;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40 bg-muted/20">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          {number}
        </span>
        <Icon className={`h-4 w-4 ${color}`} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function UseCaseCard({ uc, index }: { uc: UseCase; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/50 bg-background/60">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
          UC-{String(index + 1).padStart(2, "0")}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{uc.title}</p>
          <p className="text-xs text-muted-foreground">Actor: {uc.actor}</p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/30 px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">{uc.description}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Preconditions</p>
              <p className="text-xs text-foreground/80">{uc.preconditions}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Postcondition</p>
              <p className="text-xs text-foreground/80">{uc.postcondition}</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Main Flow</p>
            <ol className="space-y-1.5">
              {uc.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/90">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

const priorityColor: Record<string, string> = {
  "Must Have": "bg-red-500/15 text-red-500 border-red-200",
  "Should Have": "bg-amber-500/15 text-amber-500 border-amber-200",
  "Nice to Have": "bg-blue-500/15 text-blue-500 border-sky-200",
};

function UserStoryCard({ story, index }: { story: UserStory; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/50 bg-background/60">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
          US-{String(index + 1).padStart(2, "0")}
        </Badge>
        <p className="flex-1 min-w-0 text-sm text-left leading-snug">
          <span className="text-muted-foreground">As a </span>
          <span className="font-medium">{story.as_a}</span>
          <span className="text-muted-foreground">, I want to </span>
          <span className="font-medium">{story.i_want}</span>
        </p>
        <Badge
          variant="outline"
          className={`text-[9px] shrink-0 ${priorityColor[story.priority] ?? ""}`}
        >
          {story.priority}
        </Badge>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border/30 px-4 pb-4 pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/70">So that:</span> {story.so_that}
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Acceptance Criteria
          </p>
          <ul className="space-y-1">
            {story.acceptance_criteria.map((ac, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground/90">
                <CheckCircle2 className="h-3 w-3 text-positive mt-0.5 shrink-0" />
                {ac}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── PRD Viewer ────────────────────────────────────────────────────────────────

function PRDViewer({ prd }: { prd: PRDData }) {
  return (
    <div className="space-y-4">
      <SectionBlock icon={FileText} number="1" title="Executive Summary">
        <p className="text-sm text-foreground/90 leading-relaxed">{prd.executive_summary}</p>
      </SectionBlock>

      <SectionBlock icon={Target} number="2" title="Problem Statement" color="text-[var(--color-warning)]">
        <p className="text-sm text-foreground/90 leading-relaxed">{prd.problem_statement}</p>
      </SectionBlock>

      <SectionBlock icon={BarChart3} number="3" title="Goals & Objectives" color="text-positive">
        <ol className="space-y-2">
          {prd.goals.map((g, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive/100/15 text-[10px] font-bold text-positive mt-0.5">
                {i + 1}
              </span>
              {g}
            </li>
          ))}
        </ol>
      </SectionBlock>

      <SectionBlock icon={Users} number="4" title="Target Users" color="text-blue-500">
        <div className="space-y-3">
          {prd.target_users.map((u, i) => (
            <div key={i} className="flex items-start gap-3">
              <Badge variant="secondary" className="text-xs shrink-0 mt-0.5">
                {u.role}
              </Badge>
              <p className="text-sm text-foreground/80">{u.description}</p>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={BookOpen} number="5" title="Use Cases" color="text-violet-500">
        <div className="space-y-2">
          {prd.use_cases.map((uc, i) => (
            <UseCaseCard key={i} uc={uc} index={i} />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={List} number="6" title="User Stories" color="text-pink-500">
        <div className="space-y-2">
          {prd.user_stories.map((s, i) => (
            <UserStoryCard key={i} story={s} index={i} />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={ClipboardList} number="7" title="Functional Requirements" color="text-cyan-500">
        <div className="space-y-2">
          {prd.functional_requirements.map((fr) => (
            <div key={fr.id} className="flex items-start gap-3 rounded-lg border border-border/40 px-4 py-3 bg-muted/20">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5">
                {fr.id}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium">{fr.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{fr.description}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={ClipboardList} number="8" title="Non-Functional Requirements" color="text-amber-500">
        <div className="space-y-2">
          {prd.non_functional_requirements.map((nfr, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-border/40 px-4 py-3 bg-muted/20">
              <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5 border-amber-500/40 text-amber-500">
                {nfr.category}
              </Badge>
              <p className="text-xs text-foreground/90">{nfr.requirement}</p>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={XCircle} number="9" title="Out of Scope" color="text-rose-400">
        <ul className="space-y-1.5">
          {prd.out_of_scope.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
              <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
              {s}
            </li>
          ))}
        </ul>
      </SectionBlock>

      <SectionBlock icon={BarChart3} number="10" title="Success Metrics / KPIs" color="text-positive">
        <div className="space-y-2">
          {prd.success_metrics.map((m, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-border/40 px-4 py-2.5 bg-muted/20">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{m.metric}</span>
                <span className="text-muted-foreground mx-2 text-sm">—</span>
                <span className="text-sm text-foreground/80">{m.target}</span>
              </div>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={FileText} number="11" title="Assumptions" color="text-muted-foreground">
        <ul className="space-y-1.5">
          {prd.assumptions.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
              <span className="text-primary mt-0.5">•</span>
              {a}
            </li>
          ))}
        </ul>
      </SectionBlock>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "input" | "view" | "edit";

export default function PRDGenerator() {
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [prd, setPrd] = useState<PRDData | null>(null);
  const [tab, setTab] = useState<Tab>("input");
  const [viewMode, setViewMode] = useState<"notepad" | "designed">("notepad");
  const [editMarkdown, setEditMarkdown] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!productName.trim() || !description.trim()) {
      toast.error("Please enter both a product name and description.");
      return;
    }
    setGenerating(true);
    try {
      const resp = await apiClient.post<PRDData>("/prd/generate", {
        product_name: productName.trim(),
        description: description.trim(),
      });
      const result = resp.data;
      setPrd(result);
      setEditMarkdown(result.markdown);
      setTab("view");
      toast.success("PRD generated successfully");
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to generate PRD"
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    const content = tab === "edit" ? editMarkdown : prd?.markdown ?? "";
    const filename = `${(prd?.product_name ?? "prd").toLowerCase().replace(/\s+/g, "-")}-prd.md`;
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Downloaded ${filename}`);
  };

  const steps = [
    { id: "input" as Tab, label: "Input", icon: FileText },
    { id: "view" as Tab, label: "PRD View", icon: Eye },
    { id: "edit" as Tab, label: "Edit", icon: Pencil },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ClipboardList className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">PRD Generator</h1>
            <p className="text-xs text-muted-foreground">
              Enter product details → AI generates a complete structured PRD
            </p>
          </div>
        </div>
        {prd && (
          <Button variant="outline" size="sm" className="gap-2 h-8" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            Download .md
          </Button>
        )}
      </div>

      {/* Step bar */}
      <div className="flex items-center gap-0 border-b border-border bg-muted/20 px-6 py-2">
        {steps.map((step, i) => (
          <React.Fragment key={step.id}>
            <button
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === step.id
                  ? "bg-background text-foreground font-medium shadow-sm border border-border"
                  : prd || step.id === "input"
                  ? "text-primary hover:bg-background/50"
                  : "text-muted-foreground cursor-not-allowed opacity-50"
              }`}
              onClick={() => {
                if (step.id === "input" || prd) setTab(step.id);
              }}
              disabled={step.id !== "input" && !prd}
            >
              {prd && step.id !== "input" && step.id !== tab ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-positive" />
              ) : (
                <step.icon className="h-3.5 w-3.5" />
              )}
              {step.label}
            </button>
            {i < steps.length - 1 && <div className="mx-1 h-px w-6 bg-border" />}
          </React.Fragment>
        ))}

        {tab === "edit" && prd && (
          <div className="ml-auto">
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                if (prd) setPrd({ ...prd, markdown: editMarkdown });
                setTab("view");
                toast.success("Changes saved");
              }}
            >
              Save &amp; View
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Input ── */}
        {tab === "input" && (
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-xl px-6 py-10 space-y-6">
              <div className="text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                  <ClipboardList className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-xl font-bold">What are you building?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Provide your product name and a description the AI will generate a full PRD with use cases, user stories, functional requirements, and success metrics.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Product Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Secure Web Gallery, Finance Calculator, Task Manager"
                    className="bg-muted/30 border-border/60 text-sm h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Product Description <span className="text-destructive">*</span>
                  </label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what the product does, the problem it solves, who it's for, and any key features or constraints. The more detail you provide, the more tailored the PRD will be."
                    className="min-h-[180px] bg-muted/30 border-border/60 text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Tip: mention your target audience, core workflows, and any compliance or technical requirements.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground gap-1.5"
                  onClick={() => {
                    setProductName("Finance Calculator");
                    setDescription(
                      "A web application that helps individuals and business professionals perform accurate financial calculations including loan EMI, compound interest, tax estimation, and currency conversion. Users should be able to save and compare calculation results, export reports as PDF, and share results via link. The app must be mobile-first and work offline for basic calculations."
                    );
                  }}
                >
                  <BookOpen className="h-3 w-3" /> Load Sample
                </Button>

                <Button
                  onClick={handleGenerate}
                  disabled={generating || !productName.trim() || !description.trim()}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 gap-2 font-display"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating PRD…
                    </>
                  ) : (
                    <>
                      <AiIcon className="h-4 w-4" />
                      Generate PRD
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>

              {generating && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3 animate-pulse-glow">
                    <AiIcon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-sm font-medium">Crafting your PRD…</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Building use cases, user stories, functional requirements, and success metrics
                  </p>
                  <div className="mt-4 h-1 bg-muted rounded-full overflow-hidden max-w-xs mx-auto">
                    <div className="h-full w-4/5 animate-pulse rounded-full bg-primary" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── PRD View ── */}
        {tab === "view" && prd && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-muted/20">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-mono">
                  {prd.product_name.toLowerCase().replace(/\s+/g, "-")}-prd.md
                </span>
                <Badge variant="outline" className="text-[9px] ml-auto">
                  {viewMode === "notepad" ? "Notepad" : "Designed"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => setViewMode((m) => (m === "notepad" ? "designed" : "notepad"))}
                >
                  {viewMode === "notepad" ? "Switch to Designed" : "Switch to Notepad"}
                </Button>
                <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-[11px]" onClick={() => setTab("edit")}>
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              </div>

              {viewMode === "notepad" ? (
                <ScrollArea className="flex-1">
                  <div className="mx-auto max-w-3xl px-8 py-8">
                    <article className="prose prose-sm max-w-none dark:prose-invert
                      prose-headings:font-semibold prose-headings:text-foreground prose-headings:scroll-mt-20
                      prose-h1:text-xl prose-h1:font-bold prose-h1:border-b prose-h1:border-border prose-h1:pb-3 prose-h1:mb-6
                      prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3
                      prose-h3:text-sm prose-h3:mt-5 prose-h3:mb-2
                      prose-p:text-foreground/85 prose-p:leading-relaxed prose-p:my-2
                      prose-li:text-foreground/85 prose-li:my-0.5
                      prose-strong:text-foreground prose-strong:font-semibold
                      prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:not-italic
                      prose-code:text-primary prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
                      prose-table:text-xs prose-table:w-full
                      prose-thead:border-border prose-th:border prose-th:border-border prose-th:bg-muted/40 prose-th:px-3 prose-th:py-2 prose-th:font-semibold prose-th:text-foreground
                      prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-foreground/85
                      prose-tr:border-border even:prose-tr:bg-muted/10
                      prose-hr:border-border prose-hr:my-6
                      prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {prd.markdown}
                      </ReactMarkdown>
                    </article>
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
                    {/* Title card */}
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-6 py-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[10px] text-primary font-semibold uppercase tracking-widest mb-1">
                            Product Requirements Document
                          </p>
                          <h2 className="text-2xl font-bold text-foreground">{prd.product_name}</h2>
                          <div className="flex items-center gap-3 mt-2">
                            <Badge variant="outline" className="text-[10px]">v{prd.version}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(prd.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <PRDViewer prd={prd} />
                  </div>
                </ScrollArea>
              )}
            </div>
        )}

        {/* ── Edit ── */}
        {tab === "edit" && prd && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-muted/20">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-mono">
                {prd.product_name.toLowerCase().replace(/\s+/g, "-")}-prd.md
              </span>
              <Badge variant="outline" className="text-[9px] ml-auto">Markdown</Badge>
            </div>
            <Textarea
              value={editMarkdown}
              onChange={(e) => setEditMarkdown(e.target.value)}
              className="flex-1 rounded-none border-0 resize-none font-mono text-xs bg-muted/10 focus-visible:ring-0 focus-visible:ring-offset-0 p-4 leading-relaxed"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
