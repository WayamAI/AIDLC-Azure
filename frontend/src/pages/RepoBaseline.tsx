import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Github,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Code2,
  Shield,
  Globe,
  Layout,
  Navigation,
  MousePointer,
  Database,
  Layers,
  AlertTriangle,
  Gauge,
  Accessibility,
  Search,
  Copy,
  Check,
  Clock,
  History,
  ArrowRight,
  Plus,
  Filter,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  baselineApi,
  BaselineTest,
  BaselineTestStep,
  BaselineScanSession,
  BaselineRepoData,
  BaselineTestCategory,
} from "@/lib/api";
import { AiIcon } from "@/lib/icons";

// ── Category Display Config ───────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; colour: string; bg: string; border: string }
> = {
  auth: {
    label: "Auth",
    icon: Shield,
    colour: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10 dark:bg-violet-500/15",
    border: "border-violet-500/20 dark:border-violet-500/30",
  },
  api: {
    label: "API",
    icon: Globe,
    colour: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10 dark:bg-cyan-500/15",
    border: "border-cyan-500/20 dark:border-cyan-500/30",
  },
  ui_form: {
    label: "UI Form",
    icon: MousePointer,
    colour: "text-blue-600 dark:text-sky-700",
    bg: "bg-sky-50 dark:bg-blue-500/15",
    border: "border-blue-500/20 dark:border-sky-200",
  },
  ui_navigation: {
    label: "Navigation",
    icon: Navigation,
    colour: "text-sky-600 dark:text-sky-700",
    bg: "bg-sky-500/10 dark:bg-sky-500/15",
    border: "border-sky-500/20 dark:border-sky-500/30",
  },
  ui_component: {
    label: "UI Component",
    icon: Layout,
    colour: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/10 dark:bg-indigo-500/15",
    border: "border-indigo-500/20 dark:border-indigo-500/30",
  },
  crud: {
    label: "CRUD",
    icon: Database,
    colour: "text-amber-600 dark:text-amber-700",
    bg: "bg-amber-50 dark:bg-amber-500/15",
    border: "border-amber-500/20 dark:border-amber-200",
  },
  integration: {
    label: "Integration",
    icon: Layers,
    colour: "text-[var(--color-warning)]",
    bg: "bg-[var(--color-warning-bg)]",
    border: "border-[var(--color-status-warning)]/30",
  },
  edge_case: {
    label: "Edge Case",
    icon: AlertTriangle,
    colour: "text-red-600 dark:text-red-700",
    bg: "bg-red-50 dark:bg-red-500/15",
    border: "border-red-500/20 dark:border-red-200",
  },
  performance: {
    label: "Performance",
    icon: Gauge,
    colour: "text-positive dark:text-positive",
    bg: "bg-positive/10 dark:bg-primary/15",
    border: "border-primary/30/20 dark:border-positive/25",
  },
  accessibility: {
    label: "Accessibility",
    icon: Accessibility,
    colour: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/10 dark:bg-pink-500/15",
    border: "border-pink-500/20 dark:border-pink-500/30",
  },
};

