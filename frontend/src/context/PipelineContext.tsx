import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import type { PipelineReview, PipelineReport } from "@/lib/api";
import type { WorkspacePlaywrightTest } from "@/lib/api";

export interface LiveTestSummary {
  passed: number;
  failed: number;
  total: number;
  pass_rate: number;
}

export interface PipelineState {
  // Stage 1 Workspace
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  githubPat: string;
  workspaceId: string | null;
  // Stage 2 Commit
  commitSha: string | null;
  commitMessage: string | null;
  commitUrl: string | null;
  // Stage 3 Code Review
  reviewResult: { sha: string; review: PipelineReview; files_reviewed: number } | null;
  reviewStatus: "idle" | "loading" | "done" | "error";
  // Stage 3 Deployment
  deployedUrl: string | null;
  // Stage 4 Test Case Gen
  testSuite: WorkspacePlaywrightTest[];
  // Stage 5 Live Test Runner
  liveTestSummary: LiveTestSummary | null;
  // Stage 6 Report
  reportResult: PipelineReport | null;
  // Navigation
  activeStage: number;
  completedStages: number[];
}

interface PipelineCtxValue extends PipelineState {
  setWorkspaceInfo: (info: { repoUrl: string; owner: string; repo: string; branch: string; workspaceId: string; githubPat?: string }) => void;
  setGithubPat: (pat: string) => void;
  setCommit: (sha: string, message: string, url: string) => void;
  setReviewResult: (result: PipelineState["reviewResult"]) => void;
  setReviewStatus: (s: PipelineState["reviewStatus"]) => void;
  setDeployedUrl: (url: string | null) => void;
  setTestSuite: (tests: WorkspacePlaywrightTest[]) => void;
  setLiveTestSummary: (s: LiveTestSummary | null) => void;
  setReportResult: (r: PipelineReport | null) => void;
  goToStage: (n: number) => void;
  completeStage: (n: number, next?: number) => void;
  resetPipeline: () => void;
}

const defaultState: PipelineState = {
  repoUrl: "",
  owner: "",
  repo: "",
  githubPat: "",
  branch: "main", workspaceId: null,
  commitSha: null, commitMessage: null, commitUrl: null,
  reviewResult: null, reviewStatus: "idle",
  deployedUrl: null,
  testSuite: [],
  liveTestSummary: null,
  reportResult: null,
  activeStage: 1,
  completedStages: [],
};

const PipelineCtx = createContext<PipelineCtxValue | null>(null);

const PIPELINE_STORAGE_KEY = "aidlc-pipeline-state";

function loadPipelineState(): PipelineState {
  try {
    const raw = sessionStorage.getItem(PIPELINE_STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<PipelineState>;
    return {
      ...defaultState,
      ...parsed,
      githubPat: "",
    };
  } catch {
    return defaultState;
  }
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PipelineState>(loadPipelineState);

  useEffect(() => {
    try {
      const { githubPat: _omit, ...rest } = state;
      sessionStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* ignore quota / private mode */
    }
  }, [state]);

  const update = useCallback((patch: Partial<PipelineState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setWorkspaceInfo = useCallback((info: { repoUrl: string; owner: string; repo: string; branch: string; workspaceId: string; githubPat?: string }) => {
    update({ ...info });
  }, [update]);

  const setGithubPat = useCallback((githubPat: string) => {
    update({ githubPat });
  }, [update]);

  const setCommit = useCallback((sha: string, message: string, url: string) => {
    update({ commitSha: sha, commitMessage: message, commitUrl: url });
  }, [update]);

  const setReviewResult = useCallback((result: PipelineState["reviewResult"]) => {
    update({ reviewResult: result, reviewStatus: "done" });
  }, [update]);

  const setReviewStatus = useCallback((reviewStatus: PipelineState["reviewStatus"]) => {
    update({ reviewStatus });
  }, [update]);

  const setDeployedUrl = useCallback((deployedUrl: string | null) => {
    update({ deployedUrl });
  }, [update]);

  const setTestSuite = useCallback((testSuite: WorkspacePlaywrightTest[]) => {
    update({ testSuite });
  }, [update]);

  const setLiveTestSummary = useCallback((liveTestSummary: LiveTestSummary | null) => {
    update({ liveTestSummary });
  }, [update]);

  const setReportResult = useCallback((reportResult: PipelineReport | null) => {
    update({ reportResult });
  }, [update]);

  const goToStage = useCallback((n: number) => {
    update({ activeStage: n });
  }, [update]);

  const completeStage = useCallback((n: number, next?: number) => {
    setState((prev) => ({
      ...prev,
      completedStages: prev.completedStages.includes(n) ? prev.completedStages : [...prev.completedStages, n],
      activeStage: next ?? n + 1,
    }));
  }, []);

  const resetPipeline = useCallback(() => {
    setState(defaultState);
    try {
      sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <PipelineCtx.Provider value={{
      ...state,
      setWorkspaceInfo, setCommit,
      setGithubPat,
      setReviewResult, setReviewStatus,
      setDeployedUrl,
      setTestSuite, setLiveTestSummary, setReportResult,
      goToStage, completeStage, resetPipeline,
    }}>
      {children}
    </PipelineCtx.Provider>
  );
}

export function usePipelineContext() {
  const ctx = useContext(PipelineCtx);
  if (!ctx) throw new Error("usePipelineContext must be used inside PipelineProvider");
  return ctx;
}

/** Safe outside `/pipeline` — Workspace tree view shares this graph UI. */
export function useOptionalPipelineContext() {
  return useContext(PipelineCtx);
}
