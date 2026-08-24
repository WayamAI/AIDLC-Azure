import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useRootCauseList() {
  return useQuery({
    queryKey: ["root-cause", "list"],
    queryFn: () => api.listRootCauses(),
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.status === "analyzing") ? 2000 : false,
  });
}

export function useRootCauseDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["root-cause", "detail", id],
    queryFn: () => api.getRootCause(id as string),
    enabled: !!id,
  });
}

export function useUnanalyzedFailures() {
  return useQuery({
    queryKey: ["root-cause", "failures"],
    queryFn: () => api.listUnanalyzedFailures(),
  });
}

export function useAnalyzeFailure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, testId }: { runId: string; testId: string }) =>
      api.analyzeFailure(runId, testId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["root-cause"] });
    },
  });
}

export function useRerunRootCauseTest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.rerunRootCauseTest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["root-cause"] });
    },
  });
}
