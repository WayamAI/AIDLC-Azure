import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const POLL_MS = 2000;

/** Polls while the run is in progress, then stops. */
export function useRunSummary(runId: string | undefined) {
  return useQuery({
    queryKey: ["run-summary", runId],
    queryFn: () => api.getRunSummary(runId!),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? POLL_MS : false),
    // A run takes minutes; keep following it when the user switches tabs.
    refetchIntervalInBackground: true,
  });
}

export function useTestResults(runId: string | undefined, running: boolean) {
  return useQuery({
    queryKey: ["test-results", runId],
    queryFn: () => api.getResults(runId, 500),
    enabled: !!runId,
    refetchInterval: running ? POLL_MS : false,
    refetchIntervalInBackground: true,
  });
}

export function useRunHistory(requirementId: string | undefined) {
  return useQuery({
    queryKey: ["test-runs", requirementId],
    queryFn: () => api.listRuns(requirementId),
    enabled: !!requirementId,
  });
}

export function useRunTests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.runTests>[0]) => api.runTests(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-runs"] });
    },
  });
}
