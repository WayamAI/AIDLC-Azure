import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, CommitRequest } from "@/lib/api";

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