const SEVERITY_CONFIG: Record<string, { colour: string; bg: string; border: string }> = {
  critical: { colour: "text-red-600 dark:text-red-700", bg: "bg-red-50 dark:bg-red-500/15", border: "border-red-500/20 dark:border-red-200" },
  high: { colour: "text-[var(--color-warning)]", bg: "bg-[var(--color-warning-bg)]", border: "border-[var(--color-status-warning)]/30" },
  medium: { colour: "text-amber-600 dark:text-amber-700", bg: "bg-amber-50 dark:bg-amber-500/15", border: "border-amber-500/20 dark:border-amber-200" },
  low: { colour: "text-blue-600 dark:text-sky-700", bg: "bg-sky-50 dark:bg-blue-500/15", border: "border-blue-500/20 dark:border-sky-200" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getCategoryBreakdown(
  tests: BaselineTest[],
  ids?: Set<string>
): { category: string; count: number }[] {
  const filtered = ids ? tests.filter((t) => ids.has(t.test_id)) : tests;
  const map: Record<string, number> = {};
  for (const t of filtered) {
    map[t.category] = (map[t.category] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

// ── Export Helpers ────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "repo";
}

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stepToString(s: BaselineTestStep): string {
  let str = `${s.action} ${s.target}`.trim();
  if (s.value) str += ` → "${s.value}"`;
  if (s.assertion) str += ` [assert: ${s.assertion}]`;
  return str;
}

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportJson(repo: BaselineRepoData, tests: BaselineTest[]): string {
  return JSON.stringify(
    {
      github_url: repo.github_url,
      repo_id: repo.repo_id,
      exported_at: new Date().toISOString(),
      total_tests: tests.length,
      tests,
    },
    null,
    2
  );
}

function exportCsv(tests: BaselineTest[]): string {
  const headers = [
    "test_id",
    "name",
    "description",
    "category",
    "severity",
    "page_path",
    "component_name",
    "endpoint",
    "source_file",
    "steps",
  ];
  const rows = tests.map((t) =>
    [
      t.test_id,
      t.name,
      t.description,
      t.category,
      t.severity,
      t.page_path ?? "",
      t.component_name ?? "",
      t.endpoint ?? "",
      t.source_file ?? "",
      t.steps.map((s, i) => `${i + 1}. ${stepToString(s)}`).join(" | "),
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\r\n");
}

function exportMarkdown(repo: BaselineRepoData, tests: BaselineTest[]): string {
  const lines: string[] = [];
  lines.push(`# Test Baseline ${repo.github_url.replace("https://github.com/", "")}`);
  lines.push("");
  lines.push(`- Repository: ${repo.github_url}`);
  lines.push(`- Total tests: ${tests.length}`);
  lines.push(`- Exported: ${new Date().toISOString()}`);
  lines.push("");

  tests.forEach((t, idx) => {
    const target = t.page_path || t.component_name || t.endpoint || "—";
    lines.push(`## ${idx + 1}. ${t.name}`);
    lines.push("");
    lines.push(`- **Category:** ${t.category}`);
    lines.push(`- **Severity:** ${t.severity}`);
    lines.push(`- **Target:** \`${target}\``);
    if (t.source_file) lines.push(`- **Source file:** \`${t.source_file}\``);
    lines.push("");
    lines.push(t.description);
    lines.push("");
    if (t.steps.length) {
      lines.push("**Steps:**");
      lines.push("");
      t.steps.forEach((s, i) => lines.push(`${i + 1}. ${stepToString(s)}`));
      lines.push("");
    }
    if (t.playwright_code) {
      lines.push("**Playwright code:**");
      lines.push("");
      lines.push("```ts");
      lines.push(t.playwright_code);
      lines.push("```");
      lines.push("");
    }
  });

  return lines.join("\n");
}

// ── CodeViewer ────────────────────────────────────────────────────────────────

function CodeViewer({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative mt-3 rounded-xl border border-border/50 bg-muted/20 dark:bg-zinc-950/90 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-muted/40 dark:bg-white/5 backdrop-blur-sm">
        <span className="text-[10px] font-bold font-mono text-muted-foreground/80 dark:text-zinc-400 tracking-tight">playwright.ts</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5"
        >
          {copied ? (
            <><Check className="h-3 w-3 text-positive" /> Copied</>
          ) : (
            <><Copy className="h-3 w-3" /> Copy</>
          )}
        </button>
      </div>
      <pre className="text-[11px] font-mono text-foreground/90 dark:text-zinc-100 p-5 overflow-x-auto leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap selection:bg-primary/30">
        {code || "// No Playwright code generated"}
      </pre>
    </div>
  );
}

// ── TestCard ──────────────────────────────────────────────────────────────────

function TestCard({
  test,
  isNew,
}: {
  test: BaselineTest;
  isNew: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const catCfg = CATEGORY_CONFIG[test.category] || CATEGORY_CONFIG.ui_component;
  const sevCfg = SEVERITY_CONFIG[test.severity] || SEVERITY_CONFIG.medium;
  const CatIcon = catCfg.icon;
  const groupLabel = test.page_path || test.component_name || test.endpoint || "—";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border overflow-hidden transition-all duration-200 ${
        isNew
          ? "border-primary/30/40 bg-positive/10 dark:border-primary/30/50 dark:bg-[var(--color-warning-bg)]/20 shadow-sm shadow-primary/10"
          : "border-border/40 bg-card/50"
      }`}
    >
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={`mt-0.5 flex-shrink-0 h-7 w-7 rounded-lg flex items-center justify-center ${catCfg.bg} border ${catCfg.border}`}>
          <CatIcon className={`h-3.5 w-3.5 ${catCfg.colour}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {isNew && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-positive/100 text-white tracking-widest uppercase">
                NEW
              </span>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] h-4 px-1.5 ${sevCfg.bg} ${sevCfg.colour} ${sevCfg.border}`}
            >
              {test.severity}
            </Badge>
            <code className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${catCfg.bg} ${catCfg.colour}`}>
              {groupLabel}
            </code>
          </div>
          <p className="text-sm font-medium text-foreground/90 leading-snug">{test.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{test.description}</p>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground flex-shrink-0 mt-0.5">
          <span className="text-[11px]">{test.steps.length} steps</span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Steps */}
              <div className="space-y-1">
                {test.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-6 text-center font-mono text-[9px] text-muted-foreground/60">
                      {i + 1}
                    </span>
                    <span className="font-mono text-[10px] text-blue-600 dark:text-primary/80 w-16 flex-shrink-0 font-bold">
                      {step.action}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5 text-border flex-shrink-0" />
                    <span className="text-muted-foreground truncate">
                      {step.target}
                      {step.value ? ` → "${step.value}"` : ""}
                    </span>
                    {step.assertion && (
                      <span className="text-positive/70 text-[10px] ml-auto flex-shrink-0">
                        ✓ {step.assertion}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Playwright code toggle */}
              {test.playwright_code && (
                <div>
                  <button
                    onClick={() => setShowCode((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    {showCode ? "Hide" : "Show"} Playwright code
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${showCode ? "rotate-180" : ""}`}
                    />
                  </button>
                  <AnimatePresence>
                    {showCode && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <CodeViewer code={test.playwright_code} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── NewTestsBanner ────────────────────────────────────────────────────────────

function NewTestsBanner({
  session,
  tests,
  newTestIds,
}: {
  session: BaselineScanSession;
  tests: BaselineTest[];
  newTestIds: Set<string>;
}) {
  if (!session || session.tests_added === 0) return null;

  const breakdown = getCategoryBreakdown(tests, newTestIds);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-primary/30/20 bg-positive/10 dark:border-primary/30/30 dark:bg-[var(--color-warning-bg)]/30 p-4 mb-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-positive/100 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          +{session.tests_added}
        </div>
        <div>
          <p className="font-semibold text-positive dark:text-positive">
            {session.tests_added} new test{session.tests_added !== 1 ? "s" : ""} added
          </p>
          <p className="text-xs text-positive dark:text-positive/80">
            {session.scan_type === "full"
              ? "Full baseline scan"
              : `Changes in ${session.changed_files.length} file(s)`}
            {" · "}
            {formatRelative(session.triggered_at)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {breakdown.map(({ category, count }) => {
          const cfg = CATEGORY_CONFIG[category];
          return (
            <span
              key={category}
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                         ${cfg?.bg || "bg-muted/30"} ${cfg?.colour || "text-foreground/70"}`}
            >
              {cfg?.label || category}: +{count}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── ScanProgressView ──────────────────────────────────────────────────────────

function ScanProgressView({
  sessionId,
  repoId,
  scanType,
  onDone,
}: {
  sessionId: string;
  repoId: string;
  scanType: "full" | "incremental";
  onDone: (repoId: string, sessionId: string) => void;
}) {
  const [status, setStatus] = useState("queued");
  const [message, setMessage] = useState(
    scanType === "full" ? "Initialising full scan…" : "Initialising incremental scan…"
  );
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(async () => {
      try {
        const st = await baselineApi.getStatus(sessionId);
        setStatus(st.status);
        setMessage(st.progress_message || message);
        if (st.error) setError(st.error);
        if (st.status === "done" || st.status === "failed") {
          if (timerRef.current) clearInterval(timerRef.current);
          if (st.status === "done") {
            setTimeout(() => onDone(repoId, sessionId), 600);
          }
        }
      } catch {
        /* network hiccup keep polling */
      }
    }, 3000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const STEPS = [
    "Cloning repository…",
    "Extracting source files…",
    "Generating baseline tests…",
    "Persisting tests…",
  ];

  const currentStep = STEPS.findIndex((s) => message.toLowerCase().includes(s.split("…")[0].toLowerCase()));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-lg mx-auto mt-20 space-y-6"
    >
      <div className="text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mb-4">
          {status === "failed" ? (
            <AlertTriangle className="h-8 w-8 text-red-700" />
          ) : status === "done" ? (
            <CheckCircle2 className="h-8 w-8 text-positive" />
          ) : (
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
          )}
        </div>
        <h2 className="text-xl font-semibold">
          {scanType === "full" ? "Full Baseline Scan" : "Incremental Scan"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
      </div>

      {/* Step indicators */}
      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const done = currentStep > i || status === "done";
          const active = currentStep === i && status === "running";
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-all ${
                done
                  ? "border-primary/30/20 bg-positive/10"
                  : active
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/30 bg-muted/10 opacity-40"
              }`}
            >
              <div
                className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                  done ? "bg-primary/20" : active ? "bg-primary/20" : "bg-muted/20"
                }`}
              >
                {done ? (
                  <Check className="h-3 w-3 text-positive" />
                ) : active ? (
                  <Loader2 className="h-3 w-3 text-primary animate-spin" />
                ) : (
                  <span className="text-[9px] text-muted-foreground">{i + 1}</span>
                )}
              </div>
              <span className={`text-xs ${done ? "text-positive" : active ? "text-foreground" : "text-muted-foreground"}`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-50 p-3 text-xs text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RepoBaseline() {
  const [githubUrl, setGithubUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Active scan tracking
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    repoId: string;
    scanType: "full" | "incremental";
  } | null>(null);

  // Loaded repo data
  const [repoData, setRepoData] = useState<BaselineRepoData | null>(null);
  const [viewSessionId, setViewSessionId] = useState<string | null>(null);

  // UI state
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  // ── derived data ───────────────────────────────────────────────────────────

  const newTestIds = useMemo(
    () => new Set(repoData?.new_test_ids ?? []),
    [repoData]
  );

  const viewSession = useMemo(
    () => repoData?.sessions.find((s) => s.session_id === viewSessionId),
    [repoData, viewSessionId]
  );

  // All unique categories present in the data
  const categories = useMemo(() => {
    if (!repoData) return [];
    const seen = new Set<string>();
    for (const t of repoData.tests) seen.add(t.category);
    return Array.from(seen).sort();
  }, [repoData]);

  // Filtered + searched tests for the active tab
  const displayedTests = useMemo(() => {
    if (!repoData) return [];
    let tests = repoData.tests.filter((t) => t.is_active);

    if (activeCategory !== "all") {
      tests = tests.filter((t) => t.category === activeCategory);
    }
    if (severityFilter !== "all") {
      tests = tests.filter((t) => t.severity === severityFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      tests = tests.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          (t.page_path?.toLowerCase() || "").includes(q)
      );
    }

    // NEW tests first
    tests.sort((a, b) => {
      const aNew = newTestIds.has(a.test_id) ? 0 : 1;
      const bNew = newTestIds.has(b.test_id) ? 0 : 1;
      return aNew - bNew;
    });

    return tests;
  }, [repoData, activeCategory, severityFilter, searchQuery, newTestIds]);

  // ── handlers ───────────────────────────────────────────────────────────────

  const handleScan = async () => {
    if (!githubUrl.trim()) return;
    setScanError(null);
    setScanning(true);
    try {
      const resp = await baselineApi.scan(
        githubUrl.trim(),
        githubToken.trim() || undefined
      );
      setActiveSession({
        sessionId: resp.session_id,
        repoId: resp.repo_id,
        scanType: resp.scan_type,
      });
      setRepoData(null);
    } catch (err: any) {
      setScanError(err?.response?.data?.detail || "Scan failed. Check the GitHub URL.");
    } finally {
      setScanning(false);
    }
  };

  const handleScanDone = async (repoId: string, sessionId: string) => {
    setActiveSession(null);
    try {
      const data = await baselineApi.getRepoTests(repoId, sessionId);
      setRepoData(data);
      setViewSessionId(sessionId);
      setActiveCategory("all");
    } catch (err: any) {
      setScanError(err?.response?.data?.detail || "Failed to load results.");
    }
  };

  const handleDownload = (format: "json" | "csv" | "md") => {
    if (!repoData) return;
    const tests = repoData.tests.filter((t) => t.is_active);
    const base = `test-baseline-${slugify(repoData.github_url)}`;
    if (format === "json") {
      triggerDownload(`${base}.json`, exportJson(repoData, tests), "application/json");
    } else if (format === "csv") {
      triggerDownload(`${base}.csv`, exportCsv(tests), "text/csv");
    } else {
      triggerDownload(`${base}.md`, exportMarkdown(repoData, tests), "text/markdown");
    }
  };

  const handleRescan = () => {
    setRepoData(null);
    setActiveSession(null);
    setScanError(null);
    setSearchQuery("");
    setActiveCategory("all");
    setSeverityFilter("all");
  };

  // ── Active scan view ───────────────────────────────────────────────────────

  if (activeSession) {
    return (
      <div className="h-full overflow-y-auto p-8">
        <ScanProgressView
          sessionId={activeSession.sessionId}
          repoId={activeSession.repoId}
          scanType={activeSession.scanType}
          onDone={handleScanDone}
        />
      </div>
    );
  }

  // ── Results view ───────────────────────────────────────────────────────────

  if (repoData) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <Github className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <a
                  href={repoData.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground truncate transition-colors"
                >
                  {repoData.github_url.replace("https://github.com/", "")}
                </a>
              </div>
              <h1 className="text-2xl font-bold">
                Test Baseline
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  {repoData.total_tests} tests
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Session selector */}
              {repoData.sessions.length > 1 && (
                <select
                  value={viewSessionId || ""}
                  onChange={async (e) => {
                    const sid = e.target.value;
                    setViewSessionId(sid);
                    if (sid) {
                      const data = await baselineApi.getRepoTests(repoData.repo_id, sid);
                      setRepoData(data);
                    }
                  }}
                  className="text-xs rounded-lg border border-border/50 bg-background px-3 py-1.5 text-foreground cursor-pointer max-w-[220px]"
                >
                  {repoData.sessions.map((s, i) => (
                    <option key={s.session_id} value={s.session_id}>
                      Run #{repoData.sessions.length - i} {s.scan_type} · +{s.tests_added} tests
                    </option>
                  ))}
                </select>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    disabled={repoData.tests.filter((t) => t.is_active).length === 0}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">
                    Export {repoData.tests.filter((t) => t.is_active).length} tests
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleDownload("json")} className="text-xs gap-2">
                    <Code2 className="h-3.5 w-3.5" /> JSON (.json)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("csv")} className="text-xs gap-2">
                    <Database className="h-3.5 w-3.5" /> CSV (.csv)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("md")} className="text-xs gap-2">
                    <Layout className="h-3.5 w-3.5" /> Markdown (.md)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRescan}
                className="h-8 text-xs gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                New Scan
              </Button>
            </div>
          </div>

          {/* New tests banner */}
          {viewSession && viewSession.tests_added > 0 && (
            <NewTestsBanner
              session={viewSession}
              tests={repoData.tests}
              newTestIds={newTestIds}
            />
          )}

          {/* Session history strip */}
          <div className="flex gap-2 flex-wrap">
            {repoData.sessions.map((s, i) => (
              <button
                key={s.session_id}
                onClick={async () => {
                  setViewSessionId(s.session_id);
                  const data = await baselineApi.getRepoTests(repoData.repo_id, s.session_id);
                  setRepoData(data);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  viewSessionId === s.session_id
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/40 text-muted-foreground hover:border-border/80"
                }`}
              >
                <History className="h-3 w-3" />
                Run #{repoData.sessions.length - i}
                {s.tests_added > 0 && (
                  <span className="text-[9px] px-1 rounded-full bg-positive/100/10 text-positive dark:bg-positive/100/20 dark:text-positive">
                    +{s.tests_added}
                  </span>
                )}
                <span className="text-[9px] text-muted-foreground/60">
                  {formatRelative(s.triggered_at)}
                </span>
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-48 max-w-72">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tests…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            {/* Severity filter */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="text-xs rounded-lg border border-border/50 bg-background px-2.5 py-1 text-muted-foreground h-8"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* NEW only toggle */}
            {newTestIds.size > 0 && (
              <button
                onClick={() =>
                  setSearchQuery((q) =>
                    q === "__new__" ? "" : "__new__"
                  )
                }
                className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs transition-all ${
                  searchQuery === "__new__"
                    ? "border-primary/30/30 bg-positive/100/10 text-positive dark:border-primary/30/50 dark:bg-positive/100/15 dark:text-positive"
                    : "border-border/40 text-muted-foreground"
                }`}
              >
                <AiIcon className="h-3 w-3" />
                New only ({newTestIds.size})
              </button>
            )}
          </div>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`h-7 px-3 rounded-lg text-xs font-medium transition-all ${
                activeCategory === "all"
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50"
              }`}
            >
              All ({repoData.tests.filter((t) => t.is_active).length})
            </button>
            {categories.map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              const CatIcon = cfg?.icon || Filter;
              const count = repoData.tests.filter(
                (t) => t.is_active && t.category === cat
              ).length;
              const newCount = repoData.tests.filter(
                (t) => t.is_active && t.category === cat && newTestIds.has(t.test_id)
              ).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`h-7 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                    activeCategory === cat
                      ? `${cfg?.bg} ${cfg?.colour} border ${cfg?.border}`
                      : "bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50"
                  }`}
                >
                  <CatIcon className="h-3 w-3" />
                  {cfg?.label || cat} ({count})
                  {newCount > 0 && (
                    <span className="text-[9px] px-1 rounded-full bg-positive/100/10 text-positive dark:bg-positive/100/20 dark:text-positive">
                      +{newCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Test grid */}
          <div className="space-y-2 pb-8">
            {displayedTests.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                No tests match your filters.
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {displayedTests.length} test{displayedTests.length !== 1 ? "s" : ""}
                  {newTestIds.size > 0 && activeCategory === "all" && (
                    <span className="ml-2 text-positive dark:text-positive">
                      · {newTestIds.size} new in this session
                    </span>
                  )}
                </p>
                {displayedTests
                  .filter((t) =>
                    searchQuery === "__new__" ? newTestIds.has(t.test_id) : true
                  )
                  .map((test) => (
                    <TestCard
                      key={test.test_id}
                      test={test}
                      isNew={newTestIds.has(test.test_id)}
                    />
                  ))}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Input form ─────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl space-y-6"
      >
        {/* Hero */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mb-2">
            <AiIcon className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Repo Test Baseline</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
            Submit any GitHub repo URL. The AI analyses the full codebase and generates
            categorised Playwright tests. Re-submit to automatically detect changes and
            append only new tests.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border/50 bg-card/50 p-6 space-y-4 shadow-sm">
          {scanError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-500/20 p-3">
              <AlertTriangle className="h-4 w-4 text-red-700 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">{scanError}</p>
            </div>
          )}

          {/* GitHub URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Github className="h-3.5 w-3.5" />
              GitHub Repository URL
            </label>
            <Input
              id="baseline-github-url"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              disabled={scanning}
              className="h-11"
            />
          </div>

          {/* GitHub Token (optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              GitHub Token{" "}
              <span className="text-muted-foreground/50">(optional for private repos)</span>
            </label>
            <Input
              id="baseline-github-token"
              type="password"
              placeholder="ghp_…"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              disabled={scanning}
              className="h-11"
            />
          </div>

          <Button
            id="baseline-scan-btn"
            className="w-full h-11 gap-2 font-medium"
            onClick={handleScan}
            disabled={scanning || !githubUrl.trim()}
          >
            {scanning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Starting scan…</>
            ) : (
              <><AiIcon className="h-4 w-4" /> Generate Test Baseline</>
            )}
          </Button>
        </div>

        {/* Feature hints */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: AiIcon, title: "AI-categorised", desc: "auth, api, ui, crud, and more" },
            { icon: RefreshCw, title: "Incremental", desc: "Re-scan only appends new tests" },
            { icon: History, title: "Session history", desc: "Track every change over time" },
            { icon: Code2, title: "Playwright code", desc: "Runnable TypeScript per test" },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-2.5 p-3 rounded-xl border border-border/30 bg-muted/10"
            >
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-medium">{title}</p>
                <p className="text-[11px] text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
