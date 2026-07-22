import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Wand2, Loader2, CheckCircle2, AlertCircle, RefreshCw, 
  TerminalSquare, Code2, Terminal,
  Bot, User, FolderTree, GitBranch, Activity, CircleDashed,
  BrainCircuit, Hammer, Search, Boxes, Send, Github, Rocket, Upload, FileText, X,
  Globe, ExternalLink, Clock3, ServerCrash
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { AiIdeProvider, useAiIde } from "@/context/AiIdeContext";
import { AiFileTree } from "@/components/ai-ide/AiFileTree";
import { AiCodeEditor } from "@/components/ai-ide/AiCodeEditor";
import { useAiGenerationWS } from "@/hooks/useAiGenerationWS";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

const RUNTIME_GITHUB_TOKEN_STORAGE_KEY = "ai-ide:github-token";

function getRuntimeGithubToken(): string {
  const fromEnv = (import.meta as any)?.env?.VITE_GITHUB_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

  try {
    const fromStorage = window.localStorage.getItem(RUNTIME_GITHUB_TOKEN_STORAGE_KEY);
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  } catch {}

  return "";
}

function normalizeDeploymentUrl(url?: string | null): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  idle: null,
  creating: { label: "Initializing Matrix…", color: "bg-yellow-500/20 text-amber-700 border border-amber-200 shadow-[0_0_10px_rgba(234,179,8,0.2)]" },
  planning: { label: "AI Planning Architecture…", color: "bg-primary/20 text-primary border border-primary/30 shadow-[0_0_10px_hsl(var(--primary)/0.2)]" },
  generating: { label: "Generating Codebase…", color: "bg-primary/20 text-primary border border-primary/30 shadow-[0_0_15px_rgba(20,184,166,0.3)] animate-pulse" },
  done: { label: "System Ready", color: "bg-primary/20 text-positive border border-positive/25 shadow-[0_0_10px_rgba(255,161,43,0.2)]" },
  error: { label: "Critical Error", color: "bg-destructive/20 text-destructive border border-destructive/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]" },
} as const;

// ── Idea Input (shown before workspace exists) ────────────────────────────────

function IdeaScreen({ onBuild }: { onBuild: (idea: string) => void }) {
  const [idea, setIdea] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { state } = useAiIde();
  const isLoading = state.status === "creating";

  const handleSubmit = () => {
    if (!idea.trim() || isLoading) return;
    onBuild(idea.trim());
  };

  const readPrdFile = async (file: File) => {
    const allowedExt = [".txt", ".md", ".markdown", ".json", ".yaml", ".yml"];
    const lowerName = file.name.toLowerCase();
    const isAllowed = allowedExt.some((ext) => lowerName.endsWith(ext));

    if (!isAllowed) {
      setUploadError("Unsupported file type. Upload .txt, .md, .markdown, .json, .yaml, or .yml");
      return;
    }

    const content = await file.text();
    const cleaned = content.trim();
    if (!cleaned) {
      setUploadError("The uploaded PRD file is empty.");
      return;
    }

    setIdea(cleaned);
    setUploadedFileName(file.name);
    setUploadError(null);
  };

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await readPrdFile(file);
    } catch {
      setUploadError("Failed to read file content. Please try again.");
    } finally {
      if (event.target) event.target.value = "";
    }
  };

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center p-8 overflow-hidden bg-background">
      {/* Dynamic Background Effects */}
      <div className="absolute inset-0 bg-gradient-hero opacity-60 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="w-full max-w-3xl space-y-8 z-10"
      >
        {/* Header */}
        <div className="text-center space-y-4">
          <motion.div 
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
            className="h-20 w-20 rounded-2xl bg-card border border-primary/30 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(20,184,166,0.15)] relative group"
          >
            <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-xl group-hover:bg-primary/30 transition-all duration-500"></div>
            <BrainCircuit className="h-10 w-10 text-primary relative z-10" />
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-2"
          >
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
              Vibe <span className="text-gradient-brand">Coding</span> IDE
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Describe your vision. Watch as our AI dynamically engineers a production-grade React application in real-time.
            </p>
          </motion.div>
        </div>

        {/* Input Card */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="relative group"
        >
          <div className="absolute -inset-0.5 bg-gradient-brand rounded-2xl blur opacity-30 group-focus-within:opacity-60 group-focus-within:duration-200 transition duration-1000"></div>
          <div className="relative floating-card glass p-2 rounded-2xl">
            <Textarea
              value={idea}
              onChange={(e) => {
                setIdea(e.target.value);
                if (uploadError) setUploadError(null);
              }}
              placeholder="e.g. Build an advanced crypto analytics dashboard with live candlestick charts and a dark luxury aesthetic..."
              className="min-h-[160px] resize-none text-base bg-transparent border-none focus-visible:ring-0 placeholder:text-muted-foreground/60 p-4"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
            
            <div className="flex items-center justify-between mt-2 px-2 pb-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 opacity-70">
                  <TerminalSquare className="w-3.5 h-3.5" />
                  Press <Kbd>⌘</Kbd> + <Kbd>↵</Kbd> to orchestrate
                </span>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown,.json,.yaml,.yml"
                    className="hidden"
                    onChange={onPickFile}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    Upload PRD
                  </Button>
                  {uploadedFileName && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border bg-background/70">
                      <FileText className="h-3 w-3" />
                      <span className="max-w-[180px] truncate">{uploadedFileName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedFileName(null);
                          setIdea("");
                          setUploadError(null);
                        }}
                        className="opacity-70 hover:opacity-100"
                        aria-label="Clear uploaded PRD"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </div>
                {uploadError && <span className="text-[11px] text-destructive">{uploadError}</span>}
              </div>
              
              <Button
                onClick={handleSubmit}
                disabled={!idea.trim() || isLoading}
                className="h-11 px-6 rounded-xl hover:shadow-[0_0_20px_rgba(20,184,166,0.3)] transition-all gap-2 font-medium"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Initializing Matrix...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Engineer App
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Example ideas */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="space-y-3 pt-4"
        >
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest text-center opacity-80">
            Inspiration
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              "A luxury dark-themed fintech dashboard for portfolio tracking",
              "An e-commerce product page with glassmorphism",
              "A high-performance DevOps monitoring console",
              "A genomic sequencing data visualizer app",
            ].map((ex, i) => (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                key={ex}
                onClick={() => setIdea(ex)}
                className="text-xs px-4 py-2 rounded-full glass border border-primary/10 hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all shadow-sm"
              >
                {ex}
              </motion.button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[10px] rounded-md bg-muted border border-border/50 shadow-sm text-foreground">
      {children}
    </kbd>
  );
}

