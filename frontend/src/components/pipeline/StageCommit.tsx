import { useState } from "react";
import { GitCommit, ArrowRight, ExternalLink, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePipelineContext } from "@/context/PipelineContext";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { CommitPanel } from "@/components/workspace/CommitPanel";

function CommitStageInner() {
  const { repoUrl, owner, repo, branch, commitSha, commitUrl, setCommit, completeStage, goToStage } = usePipelineContext();
  const [justCommitted, setJustCommitted] = useState(!!commitSha);

  const handleCommitSuccess = (sha: string, url: string) => {
    // Derive commit message from SHA (the CommitPanel already has it internally)
    setCommit(sha, "", url);
    setJustCommitted(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Banner */}
      <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/20 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-primary/80">
          <span className="font-medium">{owner}/{repo}</span>
          <span className="text-muted-foreground">·</span>
          <span>{branch}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => goToStage(1)}>
            ← Back
          </Button>
          {commitSha && (
            <Button size="sm" className="h-7 text-xs" onClick={() => completeStage(2)}>
              Next <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center p-6 gap-6 overflow-auto">
        {/* Commit panel */}
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
              <GitCommit className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Commit & Push</span>
            </div>
            <ScrollArea className="max-h-[calc(100vh-220px)]">
              <CommitPanel onCommitSuccess={handleCommitSuccess} />
            </ScrollArea>
          </div>
        </div>

        {/* Success card */}
        {commitSha && justCommitted && (
          <div className="w-full max-w-sm">
            <div className="rounded-xl border border-positive/25 bg-positive/10 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/15 border border-positive/25 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-positive" />
                </div>
                <div>
                  <p className="font-medium text-sm text-positive">Committed successfully</p>
                  <code className="text-xs text-muted-foreground font-mono">{commitSha.slice(0, 7)}</code>
                </div>
              </div>
              {commitUrl && (
                <a href={commitUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ExternalLink className="h-3 w-3" /> View on GitHub
                </a>
              )}
              <p className="text-xs text-muted-foreground">
                SHA captured ready for AI code review in Stage 3.
              </p>
              <Button className="w-full h-8 text-xs" onClick={() => completeStage(2)}>
                Next <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StageCommit() {
  return (
    <WorkspaceProvider>
      <CommitStageInner />
    </WorkspaceProvider>
  );
}
