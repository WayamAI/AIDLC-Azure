import { useState } from "react";
import {
  FlaskConical, Play, Loader2, ChevronDown, ChevronRight,
  ArrowRight, Pencil, Save, X, Plus, Trash2, Download,
  Globe, GitCommit, Layers, Database, CheckCircle2, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { api } from "@/lib/api";
import {
  useGeneratePlaywrightTests,
  useGeneratePlaywrightBatch,
  useGeneratePlaywrightApp,
  useGeneratePlaywrightCommit,
  useExportPlaywrightTests,
  useSaveTestSuite,
  useListTestSuites,
  useDeleteTestSuite,
} from "@/hooks/use-test-gen";
import { useGitLog } from "@/hooks/use-git";
import type { WorkspacePlaywrightTest, WorkspaceTestStep, TestSuiteInfo } from "@/lib/api";
import { toast } from "sonner";
import { BRAND_NAME } from "@/lib/brand";

// ── Constants ─────────────────────────────────────────────────────────────────

const STEP_ACTIONS = [
  "navigate", "click", "fill", "assert_text", "screenshot", "wait",
  "hover", "hover_and_click", "press", "check", "uncheck",
  "select_option", "dblclick", "type_into", "scroll", "clear",
] as const;

const SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;

const severityClass: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-700 border-red-200",
  High:     "bg-orange-500/20 text-orange-700 border-orange-200",
  Medium:   "bg-yellow-500/20 text-amber-700 border-amber-200",
  Low:      "bg-blue-500/20 text-sky-700 border-sky-200",
};

type Scope = "single_file" | "entire_app" | "commits" | "virtual_files";

// ── Step row ──────────────────────────────────────────────────────────────────

function stepActionLabel(action: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    navigate:        { label: "Navigate",    color: "text-sky-700" },
    click:           { label: "Click",       color: "text-positive" },
    fill:            { label: "Fill",        color: "text-purple-400" },
    assert_text:     { label: "Assert",      color: "text-amber-700" },
    screenshot:      { label: "Screenshot",  color: "text-cyan-400" },
    wait:            { label: "Wait",        color: "text-gray-400" },
    hover:           { label: "Hover",       color: "text-pink-400" },
    hover_and_click: { label: "Hover+Click", color: "text-orange-700" },
    press:           { label: "Press",       color: "text-indigo-400" },
    check:           { label: "Check",       color: "text-teal-400" },
    uncheck:         { label: "Uncheck",     color: "text-teal-400" },
    select_option:   { label: "Select",      color: "text-violet-400" },
    dblclick:        { label: "DblClick",    color: "text-positive" },
    type_into:       { label: "Type",        color: "text-purple-300" },
    scroll:          { label: "Scroll",      color: "text-slate-400" },
    clear:           { label: "Clear",       color: "text-gray-400" },
    drag_and_drop:   { label: "Drag",        color: "text-rose-400" },
  };
  return map[action] ?? { label: action, color: "text-muted-foreground" };
}

function StepRow({ step, index }: { step: WorkspaceTestStep; index: number }) {
  const { label, color } = stepActionLabel(step.action);
  return (
    <div className="flex items-start gap-2 text-xs py-1">
      <span className="text-muted-foreground/50 w-5 text-right flex-shrink-0 mt-0.5 font-mono text-[10px]">
        {index + 1}
      </span>
      <span className={`w-[72px] text-right font-mono text-[10px] flex-shrink-0 mt-0.5 ${color}`}>
        {label}
      </span>
      <ArrowRight className="h-3 w-3 text-border flex-shrink-0 mt-0.5" />
      <span className="text-muted-foreground flex-1 leading-relaxed">{step.description}</span>
      {step.selector && (
        <code className="text-[9px] text-muted-foreground/60 font-mono truncate max-w-[80px] flex-shrink-0">
          {step.selector}
        </code>
      )}
    </div>
  );
}

