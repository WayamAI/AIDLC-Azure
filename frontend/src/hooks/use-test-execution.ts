import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTestResults(runId?: string, limit = 100) {
  return useQuery({
    queryKey: ["test-results", runId, limit],
    queryFn: () => api.getResults(runId, limit),
  });
}

export function useRunSummary(runId: string | undefined) {
  return useQuery({
    queryKey: ["run-summary", runId],
    queryFn: () => api.getRunSummary(runId!),
    enabled: !!runId,
  });
}

export function useRunTests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.runTests>[0]) =>
      api.runTests(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-results"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}
