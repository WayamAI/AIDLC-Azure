import { useMutation } from "@tanstack/react-query";
import { api, CoverageAnalyzeRequest } from "@/lib/api";

export function useAnalyzeCoverage() {
  return useMutation({
    mutationFn: (payload: CoverageAnalyzeRequest) => api.analyzeCoverage(payload),
  });
}
