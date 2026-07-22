import { useMutation, useQuery } from "@tanstack/react-query";
import {
  impactApi,
  type GraphNode,
  type GraphEdge,
  type DocScenario,
} from "@/lib/api";

export function useWorkspaceGraph() {
  return useMutation({
    mutationFn: (payload: { workspace_id: string; file_paths?: string[] }) =>
      impactApi.buildWorkspaceGraph(payload),
  });
}

// ── Flow 1: Code-driven hooks ─────────────────────────────────────────────────

export function useBuildGraph() {
  return useMutation({
    mutationFn: (payload: {
      owner: string;
      repo: string;
      pr_number?: number;
      commit_sha?: string;
    }) => impactApi.buildGraph(payload),
  });
}

export function useImpactPath() {
  return useMutation({
    mutationFn: (payload: {
      nodes: GraphNode[];
      edges: GraphEdge[];
      focus_file: string;
    }) => impactApi.getImpactPath(payload),
  });
}

export function useFileContent() {
  return useMutation({
    mutationFn: (payload: {
      owner: string;
      repo: string;
      path: string;
      ref?: string;
    }) => impactApi.getFileContent(payload),
  });
}

export function useGenerateFromCode() {
  return useMutation({
    mutationFn: (payload: {
      owner: string;
      repo: string;
      file_path: string;
      file_content: string;
      language: string;
      impact_context?: string[];
    }) => impactApi.generateFromCode(payload),
  });
}

// ── Flow 2: Document-driven hooks ─────────────────────────────────────────────

export function useUploadDoc() {
  return useMutation({
    mutationFn: (file: File) => impactApi.uploadDoc(file),
  });
}

export function useGenerateFromDocs() {
  return useMutation({
    mutationFn: (payload: { scenarios: DocScenario[]; framework?: string }) =>
      impactApi.generateFromDocs(payload),
  });
}

// ── Shared: Test execution hooks ──────────────────────────────────────────────

export function useRunTest() {
  return useMutation({
    mutationFn: (payload: {
      test_id: string;
      test_code: string;
      framework: string;
      language: string;
    }) => impactApi.runTest(payload),
  });
}

export function useRunAllTests() {
  return useMutation({
    mutationFn: (testIds: string[]) => impactApi.runAllTests(testIds),
  });
}
