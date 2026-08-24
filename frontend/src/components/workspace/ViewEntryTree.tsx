import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Flame,
  RefreshCw,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Circle,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Rocket,
  Globe,
  GitCommit,
  ExternalLink,
  FlaskConical,
  Layers,
} from "lucide-react";
import { AiIcon } from "@/lib/icons";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { api, baselineApi, type CommitImpactTreeNode, type FileNode, type WorkspacePlaywrightTest, type DeploymentLogEvent, type DeploymentStatusResponse, type BaselineTest } from "@/lib/api";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useCommitImpactTree } from "@/hooks/use-commit-impact";
import { useWorkspaceTree } from "@/hooks/use-workspace";
import { useGitStatus } from "@/hooks/use-git";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ── Run-Test Wizard constants ─────────────────────────────────────────────────

const WIZARD_STEPS = ["Generate", "Commit", "Deploy", "Run Tests"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];
const FINAL_DEPLOY_STATES = new Set(["READY", "ERROR", "CANCELED"]);

function deployStatusTone(status: string) {
  if (status === "READY") return "text-positive";
  if (status === "ERROR" || status === "CANCELED") return "text-red-700";
  return "text-amber-800";
}

function formatLogTime(value?: string | number): string {
  if (value === undefined || value === null || value === "") return "--:--:--";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString();
}

// ── Run-Test Wizard ───────────────────────────────────────────────────────────

interface RunTestWizardProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  repoUrl: string;
  branch: string;
  selectedFilePath: string | null;
}

