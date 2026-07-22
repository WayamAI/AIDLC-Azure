import React, { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  Loader2,
  X,
  TestTube,
  BookOpen,
  GitBranch,
  Link2,
  Link2Off,
  Download,
  Pencil,
  Save,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  useUploadDoc,
  useGenerateFromDocs,
} from "@/hooks/use-impact";
import type {
  DocScenario,
  ImpactPlaywrightTest,
  ImpactPlaywrightStep,
} from "@/lib/api";
import { AiIcon } from "@/lib/icons";

// ── Drag-and-Drop Upload Zone ─────────────────────────────────────────────────

interface UploadZoneProps {
  onFile: (file: File) => void;
  isLoading: boolean;
  acceptedFile: File | null;
  onClear: () => void;
}

function UploadZone({ onFile, isLoading, acceptedFile, onClear }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (acceptedFile) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <FileText className="h-8 w-8 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="truncate font-medium text-sm text-foreground">{acceptedFile.name}</p>
          <p className="text-xs text-muted-foreground">{formatSize(acceptedFile.size)}</p>
        </div>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={onClear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors cursor-pointer ${
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium text-sm text-foreground">Drop a document here</p>
      <p className="mt-1 text-xs text-muted-foreground">
        PDF, DOCX, TXT, Markdown, OpenAPI/JSON up to 10 MB
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".txt,.md,.markdown,.json,.yaml,.yml,.pdf,.docx,.doc,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

// ── Scenario Card ─────────────────────────────────────────────────────────────

function ScenarioCard({
  scenario,
  index,
}: {
  scenario: DocScenario;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const priorityColor: Record<string, string> = {
    high: "destructive",
    medium: "secondary",
    low: "outline",
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{scenario.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{scenario.description}</p>
        </div>
        <Badge
          variant={priorityColor[scenario.priority] as "destructive" | "secondary" | "outline"}
          className="shrink-0 text-[10px]"
        >
          {scenario.priority}
        </Badge>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Acceptance Criteria
          </p>
          <ul className="space-y-1">
            {scenario.acceptance_criteria.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Live Runner-style test card ──────────────────────────────────────────────

const severityClass: Record<string, string> = {
  Critical: "bg-red-500/20 text-red-700 border-red-200",
  High: "bg-orange-500/20 text-orange-700 border-orange-200",
  Medium: "bg-yellow-500/20 text-amber-700 border-amber-200",
  Low: "bg-blue-500/20 text-sky-700 border-sky-200",
};

function stepActionLabel(action: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    navigate: { label: "Navigate", color: "text-sky-700" },
    click: { label: "Click", color: "text-positive" },
    fill: { label: "Fill", color: "text-purple-400" },
    assert_text: { label: "Assert", color: "text-amber-700" },
    screenshot: { label: "Screenshot", color: "text-cyan-400" },
    wait: { label: "Wait", color: "text-gray-400" },
    hover: { label: "Hover", color: "text-pink-400" },
    hover_and_click: { label: "Hover+Click", color: "text-orange-700" },
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

function DocPlaywrightTestCard({
  test,
  onSave,
}: {
  test: ImpactPlaywrightTest;
  onSave: (updated: ImpactPlaywrightTest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ImpactPlaywrightTest>(test);
  const sev = test.severity || "Medium";

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({ ...test, steps: test.steps.map((s) => ({ ...s })) });
    setEditing(true);
    setOpen(true);
  };

  const cancelEdit = () => {
    setDraft({ ...test, steps: test.steps.map((s) => ({ ...s })) });
    setEditing(false);
  };

  const saveEdit = () => {
    onSave(draft);
    setEditing(false);
  };

  const updateStep = (idx: number, field: keyof ImpactPlaywrightStep, value: string) => {
    setDraft((prev) => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], [field]: value || null } as ImpactPlaywrightStep;
      return { ...prev, steps };
    });
  };

  const removeStep = (idx: number) => {
    setDraft((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }));
  };

  const addStep = () => {
    setDraft((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        { action: "screenshot", selector: null, value: null, description: "New step" },
      ],
    }));
  };

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
            <p className="text-sm font-medium truncate">{test.name}</p>
          )}
          <p className="text-[11px] text-muted-foreground truncate">{editing ? draft.page_name : test.page_name}</p>
        </div>
        {editing ? (
          <select
            value={draft.severity}
            onChange={(e) => setDraft((p) => ({ ...p, severity: e.target.value }))}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] rounded border border-border/50 bg-background px-1.5 py-0.5 flex-shrink-0"
          >
            {["Critical", "High", "Medium", "Low"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <Badge variant="outline" className={`text-[10px] ${severityClass[sev] ?? ""}`}>
            {sev}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground ml-1">{editing ? draft.steps.length : test.steps.length} steps</span>
        {!editing && (
          <button
            onClick={startEdit}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            title="Edit test case"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {(open || editing) && (
        <div className="px-3 pb-3 space-y-1 border-t border-border/30 pt-2">
          {editing ? (
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
              className="text-xs min-h-[60px]"
              placeholder="Test description..."
            />
          ) : (
            <p className="text-xs text-muted-foreground mb-2">{test.description}</p>
          )}

          {(editing ? draft.steps : test.steps).map((step: ImpactPlaywrightStep, i: number) => {
            const { label, color } = stepActionLabel(step.action);
            return editing ? (
              <div key={i} className="rounded bg-muted/20 border border-border/30 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono w-5">{i + 1}.</span>
                  <Input
                    value={step.action}
                    onChange={(e) => updateStep(i, "action", e.target.value)}
                    className="h-6 text-[11px] flex-1"
                  />
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
                    placeholder="selector"
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
                <span className={`w-16 text-right font-mono text-[10px] ${color}`}>{label}</span>
                <ArrowRight className="h-3 w-3 text-border flex-shrink-0" />
                <span className="text-muted-foreground truncate">{step.description}</span>
              </div>
            );
          })}

          {editing && (
            <>
              <button
                onClick={addStep}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-border/50 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
              >
                <Plus className="h-3 w-3" /> Add Step
              </button>
              <div className="flex gap-1.5 mt-2">
                <Button size="sm" className="h-7 text-[11px] px-2" onClick={saveEdit}>
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[11px] px-2" onClick={cancelEdit}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DocTests() {
  // State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [scenarios, setScenarios] = useState<DocScenario[]>([]);
  const [generatedTests, setGeneratedTests] = useState<ImpactPlaywrightTest[]>([]);
  const [framework] = useState("playwright");
  const [activeTab, setActiveTab] = useState<"upload" | "scenarios" | "tests">("upload");
  const [connectToGit, setConnectToGit] = useState(false);
  const [gitOwner, setGitOwner] = useState("");
  const [gitRepo, setGitRepo] = useState("");

  // Mutations
  const uploadDoc = useUploadDoc();
  const generateFromDocs = useGenerateFromDocs();

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFileAccepted = async (file: File) => {
    setUploadedFile(file);
    setScenarios([]);
    setGeneratedTests([]);

    try {
      const result = await uploadDoc.mutateAsync(file);
      setScenarios(result.scenarios);
      setActiveTab("scenarios");
      toast.success(`Extracted ${result.scenarios.length} test scenarios`);
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to parse document"
      );
    }
  };

  const handleGenerateTests = async () => {
    if (!scenarios.length) return;
    try {
      const result = await generateFromDocs.mutateAsync({ scenarios, framework });
      setGeneratedTests(result.tests);
      setActiveTab("tests");
      toast.success(`Generated ${result.tests.length} test cases`);
    } catch {
      toast.error("Test generation failed");
    }
  };

  const handleUpdateTest = (updated: ImpactPlaywrightTest) => {
    setGeneratedTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleDownloadTests = () => {
    if (!generatedTests.length) return;
    const base = "/";
    const lines: string[] = [
      "import { test, expect } from '@playwright/test';",
      "",
      "// Generated by Document-Driven Tests",
      "",
    ];

    for (const tc of generatedTests) {
      lines.push(`test('${tc.name.replace(/'/g, "\\'")}', async ({ page }) => {`);
      if (tc.description) lines.push(`  // ${tc.description}`);
      for (const step of tc.steps) {
        const sel = (step.selector || "").replace(/'/g, "\\'");
        const val = step.value || "";
        const description = step.description || step.action;
        if (step.action === "navigate") lines.push(`  await page.goto('${val.startsWith("http") ? val : base + val}'); // ${description}`);
        else if (step.action === "click") lines.push(`  await page.click('${sel}'); // ${description}`);
        else if (step.action === "fill") lines.push(`  await page.fill('${sel}', '${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "assert_text") lines.push(`  await expect(page.locator('body')).toContainText('${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "screenshot") lines.push(`  await page.screenshot(); // ${description}`);
        else if (step.action === "wait") lines.push(`  await page.waitForTimeout(${(parseFloat(val) || 2) * 1000}); // ${description}`);
        else if (step.action === "hover") lines.push(`  await page.hover('${sel}'); // ${description}`);
        else if (step.action === "hover_and_click") {
          const clickSel = val.replace(/'/g, "\\'");
          lines.push(`  await page.hover('${sel}'); // ${description}`);
          lines.push(`  await page.click('${clickSel}');`);
        }
        else if (step.action === "press") lines.push(`  await page.keyboard.press('${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "check") lines.push(`  await page.check('${sel}'); // ${description}`);
        else if (step.action === "uncheck") lines.push(`  await page.uncheck('${sel}'); // ${description}`);
        else if (step.action === "select_option") lines.push(`  await page.selectOption('${sel}', '${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "dblclick") lines.push(`  await page.dblclick('${sel}'); // ${description}`);
        else if (step.action === "type_into") lines.push(`  await page.type('${sel}', '${val.replace(/'/g, "\\'")}'); // ${description}`);
        else if (step.action === "scroll") lines.push(`  await page.evaluate(() => window.scrollBy(0, 500)); // ${description}`);
        else if (step.action === "clear") lines.push(`  await page.fill('${sel}', ''); // ${description}`);
        else lines.push(`  // TODO: ${step.action} - ${description}`);
      }
      lines.push("});");
      lines.push("");
    }

    const content = lines.join("\n");
    const filename = "generated.spec.ts";
    const blob = new Blob([content + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Downloaded ${filename}`);
  };

  const steps = [
    { id: "upload", label: "Upload Doc", icon: Upload, done: !!uploadedFile },
    { id: "scenarios", label: "Scenarios", icon: BookOpen, done: scenarios.length > 0 },
    { id: "tests", label: "Tests", icon: TestTube, done: generatedTests.length > 0 },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">Document-Driven Tests</h1>
            <p className="text-xs text-muted-foreground">
              Upload docs → Extract scenarios → Generate & run tests
            </p>
          </div>
        </div>

        {/* Git link toggle */}
        <Button
          variant={connectToGit ? "default" : "outline"}
          size="sm"
          className="gap-2 h-8"
          onClick={() => setConnectToGit(!connectToGit)}
        >
          {connectToGit ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
          {connectToGit ? "Git Connected" : "Connect to Git"}
        </Button>
      </div>

      {/* ── Progress steps ── */}
      <div className="flex items-center gap-0 border-b border-border bg-muted/20 px-6 py-2">
        {steps.map((step, i) => (
          <React.Fragment key={step.id}>
            <button
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
                activeTab === step.id
                  ? "bg-background text-foreground font-medium shadow-sm border border-border"
                  : step.done
                  ? "text-primary hover:bg-background/50"
                  : "text-muted-foreground hover:bg-background/50"
              }`}
              onClick={() => {
                if (step.done || step.id === "upload") {
                  setActiveTab(step.id as typeof activeTab);
                }
              }}
            >
              {step.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-positive" />
              ) : (
                <step.icon className="h-3.5 w-3.5" />
              )}
              {step.label}
              {step.id === "scenarios" && scenarios.length > 0 && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">
                  {scenarios.length}
                </Badge>
              )}
              {step.id === "tests" && generatedTests.length > 0 && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">
                  {generatedTests.length}
                </Badge>
              )}
            </button>
            {i < steps.length - 1 && (
              <div className="mx-1 h-px w-6 bg-border" />
            )}
          </React.Fragment>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Framework:</span>
            Playwright (Live Runner format)
          </div>

          {scenarios.length > 0 && generatedTests.length === 0 && (
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleGenerateTests}
              disabled={generateFromDocs.isPending}
            >
              {generateFromDocs.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <AiIcon className="h-3 w-3" />
              )}
              Generate Tests
            </Button>
          )}

          {generatedTests.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={handleDownloadTests}
            >
              <Download className="h-3 w-3" />
              Download Code
            </Button>
          )}
        </div>
      </div>

      {/* ── Git connect panel ── */}
      {connectToGit && (
        <div className="flex items-center gap-3 border-b border-border bg-blue-50/50 dark:bg-blue-950/20 px-6 py-2.5 text-xs">
          <GitBranch className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <span className="text-blue-700 dark:text-sky-700 font-medium">Map tests to code:</span>
          <Input
            placeholder="owner"
            value={gitOwner}
            onChange={(e) => setGitOwner(e.target.value)}
            className="h-6 w-24 text-xs"
          />
          <span className="text-muted-foreground">/</span>
          <Input
            placeholder="repository"
            value={gitRepo}
            onChange={(e) => setGitRepo(e.target.value)}
            className="h-6 w-36 text-xs"
          />
          <span className="text-muted-foreground ml-2">
            Failures will be mapped to the dependency graph
          </span>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Upload */}
        {activeTab === "upload" && (
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <div className="w-full max-w-xl">
              <div className="mb-6 text-center">
                <h2 className="text-lg font-semibold text-foreground">Upload a Document</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload any spec, requirements doc, or API definition to extract test scenarios.
                </p>
              </div>
              <UploadZone
                onFile={handleFileAccepted}
                isLoading={uploadDoc.isPending}
                acceptedFile={uploadedFile}
                onClear={() => {
                  setUploadedFile(null);
                  setScenarios([]);
                  setGeneratedTests([]);
                }}
              />
              {uploadDoc.isPending && (
                <div className="mt-4 text-center">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Parsing document with AI…</p>
                </div>
              )}
              {/* Supported formats */}
              <div className="mt-6 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                {[
                  { ext: "PDF", desc: "Product specs, PRDs" },
                  { ext: "DOCX", desc: "Requirements docs" },
                  { ext: "JSON/YAML", desc: "OpenAPI / AsyncAPI" },
                  { ext: "MD", desc: "Markdown specs" },
                  { ext: "TXT", desc: "Plain-text requirements" },
                  { ext: "CSV", desc: "Test data tables" },
                ].map(({ ext, desc }) => (
                  <div
                    key={ext}
                    className="rounded-lg border border-border bg-card px-3 py-2 text-center"
                  >
                    <p className="font-mono font-bold text-foreground">.{ext.toLowerCase()}</p>
                    <p className="mt-0.5 text-[10px]">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Scenarios */}
        {activeTab === "scenarios" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {scenarios.length} Extracted Scenarios
                  </span>
                  {uploadedFile && (
                    <span className="text-xs text-muted-foreground">
                      from {uploadedFile.name}
                    </span>
                  )}
                </div>
              </div>
              <ScrollArea className="h-[calc(100%-45px)]">
                <div className="flex flex-col gap-3 p-4">
                  {scenarios.map((scenario, i) => (
                    <ScenarioCard key={scenario.id} scenario={scenario} index={i} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* Tests */}
        {activeTab === "tests" && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <TestTube className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {generatedTests.length} Generated Tests
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {framework}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadTests}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Testcases
                </Button>
              </div>
              <ScrollArea className="h-[calc(100%-45px)]">
                <div className="flex flex-col gap-3 p-4">
                  {generatedTests.map((test) => (
                    <DocPlaywrightTestCard
                      key={test.id}
                      test={test}
                      onSave={handleUpdateTest}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
