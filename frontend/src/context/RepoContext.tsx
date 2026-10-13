import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { parseGithubRepo, type ActiveRepo } from "@/lib/github-repo";

const STORAGE_KEY = "aidlc-active-repo";

function loadRepo(): ActiveRepo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveRepo>;
    if (!parsed.owner || !parsed.repo) return null;
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      repoUrl: parsed.repoUrl || `https://github.com/${parsed.owner}/${parsed.repo}`,
      branch: parsed.branch || "main",
    };
  } catch {
    return null;
  }
}

type RepoCtx = {
  activeRepo: ActiveRepo | null;
  setActiveRepo: (repo: ActiveRepo | string, branch?: string) => void;
  clearActiveRepo: () => void;
};

const Ctx = createContext<RepoCtx | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const [activeRepo, setActiveRepoState] = useState<ActiveRepo | null>(loadRepo);

  const setActiveRepo = useCallback((repo: ActiveRepo | string, branch?: string) => {
    const next = typeof repo === "string" ? parseGithubRepo(repo, branch) : { ...repo, branch: branch || repo.branch || "main" };
    if (!next) return;
    setActiveRepoState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const clearActiveRepo = useCallback(() => {
    setActiveRepoState(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ activeRepo, setActiveRepo, clearActiveRepo }),
    [activeRepo, setActiveRepo, clearActiveRepo],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveRepo() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      activeRepo: null,
      setActiveRepo: () => {},
      clearActiveRepo: () => {},
    } satisfies RepoCtx;
  }
  return ctx;
}
