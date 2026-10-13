import { useMutation } from "@tanstack/react-query";
import { api, SuggestCodeRequest, AddCommentsRequest, ExplainCodeRequest, WorkspaceSuggestRequest } from "@/lib/api";

export function useSuggestCode() {
  return useMutation({
    mutationFn: (payload: SuggestCodeRequest) => api.suggestCode(payload),
  });
}

export function useAddComments() {
  return useMutation({
    mutationFn: (payload: AddCommentsRequest) => api.addComments(payload),
  });
}

export function useExplainCode() {
  return useMutation({
    mutationFn: (payload: ExplainCodeRequest) => api.explainCode(payload),
  });
}

export function useSuggestWorkspace() {
  return useMutation({
    mutationFn: (payload: WorkspaceSuggestRequest) => api.suggestWorkspace(payload),
  });
}
