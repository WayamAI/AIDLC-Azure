import { useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Github,
  Globe,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Camera,
  RotateCcw,
  Layers,
  Workflow,
  Code2,
  AlertTriangle,
  ArrowRight,
  Clock,
  Pencil,
  Save,
  X,
  Plus,
  Trash2,
  GripVertical,
  ListChecks,
  Shield,
  Navigation,
  MousePointer,
  Zap,
  Bug,
  GitCommit,
  GitBranch,
  Eye,
  Terminal,
  ExternalLink,
  Hash,
  Download,
  Upload,
  FileCode,
  FlaskConical,
  Search,
  Check,
  Filter,
  Info,
  MonitorPlay,
} from "lucide-react";
import { AiIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { UnifiedTestIntelligence } from "@/components/pipeline/UnifiedTestIntelligence";
import { useLiveTesting, useFetchCommits, useRunHistory, LiveTestingPhase } from "../hooks/use-live-testing";
import { usePipelineContext } from "@/context/PipelineContext";
import { api, baselineApi, PlaywrightTestCase, TestStep, LiveTestResult, StepResult, CommitInfo, RunSummaryItem, RepoAnalysisResult, BaselineTest, WorkspacePlaywrightTest } from "../lib/api";
import { downloadLiveTestReport, downloadRunSummaryReport } from "../lib/pdf-report";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";

// ── Severity badge colours ────────────────────────────────────────────────────

const severityClass: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-700 border-red-200",
  High: "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-[var(--color-status-warning)]/30",
  Medium: "bg-yellow-500/20 text-amber-700 border-amber-200",
  Low: "bg-blue-500/20 text-sky-700 border-sky-200",
};

// ── Step action icon / colour ─────────────────────────────────────────────────

function stepActionLabel(action: string) {
  const map: Record<string, { label: string; color: string }> = {
    navigate: { label: "Navigate", color: "text-sky-700" },
    click: { label: "Click", color: "text-positive" },
    fill: { label: "Fill", color: "text-purple-400" },
    assert_text: { label: "Assert", color: "text-amber-700" },
    screenshot: { label: "Screenshot", color: "text-cyan-400" },
    wait: { label: "Wait", color: "text-gray-400" },
    hover: { label: "Hover", color: "text-pink-400" },
    hover_and_click: { label: "Hover+Click", color: "text-[var(--color-warning)]" },
    press: { label: "Press", color: "text-indigo-400" },
    check: { label: "Check", color: "text-teal-400" },
    uncheck: { label: "Uncheck", color: "text-teal-400" },
    select_option: { label: "Select", color: "text-violet-400" },
    drag_and_drop: { label: "Drag", color: "text-rose-400" },
    dblclick: { label: "DblClick", color: "text-positive" },
    type_into: { label: "Type", color: "text-purple-300" },
    scroll: { label: "Scroll", color: "text-slate-400" },
    clear: { label: "Clear", color: "text-gray-400" },
  };
  return map[action] ?? { label: action, color: "text-muted-foreground" };
}

// ── All supported step actions ────────────────────────────────────────────────
const STEP_ACTIONS = [
  "navigate", "click", "fill", "assert_text", "screenshot", "wait",
  "hover", "hover_and_click", "press", "check", "uncheck",
  "select_option", "drag_and_drop", "dblclick", "type_into", "scroll", "clear",
] as const;

// ── Screenshot Viewer ─────────────────────────────────────────────────────────

function ScreenshotViewer({
  steps,
}: {
  steps: StepResult[];
}) {
  const withShots = steps.filter((s) => s.screenshot);
  const [idx, setIdx] = useState(0);

  if (withShots.length === 0) return null;

  const current = withShots[Math.min(idx, withShots.length - 1)];

  return (
    <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
      {/* Screenshot */}
      <div className="relative bg-muted/20">
        <img
          src={`data:image/png;base64,${current.screenshot}`}
          alt={current.step_description}
          className="w-full object-contain max-h-64"
        />
        {current.status === "fail" && (
          <div className="absolute top-2 right-2 bg-red-500/80 text-white text-[10px] px-2 py-0.5 rounded">
            FAILED STEP
          </div>
        )}
      </div>

      {/* Step nav */}
      <div className="flex items-center gap-1.5 p-2 overflow-x-auto">
        {withShots.map((s, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded border transition-colors ${i === idx
                ? "bg-primary/20 border-primary/50 text-primary"
                : s.status === "fail"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-muted border-border/50 text-muted-foreground hover:bg-muted/80"
              }`}
          >
            Step {i + 1}
          </button>
        ))}
      </div>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">{current.step_description}</p>
    </div>
  );
}

// ── Live test result card ─────────────────────────────────────────────────────

function LiveTestCard({ result }: { result: LiveTestResult }) {
  const [open, setOpen] = useState(false);

  const statusIcon = {
    running: <Loader2 className="h-4 w-4 animate-spin text-amber-700" />,
    passed: <CheckCircle2 className="h-4 w-4 text-positive" />,
    failed: <XCircle className="h-4 w-4 text-red-700" />,
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  }[result.status];

  const progress =
    result.total_steps > 0
      ? Math.round((result.steps_completed / result.total_steps) * 100)
      : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="floating-card overflow-hidden rounded-2xl"
    >
      {/* Header row */}
      <button
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/60 shadow-sm">
          {statusIcon}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground/90">{result.test_name}</span>
            {result.status === "running" && (
              <Badge variant="outline" className="h-5 border-primary/30 bg-primary/10 px-1.5 text-[9px] font-bold uppercase tracking-widest text-primary">
                Live
              </Badge>
            )}
            {result.status === "passed" && (
              <Badge variant="outline" className="h-5 border-positive/30 bg-positive/10 px-1.5 text-[9px] font-bold uppercase tracking-widest text-positive">
                Passed
              </Badge>
            )}
            {result.status === "failed" && (
              <Badge variant="outline" className="h-5 border-destructive/30 bg-destructive/10 px-1.5 text-[9px] font-bold uppercase tracking-widest text-destructive">
                Failed
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {result.duration_ms && <span>{(result.duration_ms / 1000).toFixed(1)}s</span>}
            <span className="h-1 w-1 rounded-full bg-border" />
            <span>
              {result.steps_completed}/{result.total_steps} steps
            </span>
          </div>
        </div>
        {open ? (
          <ChevronDown className="ml-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="ml-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Progress bar (while running) */}
      {result.status === "running" && (
        <Progress value={progress} className="h-1 rounded-none bg-muted/30" />
      )}

      {/* Expanded content */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border/30 px-4 pb-4 pt-3">
              {/* Error banner */}
              {result.error && (
                <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                  <p className="text-xs leading-relaxed text-destructive/90">{result.error}</p>
                </div>
              )}

              {/* Step list */}
              {result.step_results.map((sr, i) => {
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs transition-colors ${sr.status === "fail"
                        ? "border-destructive/20 bg-destructive/5"
                        : "border-border/50 bg-muted/20"
                      }`}
                  >
                    {sr.status === "pass" ? (
                      <CheckCircle2 className="h-3 w-3 text-positive mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-700 mt-0.5 flex-shrink-0" />
                    )}
                    <span className="flex-1 text-muted-foreground">{sr.step_description}</span>
                    {sr.screenshot && (
                      <Camera className="h-3 w-3 text-cyan-400 flex-shrink-0" />
                    )}
                  </div>
                );
              })}

              {/* Screenshot gallery */}
              <ScreenshotViewer steps={result.step_results} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Generated test case preview ───────────────────────────────────────────────

