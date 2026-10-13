import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useSyntheticDatasets(limit = 10) {
  return useQuery({
    queryKey: ["synthetic-datasets", limit],
    queryFn: () => api.getSyntheticDatasets(limit),
  });
}

export function useGenerateSyntheticData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requirement_id, count }: { requirement_id: string; count: number }) =>
      api.generateSyntheticData(requirement_id, count),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["synthetic-datasets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}