function StepEditorRow({
  step, index, onChange, onDelete,
}: {
  step: WorkspaceTestStep;
  index: number;
  onChange: (s: WorkspaceTestStep) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded border border-border/40 bg-muted/20 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground w-5 text-right font-mono">{index + 1}</span>
        <Select value={step.action} onValueChange={(v) => onChange({ ...step, action: v })}>
          <SelectTrigger className="h-6 text-[10px] w-28 flex-shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STEP_ACTIONS.map((a) => (
              <SelectItem key={a} value={a} className="text-[11px]">{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button onClick={onDelete} className="ml-auto text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <Input
        value={step.description}
        onChange={(e) => onChange({ ...step, description: e.target.value })}
        placeholder="Description"
        className="h-6 text-[11px]"
      />
      {!["screenshot", "scroll"].includes(step.action) && (
        <div className="flex gap-1">
          {step.action !== "navigate" && (
            <Input
              value={step.selector ?? ""}
              onChange={(e) => onChange({ ...step, selector: e.target.value || null })}
              placeholder="Selector"
              className="h-6 text-[10px] font-mono flex-1"
            />
          )}
          {["navigate", "fill", "assert_text", "wait", "press", "type_into", "select_option", "hover_and_click"].includes(step.action) && (
            <Input
              value={step.value ?? ""}
              onChange={(e) => onChange({ ...step, value: e.target.value || null })}
              placeholder="Value"
              className="h-6 text-[10px] flex-1"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Test card ─────────────────────────────────────────────────────────────────

function TestCard({
  test, onUpdate, onDelete,
}: {
  test: WorkspacePlaywrightTest;
  onUpdate: (updated: WorkspacePlaywrightTest) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkspacePlaywrightTest>(test);
  const sev = test.severity || "Medium";

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({ ...test, steps: test.steps.map((s) => ({ ...s })) });
    setEditing(true);
    setOpen(true);
  };

  const cancelEdit = () => { setDraft({ ...test }); setEditing(false); };
  const saveEdit = () => { onUpdate(draft); setEditing(false); };

  const updateStep = (i: number, s: WorkspaceTestStep) => {
    const steps = [...draft.steps]; steps[i] = s; setDraft({ ...draft, steps });
  };
  const deleteStep = (i: number) => setDraft({ ...draft, steps: draft.steps.filter((_, idx) => idx !== i) });
  const addStep = () => setDraft({
    ...draft,
    steps: [...draft.steps, { action: "click", selector: null, value: null, description: "" }],
  });

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => !editing && setOpen((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{test.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{test.page_name}</p>
        </div>
        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 flex-shrink-0 ${severityClass[sev] ?? ""}`}>
          {sev}
        </Badge>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">{test.steps.length} steps</span>
        <button onClick={startEdit} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-1">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(test.id); }} className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
          <Trash2 className="h-3 w-3" />
        </button>
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-border/30 pt-2 space-y-1.5">
          {editing ? (
            <>
              <div className="space-y-1.5 mb-2">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Test name" className="h-7 text-xs" />
                <div className="flex gap-1.5">
                  <Input value={draft.page_name} onChange={(e) => setDraft({ ...draft, page_name: e.target.value })} placeholder="Page name" className="h-7 text-xs flex-1" />
                  <Select value={draft.severity} onValueChange={(v) => setDraft({ ...draft, severity: v })}>
                    <SelectTrigger className="h-7 text-xs w-24 flex-shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className="text-xs min-h-[48px] resize-none" />
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Steps</p>
              <div className="space-y-1.5">
                {draft.steps.map((step, i) => (
                  <StepEditorRow key={i} step={step} index={i} onChange={(s) => updateStep(i, s)} onDelete={() => deleteStep(i)} />
                ))}
              </div>
              <button onClick={addStep} className="flex items-center gap-1 text-[10px] text-primary mt-1 hover:underline">
                <Plus className="h-3 w-3" /> Add step
              </button>
              <div className="flex gap-1.5 mt-2">
                <Button size="sm" className="h-6 text-[10px] px-2" onClick={saveEdit}><Save className="h-3 w-3 mr-1" /> Save</Button>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={cancelEdit}><X className="h-3 w-3 mr-1" /> Cancel</Button>
              </div>
            </>
          ) : (
            <>
              {test.description && <p className="text-[10px] text-muted-foreground">{test.description}</p>}
              <div className="space-y-0.5">
                {test.steps.map((step, i) => <StepRow key={i} step={step} index={i} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Saved suites list ─────────────────────────────────────────────────────────

function SavedSuites({
  workspaceId,
  onLoad,
}: {
  workspaceId: string;
  onLoad: (tests: WorkspacePlaywrightTest[]) => void;
}) {
  const { data: suites, isLoading } = useListTestSuites(workspaceId);
  const deleteMutation = useDeleteTestSuite();
  const [loadingSuiteId, setLoadingSuiteId] = useState<string | null>(null);

  const handleLoad = async (suite: TestSuiteInfo) => {
    setLoadingSuiteId(suite.suite_id);
    try {
      const full = await api.getTestSuite(suite.suite_id);
      onLoad(full.tests ?? []);
      toast.success(`Loaded "${suite.name}"`);
    } catch {
      toast.error("Failed to load suite");
    } finally {
      setLoadingSuiteId(null);
    }
  };

  if (isLoading) return <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!suites?.length) return <p className="text-[10px] text-muted-foreground text-center py-3">No saved suites yet</p>;

  const scopeLabel: Record<string, string> = {
    entire_app: "App", commits: "Commit", virtual_files: "Virtual", single_file: "File",
  };

  return (
    <div className="space-y-1">
      {suites.map((s) => (
        <div key={s.suite_id} className="flex items-center gap-1.5 rounded border border-border/40 bg-muted/10 px-2 py-1.5">
          <Badge variant="outline" className="text-[9px] px-1 py-0 flex-shrink-0">{scopeLabel[s.scope] ?? s.scope}</Badge>
          <span className="text-[11px] flex-1 truncate font-medium">{s.name}</span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{s.test_count} tests</span>
          <button
            onClick={() => handleLoad(s)}
            disabled={loadingSuiteId === s.suite_id}
            className="text-primary hover:text-primary/80 transition-colors flex-shrink-0"
            title="Load tests"
          >
            {loadingSuiteId === s.suite_id
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Play className="h-3 w-3" />
            }
          </button>
          <button
            onClick={() => deleteMutation.mutate({ suite_id: s.suite_id, workspace_id: workspaceId })}
            className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
            title="Delete suite"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TestGenerator({
  initialScope,
  initialCommitSha,
  onTestsGenerated,
}: {
  initialScope?: Scope;
  initialCommitSha?: string;
  onTestsGenerated?: (tests: WorkspacePlaywrightTest[]) => void;
} = {}) {
  const { workspace, openTabs, activeTab, openFile } = useWorkspaceContext();
  const [scope, setScope] = useState<Scope>(initialScope ?? "single_file");
  const [targetUrl, setTargetUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [tests, setTests] = useState<WorkspacePlaywrightTest[]>([]);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string>(initialCommitSha ?? "");
  const [showSaved, setShowSaved] = useState(false);
  const [suiteName, setSuiteName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const activeTabObj = openTabs.find((t) => t.path === activeTab);
  const dirtyTabs = openTabs.filter((t) => t.isDirty);

  const gitLog = useGitLog(workspace?.workspace_id ?? null);
  const commits = Array.isArray(gitLog.data)
    ? gitLog.data
    : gitLog.data?.commits ?? [];

  const generateSingle = useGeneratePlaywrightTests();
  const generateBatch = useGeneratePlaywrightBatch();
  const generateApp = useGeneratePlaywrightApp();
  const generateCommit = useGeneratePlaywrightCommit();
  const exportMutation = useExportPlaywrightTests();
  const saveMutation = useSaveTestSuite();

  const isGenerating = generateSingle.isPending || generateBatch.isPending || generateApp.isPending || generateCommit.isPending;

  const handleGenerate = async () => {
    if (!workspace) { toast.error("Connect a repository first"); return; }
    const url = targetUrl.trim() || undefined;

    try {
      let result: { tests: WorkspacePlaywrightTest[] } | undefined;

      if (scope === "single_file") {
        if (!activeTabObj) { toast.error("Open a file first"); return; }
        result = await generateSingle.mutateAsync({
          workspace_id: workspace.workspace_id,
          file_path: activeTabObj.path,
          content: activeTabObj.content,
          target_url: url,
        });
      } else if (scope === "entire_app") {
        result = await generateApp.mutateAsync({ workspace_id: workspace.workspace_id, target_url: url });
      } else if (scope === "commits") {
        if (!selectedCommitSha) { toast.error("Select a commit first"); return; }
        result = await generateCommit.mutateAsync({
          workspace_id: workspace.workspace_id,
          commit_sha: selectedCommitSha,
          target_url: url,
        });
      } else if (scope === "virtual_files") {
        if (!dirtyTabs.length) { toast.error("No modified files in editor"); return; }
        result = await generateBatch.mutateAsync({
          files: dirtyTabs.map((t) => ({ file_path: t.path, content: t.content })),
          target_url: url,
        });
      }

      if (result) {
        setTests(result.tests);
        onTestsGenerated?.(result.tests);
        toast.success(`Generated ${result.tests.length} test cases`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Test generation failed");
    }
  };

  const handleExport = async () => {
    if (!workspace || !tests.length) return;
    try {
      const result = await exportMutation.mutateAsync({
        workspace_id: workspace.workspace_id,
        tests,
        target_url: targetUrl.trim() || undefined,
      });
      openFile(result.file_path, "typescript", result.content);
      toast.success("Opened spec file in editor commit it to save");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Export failed");
    }
  };

  const handleDownload = () => {
    if (!tests.length) return;
    // Build .spec.ts content inline (matches backend export logic)
    const base = targetUrl.trim() || "http://localhost:3000";
    const lines: string[] = [
      "import { test, expect } from '@playwright/test';",
      "",
      `// Base URL: ${base}`,
      `// Generated by ${BRAND_NAME} AI Workspace`,
      "",
    ];
    for (const tc of tests) {
      lines.push(`test('${tc.name.replace(/'/g, "\\'")}', async ({ page }) => {`);
      if (tc.description) lines.push(`  // ${tc.description}`);
      for (const step of tc.steps) {
        const sel = (step.selector || "").replace(/'/g, "\\'");
        const val = step.value || "";
        if (step.action === "navigate") lines.push(`  await page.goto('${val.startsWith("http") ? val : base + val}'); // ${step.description}`);
        else if (step.action === "click") lines.push(`  await page.click('${sel}'); // ${step.description}`);
        else if (step.action === "fill") lines.push(`  await page.fill('${sel}', '${val}'); // ${step.description}`);
        else if (step.action === "assert_text") lines.push(`  await expect(page.locator('body')).toContainText('${val}'); // ${step.description}`);
        else if (step.action === "screenshot") lines.push(`  await page.screenshot(); // ${step.description}`);
        else if (step.action === "wait") lines.push(`  await page.waitForTimeout(${(parseFloat(val) || 2) * 1000}); // ${step.description}`);
        else lines.push(`  // TODO: ${step.action} - ${step.description}`);
      }
      lines.push("});");
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "generated.spec.ts";
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Downloaded generated.spec.ts");
  };

  const handleSave = async () => {
    if (!workspace || !tests.length) return;
    const name = suiteName.trim() || `Suite ${new Date().toLocaleTimeString()}`;
    try {
      await saveMutation.mutateAsync({
        workspace_id: workspace.workspace_id,
        name,
        scope,
        tests,
        target_url: targetUrl.trim() || undefined,
        commit_sha: scope === "commits" ? selectedCommitSha : undefined,
      });
      toast.success("Suite saved to database");
      setShowSaveDialog(false);
      setSuiteName("");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Save failed");
    }
  };

  const updateTest = (updated: WorkspacePlaywrightTest) =>
    setTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  const deleteTest = (id: string) => {
    setTests((prev) => prev.filter((t) => t.id !== id));
    toast.success("Test removed");
  };

  const addBlankTest = () => {
    const blank: WorkspacePlaywrightTest = {
      id: crypto.randomUUID(),
      analysis_id: "workspace",
      name: "New test case",
      description: "",
      page_name: activeTabObj?.path.split("/").pop()?.replace(/\.\w+$/, "") ?? "Page",
      severity: "Medium",
      steps: [
        { action: "navigate", selector: null, value: "/", description: "Navigate to the page" },
        { action: "screenshot", selector: null, value: null, description: "Capture initial state" },
      ],
    };
    setTests((prev) => [...prev, blank]);
  };

  const SCOPES: { id: Scope; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "single_file", label: "File", icon: <FlaskConical className="h-3 w-3" />, desc: "Active file in editor" },
    { id: "entire_app",  label: "App",  icon: <Layers className="h-3 w-3" />,       desc: "Scan entire codebase" },
    { id: "commits",     label: "Commits", icon: <GitCommit className="h-3 w-3" />, desc: "Changed files in a commit" },
    { id: "virtual_files", label: "Virtual", icon: <Play className="h-3 w-3" />,    desc: "AI-modified files in editor" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header / toolbar */}
      <div className="p-2.5 border-b border-border/50 space-y-2 flex-shrink-0">
        {/* Title + URL toggle */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Playwright Tests</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSaved((v) => !v)}
              className={cn("flex items-center gap-1 text-[10px] transition-colors", showSaved ? "text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <BookOpen className="h-3 w-3" />
              Saved
            </button>
            <button
              onClick={() => setShowUrlInput((v) => !v)}
              className={cn("flex items-center gap-1 text-[10px] transition-colors", showUrlInput ? "text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <Globe className="h-3 w-3" />
              {targetUrl ? (() => { try { return new URL(targetUrl.startsWith("http") ? targetUrl : `http://${targetUrl}`).hostname; } catch { return "URL"; } })() : "URL"}
            </button>
          </div>
        </div>

        {/* URL input */}
        {showUrlInput && (
          <Input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://yourapp.com (optional)"
            className="h-7 text-xs"
          />
        )}

        {/* Scope selector */}
        <div className="grid grid-cols-4 gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              title={s.desc}
              className={cn(
                "flex flex-col items-center gap-0.5 py-1.5 rounded border text-[9px] transition-colors",
                scope === s.id
                  ? "bg-primary/15 border-primary/50 text-primary"
                  : "bg-muted/20 border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {s.icon}
              <span className="font-medium">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Scope-specific controls */}
        {scope === "single_file" && !activeTabObj && (
          <p className="text-[10px] text-muted-foreground">Open a file in the editor to generate tests for it.</p>
        )}

        {scope === "entire_app" && (
          <p className="text-[10px] text-muted-foreground">AI will scan your codebase for pages and components and generate tests automatically.</p>
        )}

        {scope === "commits" && (
          <div className="space-y-1">
            {gitLog.isLoading ? (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading commits…
              </div>
            ) : commits.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No commits found in this workspace.</p>
            ) : (
              <Select value={selectedCommitSha} onValueChange={setSelectedCommitSha}>
                <SelectTrigger className="h-7 text-[10px]">
                  <SelectValue placeholder="Select a commit…" />
                </SelectTrigger>
                <SelectContent>
                  {commits.map((c: any) => (
                    <SelectItem key={c.sha} value={c.sha} className="text-[10px]">
                      <span className="font-mono text-muted-foreground mr-1.5">{c.short_sha}</span>
                      <span className="truncate">{c.message}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {scope === "virtual_files" && (
          <div className="space-y-1">
            {dirtyTabs.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No modified files in editor. Edit or generate code via Copilot first.</p>
            ) : (
              <div className="space-y-0.5">
                {dirtyTabs.map((t) => (
                  <div key={t.path} className="flex items-center gap-1.5 text-[10px]">
                    <div className="h-1.5 w-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                    <span className="text-muted-foreground truncate font-mono">{t.path}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Generate button */}
        <Button
          className="w-full h-7 text-xs"
          onClick={handleGenerate}
          disabled={
            isGenerating ||
            (scope === "single_file" && !activeTabObj) ||
            (scope === "commits" && !selectedCommitSha) ||
            (scope === "virtual_files" && dirtyTabs.length === 0)
          }
        >
          {isGenerating
            ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Generating…</>
            : <><FlaskConical className="h-3 w-3 mr-1.5" />Generate Tests</>
          }
        </Button>

        {/* Action buttons (after generation) */}
        {tests.length > 0 && (
          <>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={addBlankTest}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={handleExport} disabled={exportMutation.isPending}>
                {exportMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <BookOpen className="h-3 w-3 mr-1" />}
                .spec.ts
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={handleDownload}>
                <Download className="h-3 w-3 mr-1" /> Download
              </Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={() => setShowSaveDialog(true)}>
                <Database className="h-3 w-3 mr-1" /> Save
              </Button>
            </div>

            {/* Save dialog */}
            {showSaveDialog && (
              <div className="rounded border border-border/50 bg-muted/20 p-2 space-y-1.5">
                <p className="text-[10px] font-medium">Save suite to DB</p>
                <Input
                  value={suiteName}
                  onChange={(e) => setSuiteName(e.target.value)}
                  placeholder="Suite name (optional)"
                  className="h-6 text-[10px]"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                />
                <div className="flex gap-1">
                  <Button size="sm" className="h-6 text-[10px] px-2 flex-1" onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle2 className="h-3 w-3 mr-1" />Save</>}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setShowSaveDialog(false)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Saved suites panel */}
      {showSaved && workspace && (
        <div className="border-b border-border/50 p-2.5 space-y-1.5 flex-shrink-0">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Saved Suites</p>
          <SavedSuites workspaceId={workspace.workspace_id} onLoad={(loaded) => { setTests(loaded); setShowSaved(false); }} />
        </div>
      )}

      {/* Test list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2.5 space-y-2">
          {tests.length === 0 && !isGenerating && (
            <div className="text-center py-8 space-y-2">
              <FlaskConical className="h-8 w-8 text-muted-foreground/30 mx-auto" />
              <p className="text-xs text-muted-foreground">
                {scope === "single_file" && activeTabObj && "Click Generate Tests to create tests for this file"}
                {scope === "single_file" && !activeTabObj && "Open a file to generate tests"}
                {scope === "entire_app" && "Click Generate to scan the entire app"}
                {scope === "commits" && !selectedCommitSha && "Select a commit, then click Generate"}
                {scope === "commits" && selectedCommitSha && "Click Generate to create tests for this commit's changes"}
                {scope === "virtual_files" && "Tests will be generated for AI-modified files in your editor"}
              </p>
            </div>
          )}

          {isGenerating && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">
                {scope === "entire_app" ? "Scanning codebase and generating tests…" : "AI is analyzing your code…"}
              </p>
            </div>
          )}

          {tests.length > 0 && (
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-1 pb-1">
              <span className="font-medium text-foreground">{tests.length} tests</span>
              {(["Critical", "High", "Medium", "Low"] as const).map((sev) => {
                const count = tests.filter((t) => t.severity === sev).length;
                if (!count) return null;
                return <span key={sev} className={severityClass[sev].split(" ")[1]}>{count} {sev}</span>;
              })}
              <span className="ml-auto">{tests.reduce((acc, t) => acc + t.steps.length, 0)} steps total</span>
            </div>
          )}

          {tests.map((test) => (
            <TestCard key={test.id} test={test} onUpdate={updateTest} onDelete={deleteTest} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