type LeftPaneKey = "explorer" | "git";

function ActivityRail({
  onSearchClick,
  isDark,
  activePane,
  onSelectPane,
}: {
  onSearchClick: () => void;
  isDark: boolean;
  activePane: LeftPaneKey;
  onSelectPane: (pane: LeftPaneKey) => void;
}) {
  const items: Array<{ icon: any; label: string; key: LeftPaneKey | "search"; onClick?: () => void }> = [
    { icon: FolderTree, label: "Explorer", key: "explorer", onClick: () => onSelectPane("explorer") },
    { icon: Search, label: "Search", key: "search", onClick: onSearchClick },
    { icon: GitBranch, label: "Source Control", key: "git", onClick: () => onSelectPane("git") },
  ];

  return (
    <div
      className={cn(
        "w-11 border-r flex flex-col items-center py-2 gap-1",
        isDark ? "border-slate-700/90 bg-[#070d18]" : "border-slate-200 bg-slate-100"
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.key !== "search" && item.key === activePane;
        return (
          <button
            key={item.label}
            title={item.label}
            onClick={() => {
              item.onClick?.();
            }}
            className={cn(
              "h-8 w-8 rounded-md border flex items-center justify-center transition-colors",
              isActive
                ? (isDark
                    ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-300"
                    : "bg-cyan-100 border-cyan-300 text-cyan-700")
                : (isDark
                    ? "bg-transparent border-transparent text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                    : "bg-transparent border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-200")
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function GitChangesPane() {
  const { state, setActiveFile } = useAiIde();
  const { fileStatuses } = state;

  const entries = Object.entries(fileStatuses)
    .filter(([, s]) => Boolean(s))
    .map(([path, status]) => ({ path, status: status as Exclude<typeof status, null> }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const labelFor = (s: string) => (s === "A" ? "Added" : s === "M" ? "Modified" : "Updated");
  const badgeClass = (s: string) =>
    s === "A"
      ? "border-positive/25 bg-positive/10 text-positive"
      : s === "M"
        ? "border-orange-200 bg-orange-50 text-orange-600"
        : "border-sky-500/30 bg-sky-500/10 text-sky-600";

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium">Changes</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{entries.length}</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {entries.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              No changes yet.
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                onClick={() => setActiveFile(e.path)}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors flex items-center gap-2"
                title="Open file"
              >
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-semibold", badgeClass(e.status))}>
                  {e.status}
                </span>
                <span className="text-xs truncate flex-1 min-w-0">{e.path}</span>
                <span className="text-[10px] text-muted-foreground flex-shrink-0">{labelFor(e.status)}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Telemetry + Chat panel ───────────────────────────────────────────────────

type DeployLogEvent = { id?: string; message?: string; timestamp?: number; level?: string };
type DeployStatus = { status: string; url?: string; domains?: string[] };

function RightRail({
  idea,
  onDeploymentUpdate,
  onOpenPreview,
  redeployNonce,
}: {
  idea: string;
  onDeploymentUpdate: (payload: { deployedUrl: string | null; deployStatus: DeployStatus | null; deployLogs: DeployLogEvent[]; repoUrl: string | null; stableDomain: string | null }) => void;
  onOpenPreview: () => void;
  redeployNonce: number;
}) {
  const { state, dispatch, setActiveFile, reset } = useAiIde();
  const { generationLog, status, statusMessage, files, workspaceId } = state;
  const isDark = false;

  const logEndRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [manualConversation, setManualConversation] = useState<Array<{ role: "user" | "assistant"; message: string; messageType?: "planning" | "execution" | "file" }>>([]);
  const [repoName, setRepoName] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [branchName, setBranchName] = useState("main");
  const [commitMessage, setCommitMessage] = useState("chore: update AI IDE workspace");
  const [repoPrivate, setRepoPrivate] = useState(true);
  const [isGitBusy, setIsGitBusy] = useState(false);
  const [isDeployBusy, setIsDeployBusy] = useState(false);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  const [deployLogs, setDeployLogs] = useState<DeployLogEvent[]>([]);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [stableDomain, setStableDomain] = useState<string | null>(null); // domains[0] stable alias, allows iframes
  const pollRef = useRef<number | null>(null);
  const logPollRef = useRef<number | null>(null);
  const FINAL_DEPLOY_STATES = new Set(["READY", "ERROR", "CANCELED"]);
  const autoDeployedRef = useRef(false);
  const lastRedeployNonceRef = useRef(0);

  useEffect(() => {
    if (!workspaceId || repoName.trim()) return;
    const slug = idea
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const suffix = workspaceId.split("-")[0];
    const defaultRepo = (slug ? `${slug}-${suffix}` : `ai-ide-${suffix}`).slice(0, 80);
    setRepoName(defaultRepo);
  }, [workspaceId, idea, repoName]);

  useEffect(() => {
    if (githubToken.trim()) return;
    const token = getRuntimeGithubToken();
    if (token) setGithubToken(token);
  }, [githubToken]);

  const fileCount = Object.values(files).filter((c) => c.length > 0).length;
  const createdFiles = generationLog
    .filter((entry) => entry.startsWith("Creating "))
    .map((entry) => entry.replace("Creating ", "").replace("…", "").trim());
  const uniqueCreatedFiles = Array.from(new Set(createdFiles));
  const chatMessages = manualConversation.length > 0
    ? manualConversation
    : [{ role: "assistant" as const, message: `Hi! I'm your AI assistant for this workspace.\n\nTry: "create file src/pages/Home.tsx", "open App.tsx", "rename x to y", or ask me anything about your project.`, messageType: "planning" as const }];

  const executionEvents = generationLog.slice(-24).map((entry, idx) => {
    const lower = entry.toLowerCase();
    if (lower.includes("planning")) return { id: `${entry}-${idx}`, kind: "thought", label: "Planner", detail: entry };
    if (lower.startsWith("creating ")) return { id: `${entry}-${idx}`, kind: "edit", label: "Create", detail: entry.replace("Creating ", "").replace("…", "") };
    if (lower.startsWith("updated ")) return { id: `${entry}-${idx}`, kind: "edit", label: "Edit", detail: entry.replace("Updated ", "") };
    if (entry.startsWith("✓")) return { id: `${entry}-${idx}`, kind: "done", label: "Done", detail: entry.replace("✓", "").trim() };
    return { id: `${entry}-${idx}`, kind: "log", label: "Log", detail: entry };
  });

  const hasPlanned = generationLog.some((entry) => entry.toLowerCase().includes("planning") || entry.toLowerCase().includes("plan ready"));
  const hasCreated = generationLog.some((entry) => entry.toLowerCase().startsWith("creating "));
  const hasEdited = generationLog.some((entry) => entry.toLowerCase().startsWith("updated "));
  const plannerSteps: Array<{ step: string; status: "done" | "running" | "pending" }> = [
    { step: "Planning", status: hasPlanned ? "done" : (status === "planning" ? "running" : "pending") },
    { step: "Creating Files", status: hasCreated ? (status === "generating" ? "running" : "done") : (status === "generating" ? "running" : "pending") },
    { step: "Editing Code", status: hasEdited ? (status === "done" ? "done" : "running") : (status === "generating" ? "running" : "pending") },
    { step: "Finalize", status: status === "done" ? "done" : (status === "error" ? "pending" : "running") },
  ];

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [generationLog.length, manualConversation.length]);

  useEffect(() => {
    onDeploymentUpdate({ deployedUrl, deployStatus, deployLogs, repoUrl, stableDomain });
  }, [deployedUrl, deployStatus, deployLogs, repoUrl, stableDomain, onDeploymentUpdate]);

  const eventIcon = (kind: string) => {
    if (kind === "thought") return <BrainCircuit className="h-3 w-3 text-sky-700" />;
    if (kind === "edit") return <Hammer className="h-3 w-3 text-teal-300" />;
    if (kind === "done") return <CheckCircle2 className="h-3 w-3 text-positive" />;
    return <Activity className="h-3 w-3 text-slate-400" />;
  };

  const runCommand = async (message: string): Promise<{ ok: boolean; reply: string; type: "planning" | "execution" | "file" }> => {
    const input = message.trim();
    const lower = input.toLowerCase();
    const createFileMatch = input.match(/create\s+file\s+(.+)/i);
    if (createFileMatch?.[1]) {
      const filePath = createFileMatch[1].trim();
      let generatedContent: string | undefined;
      if (workspaceId) {
        const response = await apiClient.post<{ ok: boolean; path: string; content: string }>("/ai-ide/file/create", {
          workspace_id: workspaceId,
          path: filePath,
        });
        generatedContent = response.data?.content;
      }
      dispatch({ type: "ADD_FILE", path: filePath, content: generatedContent, markAs: "A", makeActive: true });
      dispatch({ type: "ADD_LOG", message: `Creating ${filePath}…` });
      return { ok: true, type: "file", reply: `[AI] Creating ${filePath}...` };
    }

    const createFolderMatch = input.match(/create\s+folder\s+(.+)/i);
    if (createFolderMatch?.[1]) {
      const folderPath = createFolderMatch[1].trim();
      dispatch({ type: "ADD_DIR", path: folderPath });
      dispatch({ type: "ADD_LOG", message: `Creating ${folderPath}…` });
      return { ok: true, type: "file", reply: `[AI] Creating folder ${folderPath}...` };
    }

    const renameMatch = input.match(/rename\s+(.+)\s+to\s+(.+)/i);
    if (renameMatch?.[1] && renameMatch?.[2]) {
      const fromPath = renameMatch[1].trim();
      const toPath = renameMatch[2].trim();
      if (workspaceId) {
        await apiClient.post("/ai-ide/file/rename", { workspace_id: workspaceId, from_path: fromPath, to_path: toPath });
      }
      dispatch({ type: "RENAME_PATH", fromPath, toPath });
      dispatch({ type: "ADD_LOG", message: `Updated ${fromPath} -> ${toPath}` });
      return { ok: true, type: "file", reply: `[AI] Renamed ${fromPath} -> ${toPath}` };
    }

    const moveMatch = input.match(/move\s+(.+)\s+to\s+(.+)/i);
    if (moveMatch?.[1] && moveMatch?.[2]) {
      const fromPath = moveMatch[1].trim();
      const toPath = moveMatch[2].trim();
      if (workspaceId) {
        await apiClient.post("/ai-ide/file/move", { workspace_id: workspaceId, from_path: fromPath, to_path: toPath });
      }
      dispatch({ type: "MOVE_PATH", fromPath, toPath });
      dispatch({ type: "ADD_LOG", message: `Updated ${fromPath} -> ${toPath}` });
      return { ok: true, type: "file", reply: `[AI] Moved ${fromPath} -> ${toPath}` };
    }

    const deleteMatch = input.match(/delete\s+(.+)/i);
    if (deleteMatch?.[1]) {
      const path = deleteMatch[1].trim();
      if (workspaceId) {
        await apiClient.post("/ai-ide/file/delete", { workspace_id: workspaceId, path });
      }
      dispatch({ type: "DELETE_PATH", path });
      dispatch({ type: "ADD_LOG", message: `Deleted ${path}` });
      return { ok: true, type: "file", reply: `[AI] Deleted ${path}` };
    }

    const openMatch = input.match(/open\s+(.+)/i);
    if (openMatch?.[1]) {
      setActiveFile(openMatch[1].trim());
      return { ok: true, type: "execution", reply: `[AI] Opened ${openMatch[1].trim()}` };
    }

    if (lower.includes("plan") || lower.includes("architecture")) {
      return { ok: true, type: "planning", reply: "[AI] Plan ready: scaffold files, wire routes, refine UI, finalize deploy." };
    }

    if (lower.startsWith("deploy") || lower.startsWith("init git")) {
      return { ok: true, type: "execution", reply: "[AI] Deploy pipeline is automatic. Use the Live Preview tab to see status, logs, and URL." };
    }

    return {
      ok: false,
      type: "execution",
      reply: "[AI] Try: create file src/pages/Home.tsx, create folder src/widgets, rename x to y, move x to y, delete x, open x",
    };
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const userMessage = chatInput.trim();
    let result: { ok: boolean; reply: string; type: "planning" | "execution" | "file" };
    try {
      result = await runCommand(userMessage);
    } catch (error: any) {
      result = {
        ok: false,
        type: "execution",
        reply: `[AI] Failed to apply operation: ${error?.response?.data?.detail || error?.message || "unknown error"}`,
      };
    }
    setManualConversation((prev) => [...prev, { role: "user", message: userMessage }, { role: "assistant", message: result.reply, messageType: result.type }]);
    setChatInput("");
  };

  const computeDefaultRepoName = () => {
    if (!workspaceId) return "";
    const slug = idea
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const suffix = workspaceId.split("-")[0];
    return (slug ? `${slug}-${suffix}` : `ai-ide-${suffix}`).slice(0, 80);
  };

  const initializeGitAndPush = async (opts?: { repoName?: string; githubToken?: string }) => {
    if (!workspaceId) return;
    const token = (opts?.githubToken ?? githubToken).trim();
    const name = (opts?.repoName ?? repoName).trim();
    if (!name || !token) return;
    setIsGitBusy(true);
    try {
      const response = await apiClient.post("/ai-ide/git/init-and-push", {
        workspace_id: workspaceId,
        github_token: token,
        repo_name: name,
        private: repoPrivate,
        branch: branchName.trim() || "main",
      });
      setRepoUrl(response.data?.repo_url ?? null);
      dispatch({ type: "ADD_LOG", message: `✓ Repository initialized: ${String(response.data?.repo_url || "")}` });
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "unknown error";
      dispatch({ type: "ADD_LOG", message: `✗ Git initialization failed: ${detail}` });
    } finally {
      setIsGitBusy(false);
    }
  };

  const autoDeployOnce = async () => {
    if (!workspaceId) return;
    if (autoDeployedRef.current) return;
    if (status === "idle" || status === "creating" || status === "error") return;
    if (!githubToken.trim()) return; // Silently skip no token banner in chat

    autoDeployedRef.current = true;
    onOpenPreview();
    const defaultRepo = repoName.trim() ? repoName.trim() : computeDefaultRepoName();
    if (!repoName.trim() && defaultRepo) setRepoName(defaultRepo);
    await initializeGitAndPush({ repoName: defaultRepo, githubToken: githubToken.trim() });
    await deployWorkspace();
  };

  useEffect(() => {
    void autoDeployOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, workspaceId, githubToken]);

  useEffect(() => {
    if (!workspaceId) return;
    if (redeployNonce === lastRedeployNonceRef.current) return;
    lastRedeployNonceRef.current = redeployNonce;
    if (redeployNonce === 0) return;

    onOpenPreview();

    void (async () => {
      await commitAndPush();
      await deployWorkspace();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redeployNonce, workspaceId]);

  const commitAndPush = async () => {
    if (!workspaceId) return;
    setIsGitBusy(true);
    try {
      const response = await apiClient.post<{ sha?: string }>("/ai-ide/git/commit-and-push", {
        workspace_id: workspaceId,
        message: commitMessage.trim() || "chore: update AI IDE workspace",
        branch: branchName.trim() || "main",
      });
      const sha = response.data?.sha || "";
      setCommitSha(sha);
      dispatch({ type: "ADD_LOG", message: `✓ Pushed commit ${sha.slice(0, 7)}` });
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "unknown error";
      dispatch({ type: "ADD_LOG", message: `✗ Commit/push failed: ${detail}` });
    } finally {
      setIsGitBusy(false);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (logPollRef.current) { window.clearInterval(logPollRef.current); logPollRef.current = null; }
  };

  const deployWorkspace = async () => {
    if (!workspaceId) return;
    stopPolling();
    setIsDeployBusy(true);
    setDeployStatus({ status: "INITIALIZING" });
    setDeployLogs([]);
    setDeployedUrl(null);
    try {
      const response = await apiClient.post<{ deployment_id?: string; deploymentId?: string; status?: string; url?: string; domains?: string[] }>("/ai-ide/deploy", {
        workspace_id: workspaceId,
        branch: branchName.trim() || "main",
        target: "production",
      });
      const deploymentId = response.data?.deployment_id ?? response.data?.deploymentId;
      const responseDomains: string[] = Array.isArray(response.data?.domains) ? response.data.domains : [];
      if (response.data?.status) {
        setDeployStatus({ status: response.data.status, url: response.data.url, domains: responseDomains });
      }
      // Prefer stable alias (domains[0]) over the deployment-specific URL aliases work in iframes
      const stableAlias = responseDomains[0] ? normalizeDeploymentUrl(responseDomains[0]) : null;
      const initialUrl =
        stableAlias ??
        normalizeDeploymentUrl(response.data?.url) ??
        normalizeDeploymentUrl(response.data?.domains?.[1]);
      if (stableAlias) setStableDomain(stableAlias);
      if (initialUrl) setDeployedUrl(initialUrl);
      dispatch({ type: "ADD_LOG", message: `✓ Deployment triggered: ${deploymentId}` });
      // No chat message deploy progress is visible in the Live Preview logs panel

      if (deploymentId) {
        pollRef.current = window.setInterval(async () => {
          try {
            const statusRes = await apiClient.get<{ status: string; url?: string; domains?: string[] }>(`/deployments/${deploymentId}/status`);
            const polledDomains: string[] = Array.isArray(statusRes.data.domains) ? statusRes.data.domains : [];
            setDeployStatus({ status: statusRes.data.status, url: statusRes.data.url, domains: polledDomains });
            // Always prefer stable alias from domains[0]
            const polledStable = polledDomains[0] ? normalizeDeploymentUrl(polledDomains[0]) : null;
            const polledUrl = polledStable ?? normalizeDeploymentUrl(statusRes.data.url);
            if (polledStable) setStableDomain(polledStable);
            if (polledUrl) setDeployedUrl(polledUrl);
            if (FINAL_DEPLOY_STATES.has(statusRes.data.status)) {
              stopPolling();
              if (statusRes.data.status === "READY") {
                dispatch({ type: "ADD_LOG", message: `✓ Deployment ready: ${polledStable ?? statusRes.data.url}` });
              }
            }
          } catch {}
        }, 5000);

        logPollRef.current = window.setInterval(async () => {
          try {
            const logsRes = await apiClient.get<{ events?: Array<{ id?: string; message?: string; timestamp?: number; level?: string }> }>(`/deployments/${deploymentId}/events?limit=50`);
            setDeployLogs(logsRes.data.events || []);
          } catch {}
        }, 5000);
        window.setTimeout(() => stopPolling(), 10 * 60 * 1000);
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "unknown error";
      setDeployStatus({ status: "ERROR" });
      dispatch({ type: "ADD_LOG", message: `✗ Deployment failed: ${detail}` });
    } finally {
      setIsDeployBusy(false);
    }
  };

  const setTokenInteractively = () => {
    const next = window.prompt("Paste GitHub token (stored locally in this browser only)")?.trim();
    if (!next) return;
    try {
      window.localStorage.setItem(RUNTIME_GITHUB_TOKEN_STORAGE_KEY, next);
    } catch {}
    setGithubToken(next);
    setManualConversation((prev) => [
      ...prev,
      { role: "assistant", message: "[AI] Token saved locally. Auto-deploy will start now.", messageType: "execution" },
    ]);
  };

  return (
    <div className={cn("h-full flex flex-col", isDark ? "bg-[#0f172a]/95 text-slate-100" : "bg-white text-slate-900")}>
      <div className={cn("px-4 py-3 border-b flex-shrink-0 flex items-center justify-between", isDark ? "border-slate-700/80 bg-[#0f172a]" : "border-slate-200 bg-slate-50")}>
        <div className="flex items-center gap-2">
          <Bot className={cn("h-4 w-4", isDark ? "text-cyan-300" : "text-cyan-700")} />
          <span className={cn("text-[11px] font-semibold uppercase tracking-[0.16em]", isDark ? "text-cyan-300" : "text-cyan-700")}>AI Chat</span>
        </div>
        <div className="flex items-center gap-2">
          {!githubToken.trim() && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2 gap-1 rounded-md"
              onClick={setTokenInteractively}
            >
              <Github className="h-3 w-3" />
              Set Token
            </Button>
          )}
          {(status === "done" || status === "error") && (
            <Button variant="outline" size="sm" className="h-6 text-xs px-2 gap-1 rounded-md" onClick={reset}>
              <RefreshCw className="h-3 w-3" />
              New Session
            </Button>
          )}
        </div>
      </div>

      <div className="h-full min-h-0 grid grid-rows-[1fr_auto]">
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-3">
            <AnimatePresence initial={false}>
              {chatMessages.map((msg, i) => (
                <motion.div
                  key={`${msg.message}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    "flex gap-2",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === "assistant" && (
                    <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-xs",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-auto"
                        : "bg-muted text-foreground"
                    )}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{msg.message}</pre>
                  </div>

                  {msg.role === "user" && (
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            <div ref={logEndRef} />
          </div>
        </ScrollArea>

        <div className="p-2 border-t border-border/50 flex-shrink-0">
          <div className="flex gap-2">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder="Describe what to create/edit/open…"
              className="min-h-[60px] max-h-[120px] resize-none text-xs"
            />
            <Button
              size="sm"
              className="self-end h-9 w-9 p-0"
              type="button"
              onClick={sendChat}
              disabled={!chatInput.trim()}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IdeLayout({ idea }: { idea: string }) {
  const { state } = useAiIde();
  const { workspaceId, status } = state;
  const isMobile = useIsMobile();
  const { startGeneration } = useAiGenerationWS(workspaceId);
  const startedRef = useRef(false);
  const [centerTab, setCenterTab] = useState<"editor" | "preview">("editor");
  const [redeployNonce, setRedeployNonce] = useState(0);
  const [leftPane, setLeftPane] = useState<LeftPaneKey>("explorer");
  const [deployInfo, setDeployInfo] = useState<{
    deployedUrl: string | null;
    deployStatus: DeployStatus | null;
    deployLogs: DeployLogEvent[];
    repoUrl: string | null;
    stableDomain: string | null;
  }>({ deployedUrl: null, deployStatus: null, deployLogs: [], repoUrl: null, stableDomain: null });

  // Auto-start generation once workspaceId is ready and status is "planning"
  useEffect(() => {
    if (workspaceId && !startedRef.current && status === "planning") {
      startedRef.current = true;
      startGeneration(idea);
    }
  }, [workspaceId, status, idea, startGeneration]);

  const badge = STATUS_BADGE[status];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full bg-background"
    >
      <div className="h-9 border-b border-border/50 bg-muted/20 flex items-center px-3 gap-2 flex-shrink-0">
        <span className="text-xs text-muted-foreground truncate max-w-[220px]">
          AI IDE Workspace
        </span>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <span className="text-xs text-muted-foreground">main</span>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <BrainCircuit className="h-3.5 w-3.5" />
            <span className="truncate max-w-[260px]">{idea}</span>
          </div>

          {badge && (
            <motion.span
              layoutId="status-badge"
              className={cn("text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide", badge.color)}
            >
              {badge.label}
            </motion.span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction={isMobile ? "vertical" : "horizontal"} className="h-full">
          {/* Left: file tree container */}
          <ResizablePanel defaultSize={isMobile ? 28 : 18} minSize={12} maxSize={isMobile ? 44 : 28}>
            <div className="h-full border-r border-border/50 flex">
              <ActivityRail
                onSearchClick={() => window.dispatchEvent(new CustomEvent("ai-ide-focus-search"))}
                isDark={false}
                activePane={leftPane}
                onSelectPane={setLeftPane}
              />
              <div className="flex-1 min-w-0">
                {leftPane === "explorer" ? <AiFileTree /> : <GitChangesPane />}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Center: Monaco editor */}
          <ResizablePanel defaultSize={isMobile ? 42 : 56} minSize={22}>
            <div className="h-full">
              <div className="h-full flex flex-col">
                <div className="h-9 border-b border-border/50 bg-muted/10 flex items-center px-2 gap-2 flex-shrink-0">
                  <div className="rounded-md border border-border/50 bg-background/60 p-0.5">
                    <button
                      className={cn(
                        "h-7 px-3 text-xs rounded transition-colors",
                        centerTab === "editor" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setCenterTab("editor")}
                    >
                      Editor
                    </button>
                    <button
                      className={cn(
                        "h-7 px-3 text-xs rounded transition-colors",
                        centerTab === "preview" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setCenterTab("preview")}
                    >
                      Live Preview
                    </button>
                  </div>

                  {centerTab === "preview" && (
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        variant="outline"
                        onClick={() => setRedeployNonce((n) => n + 1)}
                        disabled={status !== "done"}
                        title={status !== "done" ? "Wait until generation completes" : "Push + redeploy latest changes"}
                      >
                        <Rocket className="h-3.5 w-3.5 mr-1.5" />
                        Update & Redeploy
                      </Button>
                      {(deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)) && (
                        <a
                          href={(deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)) as string}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium max-w-[260px] truncate"
                        >
                          <Globe className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{deployInfo.stableDomain ?? normalizeDeploymentUrl(deployInfo.deployedUrl)}</span>
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {centerTab === "editor" ? (
                  <div className="flex-1 min-h-0">
                    <AiCodeEditor />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    {/* Use stableDomain (domains[0] stable production alias) for iframe.
                        The deployment-specific URL (url field) blocks iframes; the alias allows it. */}
                    <div className="flex-1 relative min-h-0">
                      {deployInfo.deployStatus?.status === "READY" && deployInfo.stableDomain ? (
                        <iframe
                          key={deployInfo.stableDomain}
                          title="Live Preview"
                          src={deployInfo.stableDomain}
                          className="absolute inset-0 w-full h-full border-0 bg-white"
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 bg-muted/5">
                          <div className={cn(
                            "h-16 w-16 rounded-2xl flex items-center justify-center",
                            deployInfo.deployStatus?.status === "ERROR"
                              ? "bg-red-50 border border-red-200"
                              : "bg-amber-50 border border-amber-200"
                          )}>
                            {deployInfo.deployStatus?.status === "ERROR" ? (
                              <ServerCrash className="h-8 w-8 text-red-700" />
                            ) : (
                              <Loader2 className="h-8 w-8 text-amber-700 animate-spin" />
                            )}
                          </div>

                          <div className="text-center space-y-1">
                            <p className="text-sm font-semibold text-foreground">
                              {deployInfo.deployStatus?.status === "ERROR"
                                ? "Deployment Failed"
                                : deployInfo.deployStatus?.status
                                  ? `Deploying… (${deployInfo.deployStatus.status})`
                                  : "Waiting for deployment…"}
                            </p>
                            {(deployInfo.stableDomain ?? deployInfo.deployedUrl) && (
                              <p className="text-xs text-muted-foreground font-mono break-all max-w-xs">
                                {deployInfo.stableDomain ?? deployInfo.deployedUrl}
                              </p>
                            )}
                          </div>

                          {(deployInfo.stableDomain ?? deployInfo.deployedUrl) && (
                            <a
                              href={(deployInfo.stableDomain ?? deployInfo.deployedUrl) as string}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all"
                            >
                              <Globe className="h-4 w-4" />
                              Open while deploying
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-border/50 bg-muted/5">
                      <div className="px-3 py-2 flex items-center gap-2 text-xs">
                        <span className="font-medium">Deploy logs</span>
                        {deployInfo.deployStatus && (
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border",
                            deployInfo.deployStatus.status === "READY"
                              ? "border-positive/25 bg-positive/10 text-positive"
                              : deployInfo.deployStatus.status === "ERROR"
                                ? "border-red-200 bg-red-50 text-red-500"
                                : "border-amber-200 bg-amber-50 text-amber-600"
                          )}>
                            {deployInfo.deployStatus.status}
                          </span>
                        )}
                        {deployInfo.repoUrl && (
                          <a
                            href={deployInfo.repoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
                          >
                            Repo <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <ScrollArea className="h-40">
                        <div className="p-3 font-mono text-[11px] space-y-1">
                          {(deployInfo.deployLogs.length ? deployInfo.deployLogs : [{ message: "No logs yet." }]).slice(-120).map((log, idx) => {
                            const msg = String(log.message || "").trim();
                            const ts = log.timestamp
                              ? new Date(log.timestamp > 1000000000000 ? log.timestamp : log.timestamp * 1000).toLocaleTimeString()
                              : "";
                            const level = String(log.level || "info");
                            return (
                              <div key={idx} className="flex gap-2 text-muted-foreground">
                                <span className="w-[70px] flex-shrink-0 opacity-60">{ts || "--:--:--"}</span>
                                <span className={cn(
                                  "w-[52px] flex-shrink-0 uppercase",
                                  level.includes("error") ? "text-red-500" : level.includes("warn") ? "text-amber-500" : "text-muted-foreground"
                                )}>
                                  {level}
                                </span>
                                <span className="break-words text-foreground/80">{msg || "(empty)"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right: telemetry + chat */}
          <ResizablePanel defaultSize={isMobile ? 30 : 26} minSize={20} maxSize={isMobile ? 45 : 40}>
            <div className="h-full border-l border-border/50">
              <RightRail
                idea={idea}
                onDeploymentUpdate={setDeployInfo}
                onOpenPreview={() => setCenterTab("preview")}
                redeployNonce={redeployNonce}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="h-7 border-t border-border/50 bg-muted/20 px-3 text-[10px] flex items-center gap-4 text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" />
          <span>main</span>
        </div>
        <div className="flex items-center gap-1.5">
          <FolderTree className="h-3 w-3" />
          <span>{state.filePaths.length} files</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Terminal className="h-3 w-3" />
          <span>Agent session live</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Root orchestrator ─────────────────────────────────────────────────────────

function AiIdeInner() {
  const { state, dispatch } = useAiIde();
  const [currentIdea, setCurrentIdea] = useState<string | null>(null);

  const handleBuild = async (idea: string) => {
    dispatch({ type: "SET_STATUS", status: "creating", message: "Allocating Neural Matrix..." });
    setCurrentIdea(idea);
    try {
      const res = await apiClient.post<{ workspace_id: string; file_paths: string[] }>(
        "/ai-ide/workspace/create"
      );
      const { workspace_id, file_paths } = res.data;
      const filesRes = await apiClient.get<Record<string, string>>(`/ai-ide/workspace/${workspace_id}/files`);

      const initialFiles: Record<string, string> = { ...filesRes.data };
      file_paths.forEach((path) => {
        if (!(path in initialFiles)) initialFiles[path] = "";
      });

      dispatch({ type: "SET_WORKSPACE", workspaceId: workspace_id, initialFiles });
      dispatch({ type: "SET_STATUS", status: "planning", message: "Synthesizing Architecture..." });
    } catch (err) {
      dispatch({
        type: "SET_STATUS",
        status: "error",
        message: err?.response?.data?.detail || "Failed to initialize workspace matrix",
      });
      setCurrentIdea(null);
    }
  };

  if (!currentIdea || state.status === "idle" || state.status === "creating") {
    return <IdeaScreen onBuild={handleBuild} />;
  }

  return <IdeLayout idea={currentIdea} />;
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function AiIde() {
  return (
    <AiIdeProvider>
      <div className="h-full w-full flex flex-col font-sans relative">
        <AiIdeInner />
      </div>
    </AiIdeProvider>
  );
}
