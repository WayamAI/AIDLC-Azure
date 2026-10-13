import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Mark";
import {
  Loader2,
  GitBranch,
  ChevronDown,
  ChevronRight,
  PanelRight,
  ArrowLeft,
  GitFork,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceProvider, useWorkspaceContext } from "@/context/WorkspaceContext";
import { ViewEntryTree } from "@/components/workspace/ViewEntryTree";
import { TreeFlowView } from "@/components/workspace/TreeFlowView";
import { EditorArea } from "@/components/workspace/EditorArea";
import { CopilotPanel } from "@/components/workspace/CopilotPanel";
import { CommitPanel } from "@/components/workspace/CommitPanel";
import { StatusBar } from "@/components/workspace/StatusBar";
import { useConnectWorkspace } from "@/hooks/use-workspace";
import { toast } from "sonner";
import { useActiveRepo } from "@/context/RepoContext";
import { api } from "@/lib/api";
import { parseGithubRepo } from "@/lib/github-repo";

// ── Connect form ──────────────────────────────────────────────────────────────

function ConnectForm({
  initialRepoUrl,
  initialBranch,
  onConnected,
}: {
  initialRepoUrl?: string;
  initialBranch?: string;
  onConnected?: (args: { githubUrl: string; branch: string; pat?: string }) => void;
} = {}) {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl ?? activeRepo?.repoUrl ?? "");
  const [branch, setBranch] = useState(initialBranch ?? activeRepo?.branch ?? "main");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const branchTouched = useRef(Boolean(initialBranch || activeRepo?.branch));
  const { setWorkspace } = useWorkspaceContext();
  const connectMutation = useConnectWorkspace();

  useEffect(() => {
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed || branchTouched.current) return;
    const timer = window.setTimeout(() => {
      api.getDefaultBranch(parsed.repoUrl)
        .then((res) => {
          if (!branchTouched.current && res.branch) setBranch(res.branch);
        })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [repoUrl]);

  const handleConnect = async () => {
    if (!repoUrl.trim()) return;
    let url = repoUrl.trim();
    if (!url.startsWith("http")) url = `https://github.com/${url}`;
    try {
      const result = await connectMutation.mutateAsync({
        github_url: url,
        branch,
        pat: pat || undefined,
      });
      setWorkspace(result);
      setActiveRepo(url, branch);
      onConnected?.({ githubUrl: url, branch, pat: pat || undefined });
      toast.success("Repository connected");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to connect repository");
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Mark id="mark-ai-workspace" size={40} />
            <h2 className="font-display text-lg font-normal text-ink">Connect a repository</h2>
          </div>
          <p className="text-sm text-ink-tertiary">
            Enter a GitHub repository to open it in the editor with the copilot, test generation and impact tree.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Repository URL or owner/repo</Label>
            <Input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConnect();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Branch</Label>
            <div className="relative">
              <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={branch}
                onChange={(e) => {
                  branchTouched.current = true;
                  setBranch(e.target.value);
                }}
                className="pl-9"
                placeholder="default branch"
              />
            </div>
          </div>

          <Collapsible open={showPat} onOpenChange={setShowPat}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-ink transition-colors">
                {showPat ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Personal Access Token (for private repos)
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <Input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                className="text-sm"
              />
              <p className="text-xs text-ink-tertiary mt-1">
                The token is sent to the backend to clone and push; it is not stored in the browser.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <Button
          onClick={handleConnect}
          className="w-full"
          disabled={connectMutation.isPending || !repoUrl.trim()}
        >
          {connectMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Cloning repository…
            </>
          ) : (
            "Connect and clone"
          )}
        </Button>

        <p className="text-xs text-ink-tertiary">
          Repository is shallow-cloned (depth 1) into a temporary workspace. Changes are
          committed and pushed to GitHub on your behalf.
        </p>
      </div>
    </div>
  );
}

// ── Workspace layout ──────────────────────────────────────────────────────────

interface WorkspaceLayoutProps {
  onCommitSuccess?: (sha: string, url: string) => void;
  onTestsGenerated?: (tests: import("@/lib/api").WorkspacePlaywrightTest[]) => void;
  initialRepoUrl?: string;
  initialBranch?: string;
  onConnected?: (args: { githubUrl: string; branch: string; pat?: string }) => void;
}

export function WorkspaceLayout({
  onCommitSuccess,
  onTestsGenerated,
  initialRepoUrl,
  initialBranch,
  onConnected,
}: WorkspaceLayoutProps = {}) {
  const { workspace } = useWorkspaceContext();
  const [showCommit, setShowCommit] = useState(false);
  const [treeRefreshNonce, setTreeRefreshNonce] = useState(0);
  /** "code" → EditorArea in center | "tree" → TreeFlowView in center */
  const [centerMode, setCenterMode] = useState<"code" | "tree">("code");

  if (!workspace)
    return <ConnectForm initialRepoUrl={initialRepoUrl} initialBranch={initialBranch} onConnected={onConnected} />;

  const isTreeMode = centerMode === "tree";

  return (
    <div className="flex flex-col h-full">
      {/* ── Top toolbar ── */}
      <div className="h-11 border-b border-stroke-muted flex items-center px-4 gap-3 flex-shrink-0">
        <span className="font-mono text-xs text-ink-secondary truncate max-w-[240px]">
          {workspace.repo_url.split("/").slice(-2).join("/")}
        </span>
        <span className="font-mono text-xs text-ink-tertiary">{workspace.branch}</span>

        <div className="ml-auto flex items-center gap-2">
          {isTreeMode ? (
            /* Back to code view */
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs px-2.5"
              onClick={() => setCenterMode("code")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to code view
            </Button>
          ) : (
            /* Switch to tree view also refresh the impact tree */
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs px-2.5"
              onClick={() => {
                setTreeRefreshNonce((v) => v + 1);
                setCenterMode("tree");
              }}
            >
              <GitFork className="h-4 w-4 mr-1" />
              View as tree
            </Button>
          )}

          <Button
            variant={showCommit ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs px-2.5"
            onClick={() => setShowCommit((v) => !v)}
          >
            <PanelRight className="h-4 w-4 mr-1" />
            Commit
          </Button>
        </div>
      </div>

      {/* ── Main panels ── */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">

          {/* Left panel: Impact tree always visible */}
          <ResizablePanel
            defaultSize={18}
            minSize={12}
            maxSize={30}
            className="border-r border-stroke-muted"
          >
            <ViewEntryTree refreshNonce={treeRefreshNonce} />
          </ResizablePanel>

          <ResizableHandle />

          {/* Center panel: code editor OR flow visualization */}
          <ResizablePanel defaultSize={isTreeMode ? (showCommit ? 68 : 82) : (showCommit ? 44 : 57)}>
            {isTreeMode ? (
              <TreeFlowView
                onBackToCode={() => setCenterMode("code")}
                onTestsGenerated={onTestsGenerated}
              />
            ) : <EditorArea />}
          </ResizablePanel>

          {/* Copilot panel hidden in tree mode */}
          {!isTreeMode && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
                <CopilotPanel />
              </ResizablePanel>
            </>
          )}

          {/* Commit panel (optional slide-in) */}
          {showCommit && (
            <>
              <ResizableHandle />
              <ResizablePanel
                defaultSize={14}
                minSize={12}
                maxSize={22}
                className="border-l border-stroke-muted"
              >
                <div className="h-full flex flex-col">
                  <div className="flex h-11 items-center px-3 border-b border-stroke-muted flex-shrink-0">
                    <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Commit and push</p>
                  </div>
                  <ScrollArea className="flex-1">
                    <CommitPanel onCommitSuccess={onCommitSuccess} />
                  </ScrollArea>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

export default function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}
