import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTestSelectionHistory() {
  return useQuery({
    queryKey: ["test-selection", "history"],
    queryFn: () => api.listTestSelectionHistory(),
  });
}

export function useTestSelectionRun(id: string | undefined) {
  return useQuery({
    queryKey: ["test-selection", "detail", id],
    queryFn: () => api.getTestSelectionRun(id as string),
    enabled: !!id,
  });
}

export function useTestOptimizationReport(repoId: string | undefined) {
  return useQuery({
    queryKey: ["test-selection", "optimization", repoId],
    queryFn: () => api.getTestOptimizationReport(repoId as string),
    enabled: !!repoId,
  });
}

export function useAnalyzeTestSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, githubUrl, oldSha, newSha }: { repoId: string; githubUrl: string; oldSha?: string; newSha?: string }) =>
      api.analyzeTestSelection(repoId, githubUrl, oldSha, newSha),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-selection"] });
    },
  });
}

export function useExecuteTestSelection(id: string) {
  return useMutation({
    mutationFn: (targetUrl: string) => api.executeTestSelection(id, targetUrl),
  });
}
