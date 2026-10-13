import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, CommitRequest, CommitResult, PushRequest } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";

export function useGitStatus(workspaceId: string | null) {
  return useQuery({
    queryKey: ["git-status", workspaceId],
    queryFn: () => api.getGitStatus(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 8000,
    staleTime: 0,
  });
}

export function useGitLog(workspaceId: string | null) {
  return useQuery({
    queryKey: ["git-log", workspaceId],
    queryFn: () => api.getGitLog(workspaceId!),
    enabled: !!workspaceId,
  });
}

export function useCreateBranch() {
  return useMutation({
    mutationFn: (payload: { workspace_id: string; branch_name: string; from_branch?: string }) =>
      api.createBranch(payload),
  });
}

export function useCommitAndPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CommitRequest) => api.commitAndPush(payload),
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: ["workspace-tree", payload.workspace_id] });
      qc.invalidateQueries({ queryKey: ["git-status", payload.workspace_id] });
      qc.invalidateQueries({ queryKey: ["git-log", payload.workspace_id] });
      qc.invalidateQueries({ queryKey: ["commit-impact-tree", payload.workspace_id] });
    },
  });
}

// ── Unpushed commit ─────────────────────────────────────────────────────────
// A commit whose push failed exists only in the server-side clone. That fact is
// taken from the commit response and held in memory for the page's lifetime, so
// every commit surface of a workspace (commit panel, test wizard, pipeline
// stage) shows the same "Retry push" state. POST /api/git/push does the retry.

export interface UnpushedCommit {
  sha: string;
  branch: string;
  /** Why the last push attempt failed, as the server reported it. */
  error: string;
}

const unpushedCommits = new Map<string, UnpushedCommit>();
const unpushedListeners = new Set<() => void>();

function setUnpushed(workspaceId: string, value: UnpushedCommit | null): void {
  if (value) unpushedCommits.set(workspaceId, value);
  else if (!unpushedCommits.delete(workspaceId)) return;
  unpushedListeners.forEach((notify) => notify());
}

function subscribeUnpushed(listener: () => void): () => void {
  unpushedListeners.add(listener);
  return () => {
    unpushedListeners.delete(listener);
  };
}

export function getUnpushedCommit(workspaceId: string | null | undefined): UnpushedCommit | null {
  return (workspaceId && unpushedCommits.get(workspaceId)) || null;
}

export function clearUnpushedCommit(workspaceId: string): void {
  setUnpushed(workspaceId, null);
}

/**
 * Record what a commit response says about the remote. Returns the unpushed
 * commit when the push failed, or null when the branch reached the remote
 * (a successful push sends every earlier unpushed commit on the branch too).
 */
export function recordCommitResult(workspaceId: string, result: CommitResult): UnpushedCommit | null {
  // push_ok is absent on older backends; only an explicit false is a failure.
  const unpushed =
    result.push_ok === false
      ? { sha: result.sha, branch: result.branch, error: result.push_error || "The push failed for an unknown reason." }
      : null;
  setUnpushed(workspaceId, unpushed);
  return unpushed;
}

/** The workspace's commit that is not on the remote yet, if any. Re-renders when it changes. */
export function useUnpushedCommit(workspaceId: string | null | undefined): UnpushedCommit | null {
  return useSyncExternalStore(
    subscribeUnpushed,
    () => getUnpushedCommit(workspaceId),
    () => null,
  );
}

export function unpushedCommitMessage(c: UnpushedCommit): string {
  return `Commit ${c.sha.slice(0, 7)} is saved in the workspace but is not on the remote yet. ${c.error}`;
}

/** The server's reason a push failed, always as readable text. */
export function pushErrorMessage(error: unknown): string {
  return apiErrorMessage(error, "The push failed. Try again.");
}

/** Push existing commits (no new commit). Used to retry a push that failed. */
export function usePushBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PushRequest) => api.pushBranch(payload),
    onSuccess: (_, payload) => {
      clearUnpushedCommit(payload.workspace_id);
      qc.invalidateQueries({ queryKey: ["git-status", payload.workspace_id] });
      qc.invalidateQueries({ queryKey: ["git-log", payload.workspace_id] });
    },
    onError: (error, payload) => {
      // Keep the Retry push state, with the latest reason.
      const current = getUnpushedCommit(payload.workspace_id);
      if (current) setUnpushed(payload.workspace_id, { ...current, error: pushErrorMessage(error) });
    },
  });
}
