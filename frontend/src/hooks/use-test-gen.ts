import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  TestGenerateRequest, RunTestsRequest,
  PlaywrightGenerateRequest, PlaywrightExportRequest,
  PlaywrightBatchGenerateRequest, PlaywrightAppGenerateRequest, PlaywrightCommitGenerateRequest,
  SaveTestSuiteRequest,
} from "@/lib/api";

export function useGenerateTests() {
  return useMutation({
    mutationFn: (payload: TestGenerateRequest) => api.generateTests(payload),
  });
}

export function useRunTests() {
  return useMutation({
    mutationFn: (payload: RunTestsRequest) => api.runGeneratedTests(payload),
  });
}

export function useGeneratePlaywrightTests() {
  return useMutation({
    mutationFn: (payload: PlaywrightGenerateRequest) => api.generatePlaywrightTests(payload),
  });
}

export function useExportPlaywrightTests() {
  return useMutation({
    mutationFn: (payload: PlaywrightExportRequest) => api.exportPlaywrightTests(payload),
  });
}

export function useGeneratePlaywrightBatch() {
  return useMutation({
    mutationFn: (payload: PlaywrightBatchGenerateRequest) => api.generatePlaywrightBatch(payload),
  });
}

export function useGeneratePlaywrightApp() {
  return useMutation({
    mutationFn: (payload: PlaywrightAppGenerateRequest) => api.generatePlaywrightApp(payload),
  });
}

export function useGeneratePlaywrightCommit() {
  return useMutation({
    mutationFn: (payload: PlaywrightCommitGenerateRequest) => api.generatePlaywrightCommit(payload),
  });
}

export function useSaveTestSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveTestSuiteRequest) => api.saveTestSuite(payload),
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: ["test-suites", payload.workspace_id] });
    },
  });
}

export function useListTestSuites(workspace_id: string | null) {
  return useQuery({
    queryKey: ["test-suites", workspace_id],
    queryFn: () => api.listTestSuites(workspace_id!),
    enabled: !!workspace_id,
  });
}

export function useDeleteTestSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ suite_id, workspace_id }: { suite_id: string; workspace_id: string }) =>
      api.deleteTestSuite(suite_id),
    onSuccess: (_, { workspace_id }) => {
      qc.invalidateQueries({ queryKey: ["test-suites", workspace_id] });
    },
  });
}