function RunTestWizard({ open, onClose, workspaceId, repoUrl, branch, selectedFilePath }: RunTestWizardProps) {
  const navigate = useNavigate();
  const { openTabs, setFileTests } = useWorkspaceContext();
  const gitStatusQuery = useGitStatus(workspaceId);

  const [activeStep, setActiveStep] = useState<WizardStep>("Generate");
  const [stepDone, setStepDone] = useState<Partial<Record<WizardStep, boolean>>>({});
  const [stepError, setStepError] = useState<Partial<Record<WizardStep, string>>>({});

  // Generate state
  const [generatedTests, setGeneratedTests] = useState<WorkspacePlaywrightTest[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Commit state
  const [commitMsg, setCommitMsg] = useState(`chore: auto-commit before test run [${new Date().toISOString().slice(0, 10)}]`);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  // Deploy state
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<DeploymentStatusResponse | null>(null);
  const [deployLogs, setDeployLogs] = useState<DeploymentLogEvent[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const logPollRef = useRef<number | null>(null);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setActiveStep("Generate");
      setStepDone({});
      setStepError({});
      setGeneratedTests([]);
      setIsGenerating(false);
      setCommitSha(null);
      setDeploymentId(null);
      setDeployStatus(null);
      setDeployLogs([]);
      setIsDeploying(false);
      setDeployedUrl(null);
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (logPollRef.current) window.clearInterval(logPollRef.current);
    }
  }, [open]);

  // ── Step 1: Generate tests ─────────────────────────────────────────────────

  const handleGenerate = async () => {
    setIsGenerating(true);
    setStepError((prev) => ({ ...prev, Generate: undefined }));
    try {
      let tests: WorkspacePlaywrightTest[] = [];
      if (selectedFilePath) {
        // Generate for the selected file
        const fileData = await api.getWorkspaceFile(workspaceId, selectedFilePath);
        const result = await api.generatePlaywrightTests({
          workspace_id: workspaceId,
          file_path: fileData.path,
          content: fileData.content,
        });
        tests = result.tests;
      } else {
        // Generate for entire app
        const result = await api.generatePlaywrightApp({ workspace_id: workspaceId });
        tests = result.tests;
      }
      setGeneratedTests(tests);
      setFileTests(tests.length > 0 ? [{ filePath: selectedFilePath || "app", tests }] : null);
      setStepDone((prev) => ({ ...prev, Generate: true }));
      // Automatically attempt to find repo_id if we have repoUrl
      // but we wait for user to click "Sync" to promote to baseline
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Test generation failed.";
      setStepError((prev) => ({ ...prev, Generate: msg }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSyncToBaseline = async () => {
    if (!generatedTests.length) return;
    setIsSyncing(true);
    try {
      const repoId = await api.getRepoId(repoUrl); // helper to get hash
      const baselineMapped: BaselineTest[] = generatedTests.map(t => ({
        test_id: `IDE-${t.id.slice(0, 6)}`,
        name: t.name,
        description: t.description,
        category: "ui_component", // default for IDE
        severity: t.severity.toLowerCase(),
        page_path: t.page_name,
        playwright_code: "", // Ide tests use steps usually, or we can fetch code if available
        steps: t.steps.map(s => ({
          action: s.action,
          target: s.selector || "",
          value: s.value || undefined,
          assertion: s.description
        })),
        is_active: true,
        created_at: new Date().toISOString()
      } as any));

      const res = await baselineApi.syncTests(repoId, baselineMapped, "workspace");
      toast.success(`Synced ${res.added_count} tests to Global Baseline!`);
      setSyncDone(true);
    } catch (err: any) {
      toast.error("Failed to sync to baseline: " + (err?.response?.data?.detail || err.message));
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Step 2: Commit changes ─────────────────────────────────────────────────

  const handleCommit = async () => {
    setIsCommitting(true);
    setStepError((prev) => ({ ...prev, Commit: undefined }));

    const dirtyTabs = openTabs.filter((t) => t.isDirty);
    const stagedFiles = gitStatusQuery.data?.staged ?? [];
    const unstagedFiles = gitStatusQuery.data?.unstaged ?? [];
    const untrackedFiles = gitStatusQuery.data?.untracked ?? [];
    const allChanged = [...new Set([
      ...dirtyTabs.map((t) => t.path),
      ...stagedFiles,
      ...unstagedFiles,
      ...untrackedFiles,
    ])];

    if (allChanged.length === 0) {
      // Nothing to commit skip this step
      setStepDone((prev) => ({ ...prev, Commit: true }));
      setActiveStep("Deploy");
      setIsCommitting(false);
      return;
    }

    const newFileContents: Record<string, string> = {};
    dirtyTabs.forEach((tab) => {
      if (allChanged.includes(tab.path)) {
        newFileContents[tab.path] = tab.content;
      }
    });

    try {
      const result = await api.commitAndPush({
        workspace_id: workspaceId,
        branch,
        files: allChanged,
        message: commitMsg.trim() || "chore: test run commit",
        new_file_contents: newFileContents,
      });
      setCommitSha(result.sha);
      setStepDone((prev) => ({ ...prev, Commit: true }));
      setActiveStep("Deploy");
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Commit failed.";
      setStepError((prev) => ({ ...prev, Commit: msg }));
    } finally {
      setIsCommitting(false);
    }
  };

  // ── Step 3: Deploy ─────────────────────────────────────────────────────────

  const stopPolling = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (logPollRef.current) { window.clearInterval(logPollRef.current); logPollRef.current = null; }
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    setStepError((prev) => ({ ...prev, Deploy: undefined }));
    setDeployLogs([]);
    setDeployStatus(null);
    try {
      const result = await api.triggerDeployment({
        repo_url: repoUrl,
        branch,
        commit_sha: commitSha || undefined,
        target: "production",
      });
      setDeploymentId(result.deploymentId);
      setDeployStatus({
        deploymentId: result.deploymentId,
        status: result.status,
        url: result.url,
        createdAt: result.createdAt,
        ready: result.status === "READY",
      });

      // Poll status
      pollRef.current = window.setInterval(async () => {
        try {
          const latest = await api.getDeploymentStatus(result.deploymentId);
          setDeployStatus(latest);
          if (FINAL_DEPLOY_STATES.has(latest.status)) {
            stopPolling();
            if (latest.status === "READY") {
              const host = (latest.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
              const liveUrl = `https://${host.includes(".") ? host : `${host}.vercel.app`}`;
              setDeployedUrl(liveUrl);
              setStepDone((prev) => ({ ...prev, Deploy: true }));
              setActiveStep("Run Tests");
            } else {
              setStepError((prev) => ({ ...prev, Deploy: `Deployment ${latest.status}. Check logs and try again.` }));
            }
            setIsDeploying(false);
          }
        } catch { /* transient */ }
      }, 5000);

      // Poll logs
      logPollRef.current = window.setInterval(async () => {
        try {
          const data = await api.getDeploymentEvents(result.deploymentId, 100);
          setDeployLogs(data.events || []);
        } catch { /* ignore */ }
      }, 5000);

    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Failed to trigger deployment.";
      setStepError((prev) => ({ ...prev, Deploy: msg }));
      setIsDeploying(false);
    }
  };

  // ── Step 4: Launch Live Tests ──────────────────────────────────────────────

  const handleRunTests = () => {
    if (!deployedUrl) return;
    // Stash context in sessionStorage for LiveTestRunner to pick up
    sessionStorage.setItem("ltr_prefill", JSON.stringify({
      appUrl: deployedUrl,
      githubUrl: repoUrl,
      generatedTests,
    }));
    toast.success("Launching Live Test Runner…");
    onClose();
    navigate("/live-test-runner");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const stepIdx = WIZARD_STEPS.indexOf(activeStep);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Run Test Cases
          </DialogTitle>
        </DialogHeader>

        {/* Step tracker */}
        <div className="flex items-center gap-0 my-2">
          {WIZARD_STEPS.map((step, idx) => {
            const done = !!stepDone[step];
            const active = activeStep === step;
            const locked = idx > stepIdx && !done;
            return (
              <div key={step} className="flex items-center flex-1 min-w-0">
                <div className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors flex-1 min-w-0",
                  active && "bg-primary/15 text-primary",
                  done && !active && "text-positive",
                  locked && "text-muted-foreground/40",
                )}>
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                  ) : (
                    <span className={cn(
                      "h-4 w-4 rounded-full border flex items-center justify-center text-[9px] font-bold flex-shrink-0",
                      active ? "border-primary/60 bg-primary/20 text-primary" : "border-border/50 bg-muted text-muted-foreground",
                    )}>
                      {idx + 1}
                    </span>
                  )}
                  <span className="truncate">{step}</span>
                </div>
                {idx < WIZARD_STEPS.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-4 mt-2">
          {/* ── Step 1: Generate ── */}
          {activeStep === "Generate" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {selectedFilePath
                  ? <>Generate Playwright test cases for <code className="text-primary font-mono text-xs">{selectedFilePath}</code>.</>
                  : "Generate Playwright test cases for the entire application."}
              </p>
              {stepError.Generate && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {stepError.Generate}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={handleGenerate} disabled={isGenerating} className="gap-2 flex-1">
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                  {isGenerating ? "Generating…" : generatedTests.length > 0 ? "Regenerate" : "Generate Test Cases"}
                </Button>
                {generatedTests.length > 0 && (
                  <Button 
                    variant="outline" 
                    onClick={() => setActiveStep("Commit")}
                    className="gap-2 flex-1 border-primary/30 text-primary hover:bg-primary/5"
                  >
                    Next: Commit <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Commit ── */}
          {activeStep === "Commit" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-positive">
                <CheckCircle2 className="h-4 w-4" />
                <span>{generatedTests.length} test case{generatedTests.length !== 1 ? "s" : ""} generated.</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Commit your current changes so the deployment reflects the latest code.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Commit message</label>
                <Input
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="chore: test run commit"
                />
              </div>
              {stepError.Commit && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {stepError.Commit}
                </div>
              )}
              <Button onClick={handleCommit} disabled={isCommitting} className="gap-2">
                {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCommit className="h-4 w-4" />}
                {isCommitting ? "Committing…" : "Commit & Push"}
              </Button>
            </div>
          )}

          {/* ── Step 3: Deploy ── */}
          {activeStep === "Deploy" && (
            <div className="space-y-3">
              {commitSha && (
                <div className="flex items-center gap-2 text-sm text-positive">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Committed <code className="font-mono text-xs">{commitSha.slice(0, 7)}</code></span>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Deploy <span className="text-foreground font-medium">{repoUrl.replace("https://github.com/", "")}</span>{" "}
                to production. The live URL will be used for testing.
              </p>

              {deployStatus && (
                <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Status:</span>
                    <span className={deployStatusTone(deployStatus.status)}>{deployStatus.status}</span>
                    {isDeploying && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-800" />}
                  </div>
                  {deployStatus.url && (
                    <div className="flex items-center gap-2 text-xs">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">URL:</span>
                      <a
                        href={deployedUrl || `https://${deployStatus.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-mono"
                      >
                        {deployStatus.url}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {deployLogs.length > 0 && (
                <div className="rounded-md border border-border/50 bg-slate-950/70 h-40 overflow-y-auto p-2 font-mono text-[11px] space-y-1">
                  {deployLogs.slice(-40).map((ev, idx) => {
                    const msg = String(ev.message || "").trim();
                    let summary = msg;
                    if (msg.startsWith("{") || msg.startsWith("[")) {
                      try {
                        const p = JSON.parse(msg);
                        summary = String(p?.text || p?.message || p?.type || msg);
                      } catch { /* keep */ }
                    }
                    return (
                      <div key={ev.id || idx} className="flex gap-2 text-slate-300">
                        <span className="text-slate-500 flex-shrink-0">{formatLogTime(ev.timestamp)}</span>
                        <span className="break-words">{summary}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {stepError.Deploy && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {stepError.Deploy}
                </div>
              )}

              {!isDeploying && !stepDone.Deploy && (
                <Button onClick={handleDeploy} className="gap-2">
                  <Rocket className="h-4 w-4" />
                  Deploy to Production
                </Button>
              )}
            </div>
          )}

          {/* ── Step 4: Run Tests ── */}
          {activeStep === "Run Tests" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-positive">
                <CheckCircle2 className="h-4 w-4" />
                <span>Deployed successfully!</span>
              </div>
              {deployedUrl && (
                <div className="rounded-md border border-positive/25 bg-positive/10 p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Live URL</p>
                  <a
                    href={deployedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-positive hover:underline font-mono text-sm flex items-center gap-1"
                  >
                    {deployedUrl}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {generatedTests.length} test case{generatedTests.length !== 1 ? "s" : ""} ready.
                Click below to open the Live Test Runner with your deployed URL and generated tests pre-loaded.
              </p>
              <Button onClick={handleRunTests} className="gap-2">
                <Play className="h-4 w-4" />
                Launch Live Test Runner
              </Button>
            </div>
          )}
        </div>

        {/* ── Global Footer Actions (Always visible if tests exist) ── */}
        {generatedTests.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/30 px-1">
            <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <AiIcon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-primary">Promote to Global Baseline</p>
                  <p className="text-[10px] text-muted-foreground">Permanent change-tracking for this repo.</p>
                </div>
              </div>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={handleSyncToBaseline}
                disabled={isSyncing || syncDone}
                className={cn(
                  "h-8 text-[11px] gap-2 border border-primary/20",
                  syncDone ? "bg-positive/10 text-positive border-positive/25 hover:bg-primary/20 hover:text-positive" : "text-primary hover:bg-primary/10"
                )}
              >
                {isSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : syncDone ? <CheckCircle2 className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                {syncDone ? "Synced!" : "Sync Now"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type StatusCode = "M" | "U" | "A" | "D" | " ";

const STATUS_STYLE: Record<StatusCode, string> = {
  M: "text-[var(--color-warning)]",
  U: "text-sky-700",
  A: "text-positive",
  D: "text-red-700",
  " ": "text-muted-foreground/40",
};

function hasFileChildren(node: FileNode) {
  return node.type === "directory" && (node.children?.length ?? 0) > 0;
}

function fileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py"].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />;
  }
  return <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
}

function findPathToTarget(nodes: CommitImpactTreeNode[], targetPath: string): string[] | null {
  for (const node of nodes) {
    if (node.path === targetPath) return [node.path];
    const childPath = findPathToTarget(node.children ?? [], targetPath);
    if (childPath) return [node.path, ...childPath];
  }
  return null;
}

function buildParentPaths(path: string): string[] {
  const parts = path.split("/");
  const parents: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    parents.push(parts.slice(0, i).join("/"));
  }
  return parents;
}

interface FileTreeNodeRowProps {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  activePath: string | null;
  selectedPath: string | null;
  statusMap: Record<string, StatusCode>;
  entryRoots: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}

function FileTreeNodeRow({
  node,
  depth,
  expanded,
  activePath,
  selectedPath,
  statusMap,
  entryRoots,
  onToggle,
  onOpenFile,
}: FileTreeNodeRowProps) {
  const isActive = activePath === node.path;
  const isSelected = selectedPath === node.path;
  const status = statusMap[node.path] ?? " ";
  const isEntry = entryRoots.has(node.path);

  if (node.type === "directory") {
    const opened = expanded.has(node.path);
    return (
      <div>
        <button
          className="flex items-center gap-1.5 w-full px-1 py-0.5 rounded text-xs transition-colors text-left hover:bg-muted/50 text-foreground/75 hover:text-foreground"
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          onClick={() => onToggle(node.path)}
          title={node.path}
        >
          {hasFileChildren(node) ? (
            opened ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : (
            <Circle className="h-1.5 w-1.5 text-muted-foreground/25" />
          )}
          {opened ? (
            <FolderOpen className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />
          ) : (
            <Folder className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />
          )}
          <span className="truncate flex-1 min-w-0">{node.name}</span>
        </button>

        {opened && node.children?.map((child) => (
          <FileTreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            activePath={activePath}
            selectedPath={selectedPath}
            statusMap={statusMap}
            entryRoots={entryRoots}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full px-1 py-0.5 rounded text-xs transition-colors text-left",
        isActive || isSelected
          ? "bg-primary/15 text-primary"
          : "hover:bg-muted/50 text-foreground/75 hover:text-foreground"
      )}
      style={{ paddingLeft: `${depth * 12 + 6}px` }}
      onClick={() => onOpenFile(node.path)}
      title={node.path}
    >
      {isEntry ? (
        <Flame className="h-3.5 w-3.5 text-[var(--color-warning)] flex-shrink-0" />
      ) : (
        fileIcon(node.path)
      )}

      <span className="truncate flex-1 min-w-0">{node.name}</span>

      {status !== " " && (
        <span className={cn("text-[9px] font-bold", STATUS_STYLE[status])}>
          {status}
        </span>
      )}
    </button>
  );
}


export function ViewEntryTree({ refreshNonce = 0 }: { refreshNonce?: number } = {}) {
  const { workspace, activeTab, openFile, setFileTests } = useWorkspaceContext();
  const impactQuery = useCommitImpactTree(workspace?.workspace_id ?? null, 5);
  const workspaceTreeQuery = useWorkspaceTree(workspace?.workspace_id ?? null);
  const gitStatusQuery = useGitStatus(workspace?.workspace_id ?? null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);

  const roots = impactQuery.data?.roots ?? [];
  const fileTree = workspaceTreeQuery.data?.tree ?? [];

  const entryRoots = useMemo(() => new Set(roots.map((n) => n.path)), [roots]);

  const statusMap = useMemo<Record<string, StatusCode>>(() => {
    const map: Record<string, StatusCode> = {};
    const s = gitStatusQuery.data;
    if (!s) return map;
    (s.staged ?? []).forEach((p) => {
      map[p] = "A";
    });
    (s.unstaged ?? []).forEach((p) => {
      map[p] = "M";
    });
    (s.untracked ?? []).forEach((p) => {
      map[p] = "U";
    });
    return map;
  }, [gitStatusQuery.data]);

  useEffect(() => {
    if (refreshNonce > 0) {
      impactQuery.refetch();
      workspaceTreeQuery.refetch();
      gitStatusQuery.refetch();
    }
  }, [refreshNonce]);

  useEffect(() => {
    if (!fileTree.length) {
      setExpanded(new Set());
      return;
    }
    const initial = new Set<string>();
    fileTree
      .filter((n) => n.type === "directory")
      .forEach((n) => initial.add(n.path));

    roots.forEach((root) => {
      buildParentPaths(root.path).forEach((p) => initial.add(p));
    });

    setExpanded(initial);
  }, [workspaceTreeQuery.data?.workspace_id, fileTree.length, roots]);

  useEffect(() => {
    if (!activeTab) return;
    setSelectedPath(activeTab);
    setExpanded((prev) => {
      const next = new Set(prev);
      buildParentPaths(activeTab).forEach((p) => next.add(p));
      return next;
    });

    if (roots.length === 0) return;
    const pathChain = findPathToTarget(roots, activeTab);
    if (!pathChain) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      pathChain.forEach((p) => next.add(p));
      return next;
    });
  }, [activeTab, roots]);

  const selectedChain = useMemo(() => {
    if (!selectedPath) return [];
    return findPathToTarget(roots, selectedPath) ?? [];
  }, [roots, selectedPath]);

  const handleToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleOpenFile = async (path: string) => {
    if (!workspace) return;
    try {
      const file = await api.getWorkspaceFile(workspace.workspace_id, path);
      openFile(file.path, file.language, file.content);
      setSelectedPath(path);
    } catch {
      // Ignore open errors and keep tree usable.
    }
  };

  if (!workspace) return null;

  const summary = impactQuery.data?.summary;
  const changedCount = Object.values(statusMap).filter((s) => s !== " ").length;

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 pt-2 pb-1.5 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium truncate">
              View Entry
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              ,  
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWizardOpen(true)}
              className="h-5 px-1.5 flex items-center gap-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors text-primary"
              title="Run test cases: generate → commit → deploy → live test"
            >
              <Play className="h-2.5 w-2.5" />
              <span className="text-[9px] font-semibold">Run Tests</span>
            </button>
            <button
              onClick={() => {
                impactQuery.refetch();
                workspaceTreeQuery.refetch();
                gitStatusQuery.refetch();
              }}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/50 transition-colors"
              title="Refresh impact tree"
            >
              <RefreshCw className={cn("h-3 w-3 text-muted-foreground", (impactQuery.isFetching || workspaceTreeQuery.isFetching || gitStatusQuery.isFetching) && "animate-spin text-primary")} />
            </button>
          </div>
        </div>

        {(summary || changedCount > 0) && (
          <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground/80">
            <span className="text-[var(--color-warning)]">{summary?.status_counts.M ?? 0}M</span>
            <span className="text-sky-700">{summary?.status_counts.U ?? 0}U</span>
            <span className="text-positive">{summary?.status_counts.A ?? 0}A</span>
            <span className="ml-auto">{changedCount} changed</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-1">
        {workspaceTreeQuery.isLoading ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">Loading files...</div>
        ) : workspaceTreeQuery.isError ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">
            Failed to load file tree.
            <button
              className="ml-2 text-primary hover:underline"
              onClick={() => workspaceTreeQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : fileTree.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">No files found.</p>
        ) : (
          fileTree.map((node) => (
            <FileTreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              activePath={activeTab}
              selectedPath={selectedPath}
              statusMap={statusMap}
              entryRoots={entryRoots}
              onToggle={handleToggle}
              onOpenFile={handleOpenFile}
            />
          ))
        )}
      </div>

      {selectedChain.length > 0 && (
        <div className="border-t border-border/20 px-2 py-1 flex-shrink-0">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Root to leaf</p>
          <p className="text-[10px] text-foreground/80 truncate" title={selectedChain.join(" -> ")}>
            {selectedChain.join(" -> ")}
          </p>
        </div>
      )}

      {/* Run Test Wizard */}
      <RunTestWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        workspaceId={workspace.workspace_id}
        repoUrl={workspace.repo_url}
        branch={workspace.branch}
        selectedFilePath={selectedPath}
      />
    </div>
  );
}
