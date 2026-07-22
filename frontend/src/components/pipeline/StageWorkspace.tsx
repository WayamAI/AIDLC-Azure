import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineContext } from "@/context/PipelineContext";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { WorkspaceLayout } from "@/pages/Workspace";
import { api } from "@/lib/api";
import type { WorkspacePlaywrightTest } from "@/lib/api";
import { toast } from "sonner";

function WorkspaceWithCapture() {
  const pipeline = usePipelineContext();
  const { workspace, openTabs, currentBranch } = useWorkspaceContext();
  const [isCommitting, setIsCommitting] = useState(false);

  // Sync workspace info into pipeline context the first time we connect
  useEffect(() => {
    if (workspace && !pipeline.workspaceId) {
      const parts = workspace.repo_url.replace("https://github.com/", "").split("/");
      pipeline.setWorkspaceInfo({
        repoUrl: workspace.repo_url,
        owner: parts[0] ?? "",
        repo: parts[1] ?? "",
        branch: workspace.branch,
        workspaceId: workspace.workspace_id,
        githubPat: pipeline.githubPat,
      });
    }
  }, [workspace, pipeline.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWorkspaceConnected = useCallback(({ pat }: { githubUrl: string; branch: string; pat?: string }) => {
    pipeline.setGithubPat(pat ?? "");
  }, [pipeline]);

  const handleCommitSuccess = useCallback((sha: string, url: string) => {
    pipeline.setCommit(sha, "", url);
  }, [pipeline]);

  const handleTestsGenerated = useCallback((tests: WorkspacePlaywrightTest[]) => {
    pipeline.setTestSuite(tests);
  }, [pipeline]);

  const handleDeployAndTest = useCallback(async () => {
    const wsId = workspace?.workspace_id ?? pipeline.workspaceId;
    if (!wsId) {
      pipeline.goToStage(3);
      return;
    }

    try {
      setIsCommitting(true);

      const gitStatus = await api.getGitStatus(wsId);

      const changedFiles = [
        ...new Set([
          ...gitStatus.staged,
          ...gitStatus.unstaged,
          ...gitStatus.untracked,
          ...openTabs.filter((t) => t.isDirty).map((t) => t.path),
        ]),
      ];

      if (changedFiles.length > 0) {
        // Collect in-editor content for dirty tabs so the commit includes unsaved edits
        const newFileContents: Record<string, string> = {};
        openTabs.forEach((tab) => {
          if (changedFiles.includes(tab.path) && tab.isDirty) {
            newFileContents[tab.path] = tab.content;
          }
        });

        const commitMsg = `chore: auto-commit ${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""} before deploy`;

        const result = await api.commitAndPush({
          workspace_id: wsId,
          branch: currentBranch || workspace?.branch || pipeline.branch || "main",
          files: changedFiles,
          message: commitMsg,
          new_file_contents: newFileContents,
          github_pat: pipeline.githubPat || undefined,
        });

        pipeline.setCommit(result.sha, result.message, result.github_url);
        toast.success(`Committed ${result.sha.slice(0, 7)} deploying latest changes`);
      } else {
        toast.info("No local changes deploying latest commit");
      }

      pipeline.goToStage(3);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Failed to commit before deploy");
    } finally {
      setIsCommitting(false);
    }
  }, [workspace, pipeline, openTabs, currentBranch]);

  return (
    <div className="flex flex-col h-full">
      {/* Pipeline banner */}
      <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/20 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs text-primary/80 min-w-0">
          <span>Stage 1 Edit code and commit. Next stage is optional.</span>
          {pipeline.commitSha && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <CheckCircle2 className="h-3 w-3 text-positive" />
              <code className="font-mono bg-primary/15 text-positive px-1.5 py-0.5 rounded text-[10px]">
                {pipeline.commitSha.slice(0, 7)}
              </code>
              {pipeline.commitUrl && (
                <a
                  href={pipeline.commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
          {pipeline.testSuite.length > 0 && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <FlaskConical className="h-3 w-3 text-primary/70" />
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                {pipeline.testSuite.length} test{pipeline.testSuite.length !== 1 ? "s" : ""} ready
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {pipeline.testSuite.length > 0 ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleDeployAndTest}
              disabled={isCommitting}
            >
              {isCommitting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FlaskConical className="h-3 w-3 mr-1" />
              )}
              {isCommitting ? "Committing…" : "Deploy & Test"}
              {!isCommitting && <ArrowRight className="h-3 w-3 ml-1" />}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => pipeline.goToStage(2)}
            >
              Next <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <WorkspaceLayout
          onCommitSuccess={handleCommitSuccess}
          onTestsGenerated={handleTestsGenerated}
          initialRepoUrl={pipeline.repoUrl || undefined}
          initialBranch={pipeline.branch || undefined}
          onConnected={handleWorkspaceConnected}
        />
      </div>
    </div>
  );
}

export function StageWorkspace() {
  // WorkspaceProvider is hoisted to SDLCPipeline no wrapper here
  return <WorkspaceWithCapture />;
}
