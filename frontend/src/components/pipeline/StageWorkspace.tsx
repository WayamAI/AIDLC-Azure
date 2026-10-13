import { withConnectorsLink } from "@/components/ErrorText";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineContext } from "@/context/PipelineContext";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { WorkspaceLayout } from "@/pages/Workspace";
import { api } from "@/lib/api";
import type { WorkspacePlaywrightTest } from "@/lib/api";
import { toast } from "sonner";
import { useActiveRepo } from "@/context/RepoContext";
import {
  getUnpushedCommit,
  pushErrorMessage,
  recordCommitResult,
  unpushedCommitMessage,
  usePushBranch,
  useUnpushedCommit,
} from "@/hooks/use-git";

function WorkspaceWithCapture() {
  const pipeline = usePipelineContext();
  const { setActiveRepo } = useActiveRepo();
  const { workspace, openTabs, currentBranch } = useWorkspaceContext();
  const [isCommitting, setIsCommitting] = useState(false);
  // A commit from this workspace whose push failed: a deploy would not include it.
  const unpushed = useUnpushedCommit(workspace?.workspace_id ?? pipeline.workspaceId);
  const pushMutation = usePushBranch();
  const [pushNotice, setPushNotice] = useState<string | null>(null);

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
      setActiveRepo({
        owner: parts[0] ?? "",
        repo: (parts[1] ?? "").replace(/\.git$/, ""),
        repoUrl: workspace.repo_url,
        branch: workspace.branch,
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

  // Push a commit that already exists in the workspace. Resolves true once it is on the remote.
  const retryPush = useCallback(async (wsId: string): Promise<boolean> => {
    const pending = getUnpushedCommit(wsId);
    if (!pending) return true;
    setPushNotice(null);
    try {
      const result = await pushMutation.mutateAsync({ workspace_id: wsId, branch: pending.branch });
      pipeline.setCommit(result.sha, "", result.github_url);
      setPushNotice(result.message);
      toast.success(result.message);
      return true;
    } catch (err) {
      // The banner keeps the commit listed as unpushed, with the server's reason.
      toast.error(pushErrorMessage(err));
      return false;
    }
  }, [pipeline, pushMutation]);

  const handleDeployAndTest = useCallback(async () => {
    const wsId = workspace?.workspace_id ?? pipeline.workspaceId;
    if (!wsId) {
      pipeline.completeStage(1, 3);
      return;
    }

    try {
      setIsCommitting(true);
      setPushNotice(null);

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

        const failed = recordCommitResult(wsId, result);
        if (failed) {
          // The commit never reached GitHub, so a deploy would not include it.
          // The banner below offers Retry push.
          toast.error(unpushedCommitMessage(failed));
          return;
        }

        pipeline.setCommit(result.sha, result.message, result.github_url);
        toast.success(`Committed and pushed ${result.sha.slice(0, 7)}. Continuing to deploy.`);
      } else {
        // "Nothing to commit" is not the same as "everything is on the remote":
        // an earlier commit whose push failed is still only in the workspace.
        if (getUnpushedCommit(wsId)) {
          if (!(await retryPush(wsId))) return;
        } else {
          toast.info("No local changes. Continuing to deploy the latest pushed commit.");
        }
      }

      pipeline.completeStage(1, 3);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Failed to commit before deploy");
    } finally {
      setIsCommitting(false);
    }
  }, [workspace, pipeline, openTabs, currentBranch, retryPush]);

  return (
    <div className="flex flex-col h-full">
      {/* Pipeline banner */}
      <div className="flex h-11 items-center justify-between border-b border-stroke-muted px-4 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs text-ink-secondary min-w-0">
          <span>Edit code and commit. The Code Review stage that follows is optional.</span>
          {pipeline.commitSha && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive" />
              <code className="font-mono text-xs text-ink-secondary">
                {pipeline.commitSha.slice(0, 7)}
              </code>
              {pipeline.commitUrl && (
                <a
                  href={pipeline.commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-ink transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
          {pipeline.testSuite.length > 0 && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-xs tabular-nums text-ink-tertiary">
                {pipeline.testSuite.length} test{pipeline.testSuite.length !== 1 ? "s" : ""} ready
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {pipeline.testSuite.length > 0 ? (
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleDeployAndTest}
              disabled={isCommitting}
            >
              {isCommitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isCommitting ? "Committing…" : "Deploy and test"}
              {!isCommitting && <ArrowRight className="h-4 w-4 ml-1" />}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => pipeline.completeStage(1)}
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
      {unpushed && (
        <div role="alert" className="flex items-start gap-2 border-b border-stroke-muted bg-raised px-4 py-2 flex-shrink-0">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 break-words text-xs text-destructive">{withConnectorsLink(unpushedCommitMessage(unpushed))}</p>
          <Button
            variant="outline"
            size="sm"
            className="h-6 flex-shrink-0 px-2 text-xs"
            onClick={() => {
              const wsId = workspace?.workspace_id ?? pipeline.workspaceId;
              if (wsId) void retryPush(wsId);
            }}
            disabled={pushMutation.isPending || isCommitting}
          >
            {pushMutation.isPending
              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            {pushMutation.isPending ? "Pushing…" : "Retry push"}
          </Button>
        </div>
      )}
      {pushNotice && !unpushed && (
        <div role="status" className="flex items-start gap-2 border-b border-stroke-muted bg-raised px-4 py-2 flex-shrink-0">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-positive" />
          <p className="min-w-0 flex-1 break-words text-xs text-ink-secondary">{pushNotice}</p>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setPushNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}
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
