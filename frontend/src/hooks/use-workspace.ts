import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useConnectWorkspace() {
  return useMutation({
    mutationFn: ({ github_url, branch, pat }: { github_url: string; branch: string; pat?: string }) =>
      api.connectWorkspace(github_url, branch, pat),
  });
}

export function useWorkspaceTree(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-tree", workspaceId],
    queryFn: () => api.getWorkspaceTree(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useWorkspaceFile(workspaceId: string | null, path: string | null) {
  return useQuery({
    queryKey: ["workspace-file", workspaceId, path],
    queryFn: () => api.getWorkspaceFile(workspaceId!, path!),
    enabled: !!workspaceId && !!path,
  });
}

export function useSaveWorkspaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workspaceId, path, content }: { workspaceId: string; path: string; content: string }) =>
      api.saveWorkspaceFile(workspaceId, path, content),
    onSuccess: (_, { workspaceId, path }) => {
      qc.invalidateQueries({ queryKey: ["workspace-file", workspaceId, path] });
      qc.invalidateQueries({ queryKey: ["workspace-tree", workspaceId] });
      qc.invalidateQueries({ queryKey: ["git-status", workspaceId] });
      qc.invalidateQueries({ queryKey: ["commit-impact-tree", workspaceId] });
    },
  });
}

export function useDeleteWorkspace() {
  return useMutation({
    mutationFn: (workspaceId: string) => api.deleteWorkspace(workspaceId),
  });
}
