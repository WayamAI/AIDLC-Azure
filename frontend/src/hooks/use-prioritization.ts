import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePrioritizedTests(refresh = false) {
  return useQuery({
    queryKey: ["prioritized-tests"],
    queryFn: () => api.getPrioritizedTests(refresh),
  });
}

export function useRefreshPrioritization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.getPrioritizedTests(true),
    onSuccess: (data) => {
      queryClient.setQueryData(["prioritized-tests"], data);
    },
  });
}
