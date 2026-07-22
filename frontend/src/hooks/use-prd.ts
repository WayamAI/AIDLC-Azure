import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PRDGenerateRequest } from "@/lib/api";

export function useGeneratePRD() {
  return useMutation({
    mutationFn: (payload: PRDGenerateRequest) => api.generatePRD(payload),
  });
}
