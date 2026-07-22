import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useAnalyzeRequirement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { text: string; instructions?: string }) => api.analyzeRequirement(data.text, data.instructions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["test-cases"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}

export function useRequirements() {
  return useQuery({
    queryKey: ["requirements"],
    queryFn: () => api.listRequirements(),
  });
}