function TestCasePreview({ test }: { test: PlaywrightTestCase }) {
  const [open, setOpen] = useState(false);
  const sev = test.severity || "Medium";

  return (
    <div className="floating-card overflow-hidden rounded-2xl">
      <button
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/60 text-primary shadow-sm">
          <FlaskConical className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground/90">{test.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{test.page_name}</p>
        </div>
        <Badge
          variant="outline"
          className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${severityClass[sev] ?? ""}`}
        >
          {sev}
        </Badge>
        <span className="ml-1 text-[11px] text-muted-foreground">{test.steps.length} steps</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border/30 px-4 pb-4 pt-3">
              <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{test.description}</p>
              {test.steps.map((step, i) => {
                const { label, color } = stepActionLabel(step.action);
                return (
                  <div key={i} className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs">
                    <span className={`w-16 text-right font-mono text-[10px] uppercase tracking-widest ${color}`}>
                      {label}
                    </span>
                    <ArrowRight className="h-3 w-3 text-border flex-shrink-0" />
                    <span className="flex-1 truncate text-muted-foreground">{step.description}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Test Case Editor ──────────────────────────────────────────────────────────

const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;

function TestCaseEditor({
  test,
  onSave,
}: {
  test: PlaywrightTestCase;
  onSave: (id: string, updates: Partial<PlaywrightTestCase>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PlaywrightTestCase>(test);
  const sev = test.severity || "Medium";

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({ ...test });
    setEditing(true);
    setOpen(true);
  };

  const cancelEdit = () => {
    setDraft({ ...test });
    setEditing(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await onSave(test.id, {
        name: draft.name,
        description: draft.description,
        severity: draft.severity,
        steps: draft.steps,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const updateStep = (idx: number, field: keyof TestStep, val: string) => {
    setDraft((prev) => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], [field]: val || null } as TestStep;
      return { ...prev, steps };
    });
  };

  const addStep = () => {
    setDraft((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        { action: "screenshot", selector: null, value: null, description: "New step" } as TestStep,
      ],
    }));
  };

  const removeStep = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== idx),
    }));
  };

  const displayTest = editing ? draft : test;

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => !editing && setOpen((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              className="h-7 text-sm font-medium"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p className="text-sm font-medium truncate">{displayTest.name}</p>
          )}
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{displayTest.page_name}</p>
        </div>
        {editing ? (
          <select
            value={draft.severity}
            onChange={(e) => setDraft((p) => ({ ...p, severity: e.target.value }))}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] rounded border border-border/50 bg-background px-1.5 py-0.5 flex-shrink-0"
          >
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <Badge
            variant="outline"
            className={`text-[10px] ${severityClass[sev] ?? ""} flex-shrink-0`}
          >
            {sev}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">{displayTest.steps.length} steps</span>
        {!editing && (
          <button
            onClick={startEdit}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            title="Edit test case"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {!editing && (open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />)}
      </button>

      <AnimatePresence>
        {(open || editing) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {/* Description */}
              {editing ? (
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                  className="text-xs min-h-[60px]"
                  placeholder="Test description..."
                />
              ) : (
                <p className="text-xs text-muted-foreground">{displayTest.description}</p>
              )}

              {/* Steps */}
              <div className="space-y-1">
                {(editing ? draft.steps : displayTest.steps).map((step, i) => {
                  const { label, color } = stepActionLabel(step.action);
                  return editing ? (
                    <div key={i} className="rounded bg-muted/20 border border-border/30 p-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-[10px] text-muted-foreground font-mono w-5">{i + 1}.</span>
                        <select
                          value={step.action}
                          onChange={(e) => updateStep(i, "action", e.target.value)}
                          className="text-[10px] rounded border border-border/50 bg-background px-1.5 py-0.5 flex-1"
                        >
                          {STEP_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                        <button
                          onClick={() => removeStep(i)}
                          className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-700 flex-shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <Input
                        value={step.description}
                        onChange={(e) => updateStep(i, "description", e.target.value)}
                        placeholder="Step description"
                        className="h-6 text-[11px]"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          value={step.selector ?? ""}
                          onChange={(e) => updateStep(i, "selector", e.target.value)}
                          placeholder='selector (e.g. button:has-text("OK"))'
                          className="h-6 text-[10px] font-mono"
                        />
                        <Input
                          value={step.value ?? ""}
                          onChange={(e) => updateStep(i, "value", e.target.value)}
                          placeholder="value"
                          className="h-6 text-[10px] font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`w-20 text-right font-mono text-[10px] ${color}`}>{label}</span>
                      <ArrowRight className="h-3 w-3 text-border flex-shrink-0" />
                      <span className="text-muted-foreground truncate">{step.description}</span>
                    </div>
                  );
                })}

                {editing && (
                  <button
                    onClick={addStep}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-border/50 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add Step
                  </button>
                )}
              </div>

              {/* Edit actions */}
              {editing && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={saving}>
                    {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cancelEdit} disabled={saving}>
                    <X className="h-3 w-3 mr-1" /> Cancel
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Test Case Type options ────────────────────────────────────────────────────

const TEST_CASE_TYPES = [
  {
    value: "e2e",
    label: "E2E / Functional",
    desc: "Full user journey tests, happy paths, complete workflows",
    prompt: "Generate comprehensive end-to-end functional tests covering complete user workflows from start to finish. Include happy paths and critical user flows.",
  },
  {
    value: "smoke",
    label: "Smoke / Sanity",
    desc: "Quick checks on the most critical app paths",
    prompt: "Generate smoke tests that verify the most critical functionality works. Focus on core features that must work for the app to be usable.",
  },
  {
    value: "regression",
    label: "Regression",
    desc: "Comprehensive suite covering all features and edge cases",
    prompt: "Generate a comprehensive regression test suite covering all major features, user flows, edge cases, and boundary conditions.",
  },
  {
    value: "security",
    label: "Security",
    desc: "Auth flows, input validation, access control tests",
    prompt: "Generate security-focused tests covering authentication, authorization, input validation, and access control. Test for common security vulnerabilities.",
  },
  {
    value: "accessibility",
    label: "Accessibility",
    desc: "WCAG compliance, keyboard nav, ARIA attributes",
    prompt: "Generate accessibility tests that verify WCAG compliance, keyboard navigation, focus management, and proper ARIA attributes.",
  },
  {
    value: "api",
    label: "API / Integration",
    desc: "API calls, data flows, error handling",
    prompt: "Generate integration tests verifying correct API interactions, data flow between components, and proper handling of API responses and errors.",
  },
];

// ── Quick test type chips ─────────────────────────────────────────────────────

const TEST_TYPE_CHIPS = [
  { label: "Auth Flows", icon: Shield, desc: "Login, logout, session, protected routes" },
  { label: "CRUD", icon: ListChecks, desc: "Create, read, update, delete operations" },
  { label: "Navigation", icon: Navigation, desc: "Page routing, links, redirects" },
  { label: "Form Validation", icon: MousePointer, desc: "Input validation, error messages" },
  { label: "Edge Cases", icon: Zap, desc: "Boundary values, empty states, limits" },
  { label: "Error Handling", icon: Bug, desc: "Error pages, failure states, 404s" },
];

// ── Upload Spec Panel ─────────────────────────────────────────────────────────

function UploadSpecPanel({
  onUpload,
  isParsing,
  errorMsg,
  initialAppUrl,
}: {
  onUpload: (file: File, targetUrl: string, email?: string, password?: string) => void;
  isParsing: boolean;
  errorMsg: string | null;
  initialAppUrl?: string;
}) {
  const [targetUrl, setTargetUrl] = useState(initialAppUrl ?? "");
  const [testEmail, setTestEmail] = useState("");
  const [testPassword, setTestPassword] = useState("1234567890");
  const [showPassword, setShowPassword] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLocalhost = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");
  const canRun = selectedFile && targetUrl.trim().startsWith("http") && !isParsing;

  const handleFile = (f: File) => {
    if (f.name.endsWith(".ts") || f.name.endsWith(".js")) {
      setSelectedFile(f);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-5">
      <Card className="floating-card overflow-hidden rounded-[2rem] border-border/40">
        <CardHeader className="bg-card/60 pb-0">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 flex-shrink-0">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Upload Spec File</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Upload an existing <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.spec.ts</code> file. Tests will be parsed and run directly no AI generation needed.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="bg-card/50 p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <p className="text-xs text-destructive/90">{errorMsg}</p>
            </div>
          )}

          {/* Drop zone */}
          <div
            className={`relative cursor-pointer rounded-3xl border-2 border-dashed transition-colors ${dragOver
                ? "border-primary bg-primary/5"
                : selectedFile
                  ? "border-primary/30/50 bg-positive/10"
                  : "border-border/50 hover:border-primary/40 hover:bg-muted/20"
              }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".ts,.js,.spec.ts,.spec.js"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              {selectedFile ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30/20 bg-positive/10">
                    <FileCode className="h-6 w-6 text-positive" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-positive">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{(selectedFile.size / 1024).toFixed(1)} KB click to change</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 bg-muted/50">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Drop your spec file here</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      or click to browse <code className="font-mono">.spec.ts</code> / <code className="font-mono">.spec.js</code>
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Target URL */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <Globe className="h-3.5 w-3.5" /> Target App URL
            </label>
            <Input
              placeholder="https://your-app.vercel.app"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={isParsing}
              className="h-11 rounded-xl border-border/50 bg-background/70"
            />
            {isLocalhost && targetUrl.trim().length > 10 ? (
              <div className="flex items-start gap-1.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-700" />
                <p className="text-[11px] leading-snug text-amber-800">
                  Playwright runs <strong>inside the backend</strong>. Your app must be accessible from this machine.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">The app must be running and accessible from this server.</p>
            )}
          </div>

          <div className="space-y-2 rounded-2xl border border-border/40 bg-card/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Test Credentials (if login is required)</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <Input
                type="email"
                placeholder="qa-user@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                disabled={isParsing}
                className="h-11 rounded-xl border-border/50 bg-background/70"
              />
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  disabled={isParsing}
                  className="h-11 rounded-xl border-border/50 bg-background/70 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Credentials are inserted into matching username/email/password fill steps before execution.
            </p>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!canRun}
            onClick={() => selectedFile && onUpload(selectedFile, targetUrl.trim(), testEmail || undefined, testPassword || undefined)}
          >
            {isParsing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Parsing spec file…</>
            ) : (
              <><FlaskConical className="h-4 w-4 mr-2" />Parse &amp; Preview Tests</>
            )}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Phase: Input form ─────────────────────────────────────────────────────────

function InputPhase({
  onAnalyze,
  onUploadSpec,
  isAnalyzing,
  isParsing,
  errorMsg,
  initialGithubUrl,
  initialAppUrl,
}: {
  onAnalyze: (
    github: string, target: string, email?: string, password?: string, preferences?: string,
    numTests?: number, mode?: "full" | "commit", commitSha?: string, commitMessage?: string,
    pat?: string,
  ) => void;
  onUploadSpec: (file: File, targetUrl: string, email?: string, password?: string) => void;
  isAnalyzing: boolean;
  isParsing: boolean;
  errorMsg: string | null;
  initialGithubUrl?: string;
  initialAppUrl?: string;
}) {
  let pipelinePat: string | undefined;
  try {
    const ctx = usePipelineContext();
    pipelinePat = ctx.githubPat;
  } catch (e) {
    // Outside pipeline context
  }

  const [inputMode, setInputMode] = useState<"ai" | "upload">("ai");
  const [githubUrl, setGithubUrl] = useState(initialGithubUrl ?? "");
  const [targetUrl, setTargetUrl] = useState(initialAppUrl ?? "");
  const [testEmail, setTestEmail] = useState("");
  const [testPassword, setTestPassword] = useState("1234567890");
  const [showPassword, setShowPassword] = useState(false);
  const [testPreferences, setTestPreferences] = useState("");
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [testCaseType, setTestCaseType] = useState("e2e");
  const [numTests, setNumTests] = useState(1);

  // ── Commit-mode state ────────────────────────────────────────────────────
  const [testingScope, setTestingScope] = useState<"full" | "commit">("full");
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const fetchCommits = useFetchCommits();
  const commits: CommitInfo[] = (fetchCommits.data?.commits ?? []) as CommitInfo[];
  const isFetchingCommits = fetchCommits.isPending;

  const handleFetchCommits = () => {
    if (githubUrl.trim().startsWith("https://")) {
      setSelectedCommit(null);
      fetchCommits.mutate({ githubUrl: githubUrl.trim(), pat: pipelinePat });
    }
  };

  const toggleChip = (label: string) => {
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      // Build preferences from chips
      const chipTexts = Array.from(next).map((l) => {
        const chip = TEST_TYPE_CHIPS.find((c) => c.label === l);
        return chip ? `${l}: ${chip.desc}` : l;
      });
      // Merge with any freetext
      const freeText = testPreferences.replace(/^(Auth Flows|CRUD|Navigation|Form Validation|Edge Cases|Error Handling).*\n?/gm, "").trim();
      setTestPreferences([...chipTexts, ...(freeText ? [freeText] : [])].join("\n"));
      return next;
    });
  };

  const isLocalhost = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");
  const canSubmit =
    githubUrl.trim().startsWith("https://") &&
    targetUrl.trim().startsWith("http") &&
    (testingScope === "full" || selectedCommit !== null);

  // Upload mode render separate panel
  if (inputMode === "upload") {
    return (
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="max-w-6xl mx-auto flex justify-center">
          <div className="flex rounded-lg border border-border/50 bg-background/50 p-0.5 gap-0.5">
            <button
              onClick={() => setInputMode("ai")}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <Play className="h-3 w-3" /> AI Generation
            </button>
            <button
              onClick={() => setInputMode("upload")}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground shadow-sm transition-colors"
            >
              <Upload className="h-3 w-3" /> Upload Spec File
            </button>
          </div>
        </div>
        <UploadSpecPanel
          onUpload={onUploadSpec}
          isParsing={isParsing}
          errorMsg={errorMsg}
          initialAppUrl={initialAppUrl}
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto"
    >
      {/* Mode toggle */}
      <div className="flex justify-center mb-4">
        <div className="flex rounded-lg border border-border/50 bg-background/50 p-0.5 gap-0.5">
          <button
            onClick={() => setInputMode("ai")}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground shadow-sm transition-colors"
          >
            <Play className="h-3 w-3" /> AI Generation
          </button>
          <button
            onClick={() => setInputMode("upload")}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Upload className="h-3 w-3" /> Upload Spec File
          </button>
        </div>
      </div>

      <Card className="rounded-2xl border-border/50 shadow-sm">
        <CardHeader className="pb-0">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 flex-shrink-0">
              <Play className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-xl">Live Test Runner</CardTitle>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                Provide a GitHub repository and a running app URL. The AI will analyse the codebase,
                generate Playwright test cases, and execute them live with browser screenshots.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="bg-card/50 p-8">
          {errorMsg && (
            <div className="mb-5 flex items-start gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <p className="text-xs text-destructive/90">{errorMsg}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
            {/* Left: Configuration */}
            <div className="w-full min-w-0 space-y-5 lg:pr-6 lg:border-r border-border/40">
              <div className="floating-card rounded-[1.75rem] p-5 space-y-5">
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <Github className="h-3.5 w-3.5" /> GitHub Repository URL
                  </label>
                  <Input
                    placeholder="https://github.com/owner/repo"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    disabled={isAnalyzing}
                    className="h-11 rounded-xl border-border/50 bg-background/70"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Shallow clone + AI analysis uses this repository.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <Globe className="h-3.5 w-3.5" /> Target App URL (running server)
                  </label>
                  <Input
                    placeholder="http://localhost:3000"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    disabled={isAnalyzing}
                    className="h-11 rounded-xl border-border/50 bg-background/70"
                  />
                  {isLocalhost && targetUrl.trim().length > 10 ? (
                    <div className="mt-1 flex items-start gap-1.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-700" />
                      <p className="text-[11px] leading-snug text-amber-800">
                        Playwright runs <strong>inside the backend</strong>. Your app must be running
                        on this machine at the port above. Vite default is{" "}
                        <code className="font-mono">:5173</code>, not <code className="font-mono">:8083</code>.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      The app must be running and accessible from this server.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" /> Test Case Type
                  </label>
                  <Select value={testCaseType} onValueChange={setTestCaseType} disabled={isAnalyzing}>
                    <SelectTrigger className="h-11 w-full rounded-xl border-border/60 bg-card/70 hover:border-border focus:ring-primary/20">
                      <SelectValue>
                        {TEST_CASE_TYPES.find((t) => t.value === testCaseType)?.label ?? "Select test type…"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-border/60 bg-card shadow-2xl backdrop-blur-xl">
                      {TEST_CASE_TYPES.map((type) => (
                        <SelectItem
                          key={type.value}
                          value={type.value}
                          className="cursor-pointer py-2.5 focus:bg-primary/10 data-[state=checked]:bg-primary/10"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-[13px] text-foreground">{type.label}</span>
                            <span className="text-[11px] text-muted-foreground leading-snug">{type.desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const sel = TEST_CASE_TYPES.find((t) => t.value === testCaseType);
                    return sel ? (
                      <p className="text-[11px] text-muted-foreground">{sel.desc}</p>
                    ) : null;
                  })()}
                </div>
              </div>

              <div className="floating-card rounded-[1.75rem] p-5 space-y-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <ListChecks className="h-3.5 w-3.5" /> What to Test
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Optional helps the AI focus test generation.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {TEST_TYPE_CHIPS.map(({ label, icon: Icon }) => (
                      <button
                        key={label}
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() => toggleChip(label)}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${selectedChips.has(label)
                            ? "bg-primary/20 border-primary/50 text-primary"
                            : "bg-muted/40 border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                          }`}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Description</label>
                  <p className="text-[11px] text-muted-foreground">
                    Provide extra context, edge cases, and expected behaviors.
                  </p>
                  <Textarea
                    placeholder="e.g. Focus on authentication flows and form validation. Test happy paths and error cases for task creation."
                    value={testPreferences}
                    onChange={(e) => setTestPreferences(e.target.value)}
                    disabled={isAnalyzing}
                    className="min-h-[110px] resize-none rounded-xl border-border/50 bg-background/70 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Right: Control panel */}
            <div className="floating-card flex w-full min-w-0 flex-col gap-5 self-start rounded-[1.75rem] p-5">
              <div className="rounded-[1.5rem] border border-border/40 bg-card/50 p-4 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Login Credentials</p>
                  <p className="text-[11px] text-muted-foreground">
                    Optional used for apps that require sign-in.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">Email / Username</label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      disabled={isAnalyzing}
                      className="h-11 rounded-xl border-border/50 bg-background/70"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">Password</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={testPassword}
                        onChange={(e) => setTestPassword(e.target.value)}
                        disabled={isAnalyzing}
                        className="h-11 rounded-xl border-border/50 bg-background/70 pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? "hide" : "show"}
                      </button>
                    </div>
                  </div>
                </div>

                {testEmail && (
                  <p className="flex items-center gap-1 text-[11px] text-positive">
                    <CheckCircle2 className="h-3 w-3" /> Credentials will be injected into login test steps
                  </p>
                )}
              </div>

              <div className="rounded-[1.5rem] border border-border/40 bg-card/50 p-4 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Testing Scope</p>
                  <p className="text-[11px] text-muted-foreground">
                    Choose whether to test the entire app or target a commit.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {(["full", "commit"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => {
                        setTestingScope(scope);
                        setSelectedCommit(null);
                      }}
                        className={`flex items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${testingScope === scope
                          ? "border-primary/40 bg-primary/10"
                          : "border-border/40 bg-muted/20 hover:border-primary/30 hover:bg-primary/5"
                        }`}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center border flex-shrink-0 ${testingScope === scope
                          ? "bg-primary/10 border-primary/25 text-primary"
                          : "bg-background/40 border-border/50 text-muted-foreground"
                        }`}>
                        {scope === "full" ? <Workflow className="h-4 w-4" /> : <GitCommit className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-[12px] font-semibold ${testingScope === scope ? "text-primary" : "text-foreground"}`}>
                          {scope === "full" ? "Entire App" : "Specific Commit"}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                          {scope === "full"
                            ? "Analyse the full codebase and generate broad coverage"
                            : "Generate tests based on one commit's changes"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                {testingScope === "commit" && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!githubUrl.trim().startsWith("https://") || isFetchingCommits || isAnalyzing}
                        onClick={handleFetchCommits}
                        className="text-xs h-8"
                      >
                        {isFetchingCommits ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Fetching…</>
                        ) : (
                          <><Clock className="h-3.5 w-3.5 mr-1.5" />Load Recent Commits</>
                        )}
                      </Button>
                      {commits.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">{commits.length}</span>
                      )}
                    </div>

                    {commits.length > 0 && (
                      <div className="rounded-lg border border-border/50 bg-background/40 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/40">
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-[11px] font-medium text-muted-foreground">Recent commits</span>
                          <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1.5">
                            {commits.length}
                          </Badge>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {commits.map((c) => (
                            <button
                              key={c.sha}
                              type="button"
                              disabled={isAnalyzing}
                              onClick={() => setSelectedCommit(c)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-border/20 last:border-b-0 ${selectedCommit?.sha === c.sha
                                  ? "bg-primary/10 border-l-2 border-l-primary"
                                  : "hover:bg-muted/30"
                                }`}
                            >
                              <div className="h-6 w-6 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                                {c.author.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-[12px] font-medium truncate leading-snug ${selectedCommit?.sha === c.sha ? "text-primary" : "text-foreground"}`}>
                                  {c.message}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <span className="font-medium text-foreground/60">{c.author}</span>
                                  <span>·</span>
                                  <span>{c.relative_date}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <code className="text-[10px] font-mono text-primary/80 bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <GitCommit className="h-2.5 w-2.5" />
                                  {c.short_sha}
                                </code>
                                {selectedCommit?.sha === c.sha && (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedCommit && (
                      <div className="flex items-center gap-2 rounded bg-primary/10 border border-primary/20 px-3 py-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        <p className="text-[11px] text-primary flex-1 min-w-0 truncate">
                          Testing commit <code className="font-mono">{selectedCommit.short_sha}</code>: {selectedCommit.message}
                        </p>
                      </div>
                    )}

                    {!selectedCommit && commits.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Enter a GitHub URL, then load and select a commit.
                      </p>
                    )}
                    {!selectedCommit && commits.length > 0 && (
                      <p className="text-[11px] text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Select a commit to continue.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-[1.5rem] border border-border/40 bg-card/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Number of Tests</p>
                    <p className="text-[11px] text-muted-foreground">How many test cases to generate (1–10)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isAnalyzing || numTests <= 1}
                      onClick={() => setNumTests((v) => Math.max(1, v - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-40"
                    >−</button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{numTests}</span>
                    <button
                      type="button"
                      disabled={isAnalyzing || numTests >= 10}
                      onClick={() => setNumTests((v) => Math.min(10, v + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-40"
                    >+</button>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-1">
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!canSubmit || isAnalyzing}
                  onClick={() => {
                    const typeObj = TEST_CASE_TYPES.find((t) => t.value === testCaseType);
                    const typePrefix = typeObj ? `TEST CASE TYPE: ${typeObj.label} ${typeObj.prompt}` : "";
                    const combinedPrefs = [typePrefix, testPreferences.trim()].filter(Boolean).join("\n\n");
                    onAnalyze(
                      githubUrl.trim(),
                      targetUrl.trim(),
                      testEmail || undefined,
                      testPassword || undefined,
                      combinedPrefs || undefined,
                      numTests,
                      testingScope,
                      selectedCommit?.sha,
                      selectedCommit?.message,
                      undefined, // Explicitly pass undefined for PAT if not in pipeline context, or we'll get it from context in LiveTestRunner
                    );
                  }}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {testingScope === "commit" ? "Running on commit…" : "Running…"}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Run AI Tests
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Disabled until repo + target URL are provided{testingScope === "commit" ? " and a commit is selected" : ""}.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Step progress indicator ───────────────────────────────────────────────────

const STEPS = [
  { key: "cloning", label: "Cloning repository" },
  { key: "extracting", label: "Extracting source files" },
  { key: "analyzing", label: "AI analysing codebase" },
  { key: "generating", label: "Generating Playwright tests" },
];

function stepIndex(step: string): number {
  return STEPS.findIndex((s) => s.key === step);
}

// ── Phase: Analysing live log viewer ───────────────────────────────────────

function AnalyzingPhase({
  jobData,
}: {
  jobData: ReturnType<typeof useLiveTesting>["jobData"];
}) {
  const logs: string[] = jobData?.logs ?? [];
  const currentStep = jobData?.step ?? "pending";
  const currentIdx = stepIndex(currentStep);

  const getLogLineClassName = (line: string) => {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("✓")) return "text-positive";
    if (trimmed.startsWith("Step")) return "text-primary font-semibold";

    if (trimmed.startsWith("✗")) {
      const rest = trimmed.slice(1).trimStart();
      const hasErrorKeywords = /\b(error|failed|failure|exception|traceback|fatal)\b/i.test(rest);
      const looksLikePath = /^(~?\/|[A-Za-z]:\\)/.test(rest);

      return !hasErrorKeywords && looksLikePath ? "text-white/80" : "text-red-700";
    }

    return "text-white/80";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-xl mx-auto space-y-5"
    >
      <div className="text-center space-y-1">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 mb-1">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
        </div>
        <h2 className="font-semibold">Analysing codebase…</h2>
        <p className="text-xs text-muted-foreground">This takes 30–90 seconds. Do not close the page.</p>
      </div>

      {/* Step progress */}
      <div className="space-y-2">
        {STEPS.map((s, i) => {
          const done = i < currentIdx || currentStep === "completed";
          const active = i === currentIdx;
          return (
            <div key={s.key} className={`flex items-center gap-3 text-sm rounded-lg p-2.5 border transition-colors ${done ? "border-positive/25 bg-positive/10" :
                active ? "border-primary/40 bg-primary/5" :
                  "border-border/30 bg-transparent text-muted-foreground"
              }`}>
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-positive flex-shrink-0" />
              ) : active ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-border/50 flex-shrink-0" />
              )}
              <span className={active ? "text-primary font-medium" : done ? "text-positive" : ""}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Live log terminal */}
      {logs.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/30">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-primary/70" />
            <span className="text-[10px] text-foreground/70 ml-2 font-mono">analysis log</span>
          </div>
          <div className="p-3 space-y-0.5 max-h-52 overflow-y-auto font-mono text-foreground/80">
            {logs.map((line, i) => (
              <p
                key={i}
                className={`text-[11px] leading-relaxed ${getLogLineClassName(line)}`}
              >
                {line}
              </p>
            ))}
            {/* Blinking cursor */}
            <span className="inline-block h-3 w-1.5 bg-primary/70 animate-pulse" />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Phase: Ready (show analysis + tests, allow run) ───────────────────────────

function ReadyPhase({
  analysis,
  editedTests,
  onExecute,
  onReset,
  onSave,
  isExecuting,
  errorMsg,
  specTargetUrl,
  onSpecTargetUrlChange,
  baselineTests = [],
  selectedBaselineIds = new Set(),
  onBaselineToggle,
}: {
  analysis: NonNullable<ReturnType<typeof useLiveTesting>["analysis"]>;
  editedTests: PlaywrightTestCase[] | null;
  onExecute: (combinedTests?: PlaywrightTestCase[]) => void;
  onReset: () => void;
  onSave: (id: string, updates: Partial<PlaywrightTestCase>) => Promise<void>;
  isExecuting: boolean;
  errorMsg: string | null;
  specTargetUrl?: string | null;
  onSpecTargetUrlChange?: (url: string) => void;
  baselineTests?: BaselineTest[];
  selectedBaselineIds?: Set<string>;
  onBaselineToggle?: (checked: boolean) => void;
}) {
  const tests = editedTests ?? analysis.tests;
  const isSpecUpload = analysis.analysis_id.startsWith("spec-");

  // Map PlaywrightTestCase to WorkspacePlaywrightTest for UnifiedTestIntelligence
  const sessionMapped: WorkspacePlaywrightTest[] = tests.map(t => ({
    id: t.id,
    analysis_id: analysis.analysis_id,
    name: t.name,
    description: t.description,
    page_name: t.page_name,
    severity: t.severity,
    steps: t.steps,
    source: isSpecUpload ? "baseline" : "session"
  } as any));

  const baselineMapped: WorkspacePlaywrightTest[] = baselineTests
    .filter(bt => selectedBaselineIds.has(bt.test_id))
    .map(bt => ({
      id: bt.test_id,
      analysis_id: "baseline",
      name: bt.name,
      description: bt.description,
      page_name: bt.page_path || "/",
      severity: bt.severity,
      steps: bt.steps.map(s => ({
        action: s.action,
        selector: s.target,
        value: s.value,
        description: s.assertion || ""
      })),
      source: "baseline"
    } as any));

  const mappedTests = [...sessionMapped, ...baselineMapped];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* Premium Header Strip */}
      <div className="flex items-center justify-between bg-card/60 border border-border/50 px-5 py-4 rounded-2xl backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-4">
             <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20 shadow-inner">
               <AiIcon className="h-6 w-6 text-primary" />
             </div>
             <div>
               <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-0.5">Intelligence Status</p>
               <h4 className="text-base font-black uppercase tracking-tight">Active Growth Stream</h4>
             </div>
          </div>
          <div className="h-10 w-px bg-border/20" />
          <div className="flex flex-col">
             <span className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest mb-1">Stack Discovery</span>
             <Badge variant="outline" className="text-[10px] font-bold border-primary/20 bg-primary/5 px-2.5 py-1 rounded-lg">
                {analysis.tech_stack}
             </Badge>
          </div>

          {baselineTests.length > 0 && (
            <>
              <div className="h-10 w-px bg-border/20" />
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <Label htmlFor="baseline-toggle-ltr" className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-1.5 cursor-pointer">
                    Integrate Baseline
                  </Label>
                  <div className="flex items-center gap-3">
                    <Switch 
                      id="baseline-toggle-ltr" 
                      checked={selectedBaselineIds.size > 0}
                      onCheckedChange={onBaselineToggle}
                    />
                    <span className="text-[10px] font-bold text-muted-foreground/40">{selectedBaselineIds.size} Units</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Button variant="outline" className="h-10 px-5 rounded-2xl border-border/40 hover:bg-muted/20 font-black uppercase tracking-[0.18em] text-[10px]" onClick={onReset} disabled={isExecuting}>
            New Session
          </Button>
          <Button className="h-10 px-8 rounded-2xl shadow-sm bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-[0.18em] text-[10px]" onClick={() => onExecute(mappedTests as any)} disabled={isExecuting || (isSpecUpload && !specTargetUrl?.trim().startsWith("http"))}>
            {isExecuting ? <Loader2 className="h-4 w-4 animate-spin mr-3" /> : <Play className="h-4 w-4 mr-3 fill-current" />}
            Trigger Growth
          </Button>
        </div>
      </div>

      {analysis.summary && (
        <div className="rounded-2xl border border-border/30 bg-muted/5 p-6 backdrop-blur-sm">
           <div className="flex items-start gap-4">
              <div className="p-2 rounded-xl bg-primary/10 mt-1">
                 <Info className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-medium leading-relaxed text-foreground/80">{analysis.summary}</p>
           </div>
        </div>
      )}

      {/* Unified Intelligence List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-4">
           <h2 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.3em]">Execution Plan Orchestration</h2>
           <span className="text-[10px] font-bold text-muted-foreground/50">{tests.length} Units Ready</span>
        </div>
        <UnifiedTestIntelligence tests={mappedTests} />
      </div>

      {errorMsg && (
        <div className="rounded-3xl bg-red-50 border border-red-500/20 p-6 space-y-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-700" />
            <p className="text-sm font-black uppercase tracking-widest text-red-700">Signal Interruption</p>
          </div>
          <p className="text-xs text-red-700 font-medium leading-relaxed ml-8">{errorMsg}</p>
        </div>
      )}

      {isSpecUpload && (
        <div className="rounded-[2rem] border border-border/50 bg-card/40 p-8 space-y-4 shadow-inner">
          <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-1">
            <Globe className="h-3.5 w-3.5 inline mr-2" /> Target Application Bridge
          </label>
          <Input
            placeholder="https://your-production-app.app"
            value={specTargetUrl ?? ""}
            onChange={(e) => onSpecTargetUrlChange?.(e.target.value)}
            disabled={isExecuting}
            className="h-12 bg-background/50 border-border/30 rounded-2xl font-medium px-5"
          />
        </div>
      )}
    </motion.div>
  );
}

// ── Phase: Executing + Done ───────────────────────────────────────────────────

function ExecutionPhase({
  runStatus,
  onReset,
  phase,
  analysis,
}: {
  runStatus: ReturnType<typeof useLiveTesting>["runStatus"];
  onReset: () => void;
  phase: LiveTestingPhase;
  analysis?: RepoAnalysisResult | null;
}) {
  if (!runStatus) {
    return (
      <div className="flex flex-col items-center py-24 gap-4 animate-pulse">
        <div className="p-4 rounded-3xl bg-primary/10 border border-primary/20">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
        <p className="text-sm font-black text-muted-foreground uppercase tracking-widest">Initialising Observer Stream...</p>
      </div>
    );
  }

  const { results, total, passed, failed, status } = runStatus;
  const completedCount = results.filter((r) => r.status === "passed" || r.status === "failed").length;
  const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const successRatePercent = total > 0 ? Math.round((passed / total) * 100) : 0;

  const runningTest = results.find((r) => r.status === "running");
  const latestFrame = runningTest?.step_results.slice().reverse().find((s) => s.screenshot)?.screenshot ?? null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      {/* Simulation Monitor */}
      <div className="rounded-2xl border border-border/50 bg-card/60 overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 bg-card/50 border-b border-border/30">
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500/70 shadow-[0_0_10px_rgba(239,68,68,0.4)]" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/70 shadow-[0_0_10px_rgba(234,179,8,0.4)]" />
            <div className="h-3 w-3 rounded-full bg-primary/70 shadow-[0_0_10px_rgba(255,161,43,0.4)]" />
          </div>
          <div className="flex-1 mx-4 bg-muted/20 rounded-xl px-4 py-1.5 text-[11px] text-muted-foreground font-mono truncate border border-border/40">
            {runningTest ? `Active Trace: ${runningTest.test_name}` : "Playwright Execution Bridge"}
          </div>
          {status === "running" && (
            <div className="flex items-center gap-2.5 text-[10px] text-amber-700 font-black bg-yellow-400/10 px-3 py-1 rounded-full border border-yellow-400/20 tracking-widest uppercase">
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              Live Stream
            </div>
          )}
        </div>
        <div className="relative aspect-video bg-muted/30 flex items-center justify-center min-h-[400px]">
          <AnimatePresence mode="wait">
            {latestFrame ? (
              <motion.img
                key={latestFrame.slice(-20)}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                src={`data:image/png;base64,${latestFrame}`}
                alt="Live browser feed"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 text-muted-foreground text-center max-w-xs">
                <div className="p-5 rounded-full bg-muted/10 border border-border/20 mb-2">
                  <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
                </div>
                <p className="text-sm font-black uppercase tracking-widest opacity-60">Wait for visual synchronisation...</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         <div className="lg:col-span-2 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-8 relative">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "p-3 rounded-2xl border transition-all duration-500",
                  status === "running" ? "bg-amber-50 border-amber-200 animate-pulse" : "bg-positive/10 border-positive/25"
                )}>
                  {status === "running" ? (
                    <Loader2 className="h-6 w-6 animate-spin text-amber-700" />
                  ) : (
                    <CheckCircle2 className="h-6 w-6 text-positive" />
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-0.5">Execution Metrics</p>
                  <p className="text-base font-black uppercase tracking-tight">
                    {status === "running" ? `Processing Unit ${completedCount + 1} of ${total}` : "Validation Protocols Concluded"}
                  </p>
                </div>
              </div>
              {phase === "done" && (
                <div className="flex items-center gap-3">
                  <Button 
                    variant="outline" 
                    className="h-10 px-5 rounded-2xl border-border/40 bg-background/50 hover:bg-background font-black uppercase tracking-[0.18em] text-[10px] shadow-sm transform hover:scale-105 transition-all"
                    onClick={() => downloadLiveTestReport(runStatus!, analysis)}
                  >
                    <Download className="h-4 w-4 mr-2.5 text-primary" /> Analysis Pack
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="h-10 w-10 rounded-2xl border border-border/20 hover:bg-muted/40 transition-all p-0"
                    onClick={onReset}
                  >
                    <RotateCcw className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                <span>Coverage Depth</span>
                <span className="text-primary font-bold">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2.5 rounded-full bg-muted/30 shadow-inner" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Validated", value: passed, icon: CheckCircle2, color: "text-positive", bg: "bg-primary/5" },
                { label: "Friction", value: failed, icon: AlertTriangle, color: "text-red-700", bg: "bg-red-400/5" },
                { label: "Resolved", value: completedCount, icon: Play, color: "text-primary", bg: "bg-primary/5" },
              ].map((stat) => (
                <div key={stat.label} className={cn("p-4 rounded-2xl border border-border/20 backdrop-blur-sm transition-all hover:border-border/40", stat.bg)}>
                  <div className="flex items-center justify-between mb-2">
                    <stat.icon className={cn("h-4 w-4", stat.color)} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">{stat.label}</span>
                  </div>
                  <p className="text-2xl font-black tabular-nums tracking-tighter">{stat.value}</p>
                </div>
              ))}
            </div>
         </div>

         <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-primary/10 to-primary/5 px-5 py-6 flex flex-col justify-center items-center text-center backdrop-blur-md shadow-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.15),transparent)] opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="relative space-y-4">
              <div className="p-4 rounded-full bg-background/50 border border-primary/20 shadow-sm inline-block mb-2 transform group-hover:scale-110 transition-transform duration-700">
                <AiIcon className="h-10 w-10 text-primary animate-pulse" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-primary/70">{total} Active Units</p>
              <div className="space-y-1">
                <p className="text-4xl font-black tabular-nums tracking-tighter text-primary">
                  {status === "running" ? Math.round(progressPercent) : successRatePercent}
                  <span className="text-2xl ml-1 text-primary/60">%</span>
                </p>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                  {status === "running" ? "Stream Progress" : "Accuracy Rating"}
                </p>
              </div>
            </div>
         </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
             <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
             <h2 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.25em]">Observation Log</h2>
          </div>
          <div className="flex items-center gap-8">
             <div className="flex items-center gap-2 group">
                <span className="text-[10px] font-black text-muted-foreground group-hover:text-positive transition-colors tracking-widest uppercase">Verified</span>
                <span className="text-xl font-black tabular-nums text-positive">{passed}</span>
             </div>
             <div className="flex items-center gap-2 group">
                <span className="text-[10px] font-black text-muted-foreground group-hover:text-red-700 transition-colors tracking-widest uppercase">Friction</span>
                <span className="text-xl font-black tabular-nums text-red-700">{failed}</span>
             </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results.map((r) => <LiveTestCard key={r.test_id} result={r} />)}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

// ── Run Detail Sheet ──────────────────────────────────────────────────────────

function RunDetailSheet({ run, open, onClose }: { run: RunSummaryItem | null; open: boolean; onClose: () => void }) {
  if (!run) return null;
  const rate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
  const durationSec = run.started_at && run.completed_at
    ? ((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)
    : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col border-l border-border/50 bg-background/95 p-0 backdrop-blur-xl sm:max-w-2xl">
        {/* Header */}
        <SheetHeader className="border-b border-border/40 bg-card/60 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full flex-shrink-0 ${run.status === "completed" ? "bg-primary" :
                  run.status === "failed" ? "bg-red-400" :
                    "bg-yellow-400 animate-pulse"
                }`} />
              <SheetTitle className="text-base font-semibold">Test Run Details</SheetTitle>
            </div>
            {run.status !== "running" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs flex-shrink-0"
                onClick={() => downloadRunSummaryReport(run)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
              </Button>
            )}
          </div>
          <SheetDescription asChild>
            <div className="flex items-center gap-2 mt-1">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <code className="text-xs font-mono text-muted-foreground">{run.run_id}</code>
            </div>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-6">
            {/* Stats cards */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total", value: run.total, color: "text-foreground" },
                { label: "Passed", value: run.passed, color: "text-positive" },
                { label: "Failed", value: run.failed, color: "text-red-700" },
                { label: "Rate", value: `${rate}%`, color: rate >= 80 ? "text-positive" : rate >= 50 ? "text-amber-700" : "text-red-700" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-border/40 bg-card/60 p-3 text-center shadow-sm">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Pass rate</span>
                <span className={rate >= 80 ? "text-positive" : rate >= 50 ? "text-amber-700" : "text-red-700"}>
                  {rate}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${rate >= 80 ? "bg-primary" : rate >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
                  style={{ width: `${rate}%` }}
                />
              </div>
            </div>

            {/* Meta info */}
            <div className="rounded-xl border border-border/50 bg-card/40 divide-y divide-border/30">
              {[
                { label: "Status", value: run.status },
                run.started_at ? { label: "Started", value: new Date(run.started_at).toLocaleString() } : null,
                run.completed_at ? { label: "Completed", value: new Date(run.completed_at).toLocaleString() } : null,
                durationSec ? { label: "Duration", value: `${durationSec}s` } : null,
              ].filter(Boolean).map((item) => (
                <div key={item!.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground text-[12px]">{item!.label}</span>
                  <span className="font-medium text-[12px] capitalize">{item!.value}</span>
                </div>
              ))}
            </div>

            <Separator />

            {/* Test results */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <ListChecks className="h-4 w-4" />
                Test Results ({run.results?.length ?? 0})
              </h3>
              {run.results && run.results.length > 0 ? (
                <div className="space-y-2">
                  {run.results.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 rounded-2xl border p-3 ${r.status === "passed"
                          ? "border-primary/30/25 bg-positive/10"
                          : r.status === "failed"
                            ? "border-red-500/25 bg-red-500/5"
                            : "border-border/40 bg-card/30"
                        }`}
                    >
                      {r.status === "passed" ? (
                        <CheckCircle2 className="h-4 w-4 text-positive flex-shrink-0" />
                      ) : r.status === "failed" ? (
                        <XCircle className="h-4 w-4 text-red-700 flex-shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="flex-1 text-sm font-medium text-foreground/90">{r.test_name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.duration_ms && (
                          <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5">
                            {(r.duration_ms / 1000).toFixed(1)}s
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-5 px-1.5 capitalize ${r.status === "passed" ? "border-primary/30/40 text-positive bg-positive/10" :
                              r.status === "failed" ? "border-red-500/40 text-red-700 bg-red-50" : ""
                            }`}
                        >
                          {r.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-border/40 bg-card/30 p-6 text-center text-sm text-muted-foreground">
                  No detailed results available for this run.
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Run history panel (shown on idle screen) ─────────────────────────────────

function RunHistoryPanel() {
  const { data, isLoading } = useRunHistory();
  const runs: RunSummaryItem[] = data?.runs ?? [];
  const [selectedRun, setSelectedRun] = useState<RunSummaryItem | null>(null);

  if (isLoading) return null;
  if (runs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mt-6 max-w-2xl space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground">Recent Test Runs</h2>
        </div>
        <Badge variant="outline" className="text-[10px]">{runs.length} runs</Badge>
      </div>

      <div className="floating-card overflow-hidden rounded-2xl divide-y divide-border/30">
        {runs.slice(0, 10).map((run) => {
          const rate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
          return (
            <div key={run.run_id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
              {/* Status dot */}
              <span className={`h-2 w-2 rounded-full flex-shrink-0 ${run.status === "completed" ? "bg-primary" :
                  run.status === "failed" ? "bg-red-400" :
                    "bg-yellow-400 animate-pulse"
                }`} />

              {/* Commit-hash style run ID */}
              <code className="text-[10px] font-mono text-primary/70 bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded flex-shrink-0">
                {run.run_id.slice(0, 7)}
              </code>

              {/* Pass rate bar */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${rate >= 80 ? "bg-primary" : rate >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0 font-medium">
                    {run.passed}/{run.total} passed
                  </span>
                </div>
              </div>

              {/* Date */}
              {run.started_at && (
                <span className="text-[10px] text-muted-foreground flex-shrink-0 hidden sm:block">
                  {new Date(run.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}

              {/* View details button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[11px] flex-shrink-0 gap-1.5"
                onClick={() => setSelectedRun(run)}
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </Button>
            </div>
          );
        })}
      </div>

      {/* Detail sheet */}
      <RunDetailSheet
        run={selectedRun}
        open={selectedRun !== null}
        onClose={() => setSelectedRun(null)}
      />
    </motion.div>
  );
}

// ── sessionStorage prefill (from ViewEntryTree "Run Test Cases" wizard) ────────

interface LtrPrefill {
  appUrl?: string;
  githubUrl?: string;
}

function readAndClearPrefill(): LtrPrefill | null {
  try {
    const raw = sessionStorage.getItem("ltr_prefill");
    if (!raw) return null;
    sessionStorage.removeItem("ltr_prefill");
    return JSON.parse(raw) as LtrPrefill;
  } catch {
    return null;
  }
}

export default function LiveTestRunner({
  onRunComplete,
  initialGithubUrl,
  initialAppUrl,
}: {
  onRunComplete?: (summary: { passed: number; failed: number; total: number; pass_rate: number }) => void;
  initialGithubUrl?: string;
  initialAppUrl?: string;
} = {}) {
  let pipelinePat: string | undefined;
  try {
    const ctx = usePipelineContext();
    pipelinePat = ctx.githubPat;
  } catch (e) {
    // If used outside of PipelineProvider
  }

  // Read sessionStorage prefill once on mount (from ViewEntryTree wizard)
  const prefill = useMemo(() => readAndClearPrefill(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveGithubUrl = initialGithubUrl ?? prefill?.githubUrl;
  const effectiveAppUrl = initialAppUrl ?? prefill?.appUrl;

  const {
    phase,
    jobData,
    analysis,
    editedTests,
    saveTest,
    runStatus,
    errorMsg,
    handleAnalyze,
    handleExecute,
    handleExecuteDirect,
    handleUploadSpec,
    reset,
    specTargetUrl,
    setSpecTargetUrl,
    isStarting,
    isExecuting,
    isParsingSpec,
    setPhase,
    setAnalysis,
    setEditedTests,
  } = useLiveTesting();

  const activeTargetUrlRef = useRef<string>(effectiveAppUrl || "");

  const [showSuiteSelector, setShowSuiteSelector] = useState(false);
  const [suitePayload, setSuitePayload] = useState<any>(null);
  const [baselineTests, setBaselineTests] = useState<BaselineTest[]>([]);
  const [selectedBaselineIds, setSelectedBaselineIds] = useState<Set<string>>(new Set());
  const [isLoadingBaseline, setIsLoadingBaseline] = useState(false);
  const [baselineSearch, setBaselineSearch] = useState("");
  const [activePageFilter, setActivePageFilter] = useState<string>("All");

  // Fire onRunComplete once when run transitions to done
  const filteredBaselines = baselineTests.filter(bt => {
    const matchSearch = bt.name.toLowerCase().includes(baselineSearch.toLowerCase()) ||
      bt.description?.toLowerCase().includes(baselineSearch.toLowerCase());
    const matchPage = activePageFilter === "All" || bt.page_path === activePageFilter;
    return matchSearch && matchPage;
  });

  const uniquePages = Array.from(new Set(baselineTests.map(t => t.page_path || "/"))).sort();

  const reportedRef = useCallback(() => { }, []);
  if (phase === "done" && runStatus && onRunComplete) {
    const t = runStatus.total ?? 0;
    const p = runStatus.passed ?? 0;
    const f = runStatus.failed ?? 0;
    const key = `${runStatus.run_id}-reported`;
    if (t > 0 && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      onRunComplete({ passed: p, failed: f, total: t, pass_rate: t > 0 ? Math.round((p / t) * 100) : 0 });
    }
  }
  void reportedRef; // suppress unused warning

  return (
    <PageShell size="full" className="space-y-6">
      <PageHeader
        icon={MonitorPlay}
        title="Live Test Runner"
        description="Analyze your app, generate Playwright tests, and execute them in a live browser session."
      />

      <div className="relative">
          <AnimatePresence mode="wait">
            {phase === "idle" && (
              <InputPhase
                key="input"
                onAnalyze={async (g, t, e, p, prefs, numTests, mode, sha, msg, pat) => {
                  activeTargetUrlRef.current = t;
                  handleAnalyze(g, t, e, p, prefs, numTests, mode, sha, msg, pat || pipelinePat);
                  
                  // Silent fetch for baseline so it's ready for the toggle later
                  try {
                    const repoId = await api.getRepoId(g);
                    const repoData = await baselineApi.getRepoTests(repoId);
                    if (repoData && repoData.tests.length > 0) {
                      setBaselineTests(repoData.tests);
                    }
                  } catch (err) {
                    console.error("Failed to fetch baseline:", err);
                  }
                }}
                onUploadSpec={(file, targetUrl, email, password) => handleUploadSpec(file, targetUrl, email, password)}
                isAnalyzing={isStarting}
                isParsing={isParsingSpec}
                errorMsg={errorMsg}
                initialGithubUrl={effectiveGithubUrl}
                initialAppUrl={effectiveAppUrl}
              />
            )}

            {phase === "analyzing" && (
              <AnalyzingPhase key="analyzing" jobData={jobData} />
            )}

            {phase === "ready" && analysis && (
              <ReadyPhase
                key="ready"
                analysis={analysis}
                editedTests={editedTests}
                onExecute={(combined) => {
                  if (combined && selectedBaselineIds.size > 0) {
                    const target = analysis.tech_stack.includes("Spec") 
                      ? (specTargetUrl || "") 
                      : (analysis.target_url || activeTargetUrlRef.current);
                    handleExecuteDirect(combined as any, target, undefined, undefined);
                  } else {
                    handleExecute();
                  }
                }}
                onReset={reset}
                onSave={saveTest}
                isExecuting={isExecuting}
                errorMsg={errorMsg}
                specTargetUrl={specTargetUrl}
                onSpecTargetUrlChange={setSpecTargetUrl}
                baselineTests={baselineTests}
                selectedBaselineIds={selectedBaselineIds}
                onBaselineToggle={(checked) => {
                  if (checked) setShowSuiteSelector(true);
                  else setSelectedBaselineIds(new Set());
                }}
              />
            )}

            {(phase === "executing" || phase === "done") && (
              <ExecutionPhase
                key="execution"
                runStatus={runStatus}
                onReset={reset}
                phase={phase}
                analysis={analysis}
              />
            )}
          </AnimatePresence>

          {phase === "idle" && <RunHistoryPanel />}

          {/* ── Baseline Suite Selection Modal ────────────────────────────────────── */}
          <Dialog open={showSuiteSelector} onOpenChange={setShowSuiteSelector}>
            <DialogContent className="max-w-5xl p-0 overflow-hidden border-border/40 shadow-2xl backdrop-blur-3xl rounded-[2.5rem]">
              <div className="p-8 bg-primary/5 border-b border-border/20">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-4 text-xl font-black uppercase tracking-widest">
                    <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 shadow-inner">
                      <Layers className="h-6 w-6 text-primary" />
                    </div>
                    Repo Baseline Inventory
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground/70 font-medium ml-14">
                    We found <span className="text-foreground font-bold">{baselineTests.length} legacy testcases</span> in this repository. Select units to augment your run.
                  </DialogDescription>
                </DialogHeader>

                {phase !== "ready" && (
                  <div className="mt-8 space-y-4 ml-14">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <button
                        onClick={() => {
                          const mapped = baselineTests.map(bt => ({
                            id: bt.test_id,
                            analysis_id: "baseline",
                            name: bt.name,
                            description: bt.description,
                            page_name: bt.page_path || "/",
                            severity: bt.severity,
                            steps: bt.steps.map(s => ({
                              action: s.action,
                              selector: s.target,
                              value: s.value,
                              description: s.assertion || ""
                            }))
                          } as PlaywrightTestCase));

                          setAnalysis({
                            analysis_id: "baseline",
                            target_url: activeTargetUrlRef.current,
                            summary: "Merged Suite: Global Baseline",
                            tech_stack: "Global Baseline",
                            pages: [],
                            user_flows: [],
                            tests: mapped
                          });
                          setEditedTests(mapped);
                          setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)));
                          setPhase("ready");
                          setShowSuiteSelector(false);
                        }}
                        className="flex items-center gap-4 p-4 rounded-2xl border border-border/50 bg-background/50 hover:bg-muted/40 transition-all group text-left"
                      >
                        <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform flex-shrink-0">
                          <Play className="h-5 w-5 fill-current" />
                        </div>
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-widest">Run Full Baseline</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">Execute existing {baselineTests.length} production units.</p>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setShowSuiteSelector(false);
                          // Using a fallback trigger here if needed, but usually onAnalyze already called handleAnalyze
                          // So this button might just be "Continue to AI Generation"
                          toast.info("AI Analysis already in progress...");
                        }}
                        className="flex items-center gap-4 p-4 rounded-2xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all group text-left shadow-[0_0_20px_rgba(var(--primary),0.05)]"
                      >
                        <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary group-hover:scale-110 transition-transform flex-shrink-0">
                          <AiIcon className="h-5 w-5 fill-current" />
                        </div>
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-widest text-primary">Generate Expansion</p>
                          <p className="text-[10px] text-primary/60 mt-0.5 font-medium">Use AI to discover and test new flows.</p>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-8 space-y-4 ml-14">

                  <div className="flex items-center gap-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/40" />
                      <Input
                        placeholder="Filter baseline by identity or description..."
                        className="pl-12 h-12 bg-background border-border/40 rounded-2xl shadow-sm focus-visible:ring-primary/20 transition-all font-medium text-sm"
                        value={baselineSearch}
                        onChange={(e) => setBaselineSearch(e.target.value)}
                      />
                    </div>

                    <Select value={activePageFilter} onValueChange={setActivePageFilter}>
                      <SelectTrigger className="w-[240px] h-12 bg-background border-border/40 rounded-2xl shadow-sm focus:ring-primary/20 font-black uppercase tracking-widest text-[10px]">
                        <div className="flex items-center gap-2">
                          <Filter className="h-3.5 w-3.5 text-primary/60" />
                          <SelectValue placeholder="Segment by Page" />
                        </div>
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-border/40 shadow-2xl backdrop-blur-xl">
                        <SelectItem value="All" className="text-[10px] font-black uppercase tracking-widest py-3">Global Stream</SelectItem>
                        {uniquePages.map(page => (
                          <SelectItem key={page} value={page} className="text-[10px] font-black uppercase tracking-widest py-3">
                            {page === "/" ? "App Root" : page.replace(/^\//, "")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="px-8 py-6">
                <ScrollArea className="h-[450px] pr-6">
                  <div className="space-y-3 ml-14">
                    {filteredBaselines.length === 0 ? (
                      <div className="py-24 text-center space-y-4">
                        <div className="p-4 w-16 h-16 rounded-3xl bg-muted/20 border border-dashed border-border mx-auto flex items-center justify-center">
                          <Search className="h-8 w-8 text-muted-foreground/30" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">Zero Units Resolved</p>
                          <p className="text-xs text-muted-foreground/60 font-medium">Refine your query parameters.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredBaselines.map(bt => {
                          const isSelected = selectedBaselineIds.has(bt.test_id);
                          return (
                            <div
                              key={bt.test_id}
                              className={cn(
                                "group relative flex items-start gap-4 p-5 rounded-[1.75rem] border transition-all cursor-pointer",
                                isSelected
                                  ? "bg-primary/5 border-primary/40 shadow-inner"
                                  : "bg-muted/5 border-border/40 hover:border-primary/20 hover:bg-muted/10"
                              )}
                              onClick={() => {
                                setSelectedBaselineIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(bt.test_id)) next.delete(bt.test_id);
                                  else next.add(bt.test_id);
                                  return next;
                                });
                              }}
                            >
                              <Checkbox
                                id={bt.test_id}
                                checked={isSelected}
                                className={cn(
                                  "mt-1 rounded-md transition-transform duration-300",
                                  isSelected && "scale-110"
                                )}
                              />
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-3">
                                  <span className="text-[13px] font-black truncate text-foreground/90 uppercase tracking-tight">
                                    {bt.name}
                                  </span>
                                  <Badge variant="outline" className={cn(
                                    "text-[8px] h-4 px-1.5 uppercase font-black shrink-0 tracking-widest rounded-md",
                                    bt.severity.toLowerCase() === "critical" ? "border-red-500/50 text-red-700 bg-red-400/5" :
                                      bt.severity.toLowerCase() === "high" ? "border-[var(--color-status-warning)]/30 text-[var(--color-warning)] bg-[var(--color-warning-bg)]" :
                                        "border-muted-foreground/30 text-muted-foreground"
                                  )}>
                                    {bt.severity.slice(0, 3)}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground/60 font-medium">
                                  <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-0.5 rounded-lg font-mono text-[9px] border border-border/10">
                                    <Code2 className="h-3 w-3 opacity-40" />
                                    {bt.page_path || "/"}
                                  </div>
                                </div>
                                {bt.description && (
                                  <p className="text-[10px] text-muted-foreground/50 italic line-clamp-1 border-l border-border/20 pl-2">{bt.description}</p>
                                )}
                              </div>
                              {isSelected && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="absolute -right-1 -top-1"
                                >
                                  <div className="bg-primary text-primary-foreground h-5 w-5 p-0 flex items-center justify-center rounded-full border-2 border-background shadow-2xl">
                                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="p-8 pt-4 bg-muted/20 border-t border-border/20 backdrop-blur-md">
                <div className="flex items-center justify-between mb-6 ml-14">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.25em] mb-1">Queue Configuration</span>
                    <div className="text-xs font-bold text-foreground">
                      <span className="text-primary text-lg font-black mr-1.5">{selectedBaselineIds.size}</span> Units selected for synchronization
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-background/80 rounded-xl px-4"
                      onClick={() => setSelectedBaselineIds(new Set())}
                    >
                      Clear Selection
                    </Button>
                    <div className="w-px h-4 bg-border" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 rounded-xl px-4"
                      onClick={() => setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)))}
                    >
                      Select All
                    </Button>
                  </div>
                </div>
                <div className="ml-14 flex items-center gap-4">
                  <Button variant="outline" className="h-12 px-6 rounded-2xl font-black uppercase tracking-widest text-[11px]" onClick={() => setShowSuiteSelector(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1 font-black uppercase tracking-widest h-12 shadow-[0_10px_30px_rgba(var(--primary),0.2)] rounded-2xl text-[11px]" onClick={() => {
                    if (phase === "ready") {
                      setShowSuiteSelector(false);
                      return;
                    }

                    const selected = baselineTests.filter(bt => selectedBaselineIds.has(bt.test_id));
                    if (selected.length === 0) {
                      toast.error("Please select at least one test or choose a preset.");
                      return;
                    }
                    const mapped = selected.map(bt => ({
                      id: bt.test_id,
                      analysis_id: "baseline",
                      name: bt.name,
                      description: bt.description,
                      page_name: bt.page_path || "/",
                      severity: bt.severity,
                      steps: bt.steps.map(s => ({
                        action: s.action,
                        selector: s.target,
                        value: s.value,
                        description: s.assertion || ""
                      }))
                    } as PlaywrightTestCase));

                    setAnalysis({
                      analysis_id: "hybrid",
                      target_url: activeTargetUrlRef.current,
                      summary: `Selection Mode: ${mapped.length} tests chosen`,
                      tech_stack: "Hybrid Selection",
                      pages: [],
                      user_flows: [],
                      tests: mapped
                    });
                    setEditedTests(mapped);
                    setPhase("ready");
                    setShowSuiteSelector(false);
                  }}>
                    {phase === "ready" ? `Integrate ${selectedBaselineIds.size} Units` : `Start Live Simulation (${selectedBaselineIds.size} Units)`}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
    </PageShell>
  );
}
