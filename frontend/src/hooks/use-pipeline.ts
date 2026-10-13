import { useMutation, useQuery } from "@tanstack/react-query";
import { api, PipelineReportRequest } from "@/lib/api";

export function useReviewCommit() {
  return useMutation({
    mutationFn: ({ owner, repo, sha }: { owner: string; repo: string; sha: string }) =>
      api.reviewCommit(owner, repo, sha),
  });
}

export function useEvaluatePipeline() {
  return useMutation({
    mutationFn: (payload: PipelineReportRequest) => api.evaluatePipeline(payload),
  });
}

export function usePipelineRuns() {
  return useQuery({
    queryKey: ["pipeline-runs"],
    queryFn: () => api.listPipelineRuns(),
    staleTime: 30_000,
  });
}
