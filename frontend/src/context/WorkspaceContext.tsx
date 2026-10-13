import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { FileNode, WorkspaceInfo, CopilotSuggestion, ChatMessage, WorkspaceSuggestResponse, FileTestGroup } from "@/lib/api";

export interface EditorTab {
  path: string;
  language: string;
  content: string;
  originalContent: string;   // snapshot at open/last-save
  isDirty: boolean;
}

export interface FileDiff {
  file_path: string;
  original: string;
  modified: string;
  summary: string;
  language: string;
  is_new: boolean;
  status: "pending" | "accepted" | "rejected";
}

export interface DiffState {
  files: FileDiff[];
  currentFilePath: string;
  commitMessage: string;
  explanation: string;
  isOpen: boolean;
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python", ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", json: "json",
    yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", html: "html", css: "css",
    scss: "scss", sh: "shell",
  };
  return map[ext] ?? "plaintext";
}

interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  openTabs: EditorTab[];
  activeTab: string | null;
  diffState: DiffState | null;
  chatHistory: ChatMessage[];
  currentBranch: string;

  setWorkspace: (w: WorkspaceInfo | null) => void;
  openFile: (path: string, language: string, content: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  updateTabContent: (path: string, content: string) => void;
  markTabSaved: (path: string) => void;
  
  fileTests: FileTestGroup[] | null;
  setFileTests: (tests: FileTestGroup[] | null) => void;

  // Diff actions
  openDiff: (suggestion: CopilotSuggestion, filePath: string, language: string) => void;
  openMultiDiff: (response: WorkspaceSuggestResponse) => void;
  setCurrentDiffFile: (path: string) => void;
  acceptFileDiff: (path: string) => void;
  rejectFileDiff: (path: string) => void;
  acceptAllDiffs: () => void;
  rejectAllDiffs: () => void;
  closeDiff: () => void;

  // Legacy compat shims (used by CommitPanel / StatusBar)
  acceptDiff: (path: string) => void;
  rejectDiff: () => void;

  addChatMessage: (msg: ChatMessage) => void;
  setCurrentBranch: (branch: string) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(null);
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTab, setActiveTabState] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<DiffState | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentBranch, setCurrentBranchState] = useState("main");
  const [fileTests, setFileTests] = useState<FileTestGroup[] | null>(null);

  const setWorkspace = useCallback((w: WorkspaceInfo | null) => {
    setWorkspaceState(w);
    if (w) setCurrentBranchState(w.branch);
  }, []);

  const openFile = useCallback((path: string, language: string, content: string) => {
    setOpenTabs((prev) => {
      const exists = prev.find((t) => t.path === path);
      if (exists) return prev;
      return [...prev, { path, language, content, originalContent: content, isDirty: false }];
    });
    setActiveTabState(path);
  }, []);

  const closeTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.path !== path);
      return remaining;
    });
    setActiveTabState((prev) => {
      if (prev !== path) return prev;
      const remaining = openTabs.filter((t) => t.path !== path);
      return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
    });
  }, [openTabs]);

  const setActiveTab = useCallback((path: string) => setActiveTabState(path), []);

  const updateTabContent = useCallback((path: string, content: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => t.path === path ? { ...t, content, isDirty: content !== t.originalContent } : t)
    );
  }, []);

  const markTabSaved = useCallback((path: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => t.path === path ? { ...t, originalContent: t.content, isDirty: false } : t)
    );
  }, []);

  // Single-file diff (legacy / single-file suggest)
  const openDiff = useCallback((suggestion: CopilotSuggestion, filePath: string, language: string) => {
    const file: FileDiff = {
      file_path: filePath,
      original: suggestion.original,
      modified: suggestion.modified,
      summary: suggestion.diff_summary,
      language,
      is_new: false,
      status: "pending",
    };
    setDiffState({
      files: [file],
      currentFilePath: filePath,
      commitMessage: suggestion.commit_message,
      explanation: suggestion.explanation,
      isOpen: true,
    });
  }, []);

  // Multi-file diff (workspace suggest)
  const openMultiDiff = useCallback((response: WorkspaceSuggestResponse) => {
    if (!response.files.length) return;
    const files: FileDiff[] = response.files.map((f) => ({
      file_path: f.file_path,
      original: f.original,
      modified: f.modified,
      summary: f.summary,
      language: getLanguageFromPath(f.file_path),
      is_new: f.is_new,
      status: "pending",
    }));
    setDiffState({
      files,
      currentFilePath: files[0].file_path,
      commitMessage: response.commit_message,
      explanation: response.explanation,
      isOpen: true,
    });
  }, []);

  const setCurrentDiffFile = useCallback((path: string) => {
    setDiffState((prev) => prev ? { ...prev, currentFilePath: path } : prev);
  }, []);

  const _applyFileToTabs = useCallback((fileDiff: FileDiff) => {
    setOpenTabs((prev) => {
      const exists = prev.find((t) => t.path === fileDiff.file_path);
      if (exists) {
        return prev.map((t) =>
          t.path === fileDiff.file_path
            ? { ...t, content: fileDiff.modified, isDirty: true }
            : t
        );
      }
      return [...prev, {
        path: fileDiff.file_path,
        language: fileDiff.language,
        content: fileDiff.modified,
        originalContent: fileDiff.original,
        isDirty: true,
      }];
    });
    setActiveTabState(fileDiff.file_path);
  }, []);

  const acceptFileDiff = useCallback((path: string) => {
    setDiffState((prev) => {
      if (!prev) return prev;
      const target = prev.files.find((f) => f.file_path === path);
      if (target) _applyFileToTabs(target);

      const updated = prev.files.map((f) =>
        f.file_path === path ? { ...f, status: "accepted" as const } : f
      );
      const allDone = updated.every((f) => f.status !== "pending");

      // Find next pending file to show
      const nextPending = updated.find((f) => f.status === "pending");
      const newCurrent = nextPending ? nextPending.file_path : prev.currentFilePath;

      return allDone
        ? null
        : { ...prev, files: updated, currentFilePath: newCurrent };
    });
  }, [_applyFileToTabs]);

  const rejectFileDiff = useCallback((path: string) => {
    setDiffState((prev) => {
      if (!prev) return prev;
      const updated = prev.files.map((f) =>
        f.file_path === path ? { ...f, status: "rejected" as const } : f
      );
      const allDone = updated.every((f) => f.status !== "pending");
      const nextPending = updated.find((f) => f.status === "pending");
      const newCurrent = nextPending ? nextPending.file_path : prev.currentFilePath;
      return allDone ? null : { ...prev, files: updated, currentFilePath: newCurrent };
    });
  }, []);

  const acceptAllDiffs = useCallback(() => {
    setDiffState((prev) => {
      if (!prev) return prev;
      prev.files.forEach((f) => {
        if (f.status === "pending") _applyFileToTabs(f);
      });
      return null;
    });
  }, [_applyFileToTabs]);

  const rejectAllDiffs = useCallback(() => setDiffState(null), []);

  const closeDiff = useCallback(() => setDiffState(null), []);

  // Legacy shims
  const acceptDiff = useCallback((path: string) => acceptFileDiff(path), [acceptFileDiff]);
  const rejectDiff = useCallback(() => rejectAllDiffs(), [rejectAllDiffs]);

  const addChatMessage = useCallback((msg: ChatMessage) => {
    setChatHistory((prev) => [...prev, msg]);
  }, []);

  const setCurrentBranch = useCallback((branch: string) => setCurrentBranchState(branch), []);

  return (
    <WorkspaceContext.Provider
      value={{
        workspace, openTabs, activeTab, diffState, chatHistory, currentBranch,
        setWorkspace, openFile, closeTab, setActiveTab, updateTabContent, markTabSaved,
        openDiff, openMultiDiff, setCurrentDiffFile,
        acceptFileDiff, rejectFileDiff, acceptAllDiffs, rejectAllDiffs, closeDiff,
        acceptDiff, rejectDiff,
        addChatMessage, setCurrentBranch,
        fileTests, setFileTests,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceContext must be used inside WorkspaceProvider");
  return ctx;
}
