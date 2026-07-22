import { useState } from "react";
import { GitCommit, GitBranch, Loader2, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useGitStatus, useCommitAndPush, useCreateBranch } from "@/hooks/use-git";
import { toast } from "sonner";

export function CommitPanel({ onCommitSuccess }: { onCommitSuccess?: (sha: string, url: string) => void } = {}) {
  const { workspace, openTabs, diffState, currentBranch, setCurrentBranch } = useWorkspaceContext();
  const [commitMsg, setCommitMsg] = useState(diffState?.commitMessage ?? "");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [newBranchName, setNewBranchName] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [commitResult, setCommitResult] = useState<{ sha: string; github_url: string } | null>(null);

  const { data: gitStatus } = useGitStatus(workspace?.workspace_id ?? null);
  const commitMutation = useCommitAndPush();
  const branchMutation = useCreateBranch();

  // Pre-fill commit message from AI suggestion when available
  if (diffState?.commitMessage && !commitMsg) {
    setCommitMsg(diffState.commitMessage);
  }

  const dirtyFiles = openTabs.filter((t) => t.isDirty).map((t) => t.path);
  const allChangedFiles = [...new Set([
    ...dirtyFiles,
    ...(gitStatus?.unstaged ?? []),
    ...(gitStatus?.untracked ?? []),
  ])];

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCommit = async () => {
    if (!workspace || selectedFiles.size === 0 || !commitMsg.trim()) {
      toast.error("Select files and enter a commit message");
      return;
    }

    // Build new_file_contents from dirty open tabs
    const newFileContents: Record<string, string> = {};
    openTabs.forEach((tab) => {
      if (selectedFiles.has(tab.path) && tab.isDirty) {
        newFileContents[tab.path] = tab.content;
      }
    });

    try {
      const result = await commitMutation.mutateAsync({
        workspace_id: workspace.workspace_id,
        branch: currentBranch,
        files: Array.from(selectedFiles),
        message: commitMsg,
        new_file_contents: newFileContents,
      });
      setCommitResult({ sha: result.sha, github_url: result.github_url });
      onCommitSuccess?.(result.sha, result.github_url);
      toast.success(`Committed ${result.sha.slice(0, 7)} → ${currentBranch}`);
      setSelectedFiles(new Set());
      setCommitMsg("");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Commit failed");
    }
  };

  const handleCreateBranch = async () => {
    if (!workspace || !newBranchName.trim()) return;
    try {
      await branchMutation.mutateAsync({
        workspace_id: workspace.workspace_id,
        branch_name: newBranchName,
        from_branch: currentBranch,
      });
      setCurrentBranch(newBranchName);
      setBranchOpen(false);
      setNewBranchName("");
      toast.success(`Switched to branch ${newBranchName}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to create branch");
    }
  };

  if (!workspace) return null;

  return (
    <div className="space-y-3 p-3">
      {/* Branch selector */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 bg-muted/30 rounded px-2 py-1">
          <GitBranch className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="text-xs truncate">{currentBranch}</span>
        </div>
        <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 w-6 p-0 flex-shrink-0">
              <Plus className="h-3 w-3" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>New Branch</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Branch name</Label>
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feat/my-feature"
                  className="mt-1"
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateBranch(); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">From: {currentBranch}</p>
              <Button onClick={handleCreateBranch} className="w-full" disabled={branchMutation.isPending}>
                {branchMutation.isPending ? "Creating…" : "Create & Switch"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* File checklist */}
      {allChangedFiles.length > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Changed files</p>
            <button
              className="text-[10px] text-primary"
              onClick={() => setSelectedFiles(new Set(allChangedFiles))}
            >
              Select all
            </button>
          </div>
          {allChangedFiles.map((f) => (
            <div key={f} className="flex items-center gap-2 text-xs py-0.5">
              <Checkbox
                checked={selectedFiles.has(f)}
                onCheckedChange={() => toggleFile(f)}
                className="h-3 w-3"
              />
              <span className="truncate font-mono">{f}</span>
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 ml-auto flex-shrink-0">M</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">No modified files</p>
      )}

      {/* Commit message */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Commit message</Label>
        <Textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="feat: describe your changes"
          className="min-h-[56px] max-h-[100px] resize-none text-xs"
        />
      </div>

      <Button
        onClick={handleCommit}
        className="w-full h-8 text-xs"
        disabled={commitMutation.isPending || selectedFiles.size === 0 || !commitMsg.trim()}
      >
        {commitMutation.isPending
          ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Pushing…</>
          : <><GitCommit className="h-3 w-3 mr-1" />Commit &amp; Push</>
        }
      </Button>

      {/* Last commit result */}
      {commitResult && (
        <div className="rounded border border-primary/30/20 bg-positive/10 p-2 text-xs space-y-1">
          <p className="text-positive font-medium">Pushed {commitResult.sha.slice(0, 7)}</p>
          <a
            href={commitResult.github_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            View on GitHub
          </a>
        </div>
      )}
    </div>
  );
}
