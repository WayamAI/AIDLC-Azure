import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, CreateSnippetRequest } from "@/lib/api";

export function useSnippets(workspaceId?: string, lang?: string) {
  return useQuery({
    queryKey: ["snippets", workspaceId, lang],
    queryFn: () => api.getSnippets({ workspace_id: workspaceId, lang }),
  });
}

export function useCreateSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSnippetRequest) => api.createSnippet(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snippets"] });
    },
  });
}

export function useDeleteSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSnippet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snippets"] });
    },
  });
}
