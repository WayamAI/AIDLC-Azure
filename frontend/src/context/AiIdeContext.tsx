import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GenerationStatus = "idle" | "creating" | "planning" | "generating" | "done" | "error";

export type FileStatus = "M" | "U" | "A" | null;

export interface AiIdeState {
  workspaceId: string | null;
  files: Record<string, string>;          // path → full content
  filePaths: string[];                    // ordered list
  dirPaths: string[];                     // ordered folder list
  fileStatuses: Record<string, FileStatus>; // path -> status
  openTabs: string[];
  activeFile: string | null;
  status: GenerationStatus;
  statusMessage: string;
  generationLog: string[];
}

type Action =
  | { type: "SET_WORKSPACE"; workspaceId: string; initialFiles: Record<string, string> }
  | { type: "SET_STATUS"; status: GenerationStatus; message?: string }
  | { type: "ADD_LOG"; message: string }
  | { type: "ADD_FILE"; path: string; content?: string; markAs?: FileStatus; makeActive?: boolean }
  | { type: "ADD_DIR"; path: string }
  | { type: "APPEND_TOKEN"; path: string; token: string }
  | { type: "START_FILE_STREAM"; path: string }
  | { type: "UPDATE_FILE"; path: string; content: string }
  | { type: "DELETE_PATH"; path: string }
  | { type: "RENAME_PATH"; fromPath: string; toPath: string }
  | { type: "MOVE_PATH"; fromPath: string; toPath: string }
  | { type: "CLOSE_TAB"; path: string }
  | { type: "SET_ACTIVE_FILE"; path: string }
  | { type: "RESET" };

// ── Reducer ───────────────────────────────────────────────────────────────────

function sortedUnique(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

function parentDirsOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    dirs.push(parts.slice(0, i + 1).join("/"));
  }
  return dirs;
}

function deriveDirs(filePaths: string[]): string[] {
  const allDirs = filePaths.flatMap((filePath) => parentDirsOf(filePath));
  return sortedUnique(allDirs);
}

function defaultContentForPath(path: string): string {
  if (path.endsWith(".tsx")) {
    const rawName = path.split("/").pop()?.replace(".tsx", "") || "Component";
    const component = rawName.replace(/[^A-Za-z0-9_]/g, "") || "Component";
    return [
      "import React from 'react';",
      "",
      `export default function ${component}() {`,
      "  return (",
      `    <div className=\"p-6\">${component}</div>`,
      "  );",
      "}",
      "",
    ].join("\n");
  }

  if (path.endsWith(".ts")) return "export {};\n";
  if (path.endsWith(".css")) return "/* Styles */\n";
  if (path.endsWith(".json")) return "{}\n";
  if (path.endsWith(".md")) return "# New Document\n";
  return "";
}

function renameKey(path: string, fromPath: string, toPath: string): string | null {
  if (path === fromPath) return toPath;
  if (path.startsWith(`${fromPath}/`)) return `${toPath}${path.slice(fromPath.length)}`;
  return null;
}

function reducer(state: AiIdeState, action: Action): AiIdeState {
  switch (action.type) {
    case "SET_WORKSPACE":
      {
        const filePaths = Object.keys(action.initialFiles).sort((a, b) => a.localeCompare(b));
        const preferredActive = filePaths.includes("src/App.tsx") ? "src/App.tsx" : (filePaths[0] ?? null);

        return {
          ...state,
          workspaceId: action.workspaceId,
          files: action.initialFiles,
          filePaths,
          dirPaths: deriveDirs(filePaths),
          fileStatuses: {},
          openTabs: preferredActive ? [preferredActive] : [],
          activeFile: preferredActive,
        };
      }

    case "SET_STATUS":
      return {
        ...state,
        status: action.status,
        statusMessage: action.message ?? state.statusMessage,
      };

    case "ADD_LOG":
      return { ...state, generationLog: [...state.generationLog, action.message] };

    case "ADD_DIR":
      if (!action.path.trim()) return state;
      return {
        ...state,
        dirPaths: sortedUnique([...state.dirPaths, action.path]),
      };

    case "ADD_FILE":
      {
        const exists = state.filePaths.includes(action.path);
        const nextFiles = {
          ...state.files,
          [action.path]: exists
            ? state.files[action.path]
            : (action.content ?? defaultContentForPath(action.path)),
        };
        const nextFilePaths = exists ? state.filePaths : sortedUnique([...state.filePaths, action.path]);
        const nextDirPaths = sortedUnique([...state.dirPaths, ...parentDirsOf(action.path)]);
        const shouldActivate = action.makeActive ?? true;
        const nextActiveFile = shouldActivate ? action.path : state.activeFile;
        const nextOpenTabs = shouldActivate
          ? sortedUnique([...state.openTabs, action.path])
          : state.openTabs;

        return {
          ...state,
          files: nextFiles,
          filePaths: nextFilePaths,
          dirPaths: nextDirPaths,
          fileStatuses: {
            ...state.fileStatuses,
            ...(action.markAs ? { [action.path]: action.markAs } : {}),
          },
          activeFile: nextActiveFile,
          openTabs: nextOpenTabs,
        };
      }

    case "START_FILE_STREAM":
      {
        const isExisting = state.filePaths.includes(action.path);
      return {
        ...state,
        files: { ...state.files, [action.path]: "" },
        filePaths: state.filePaths.includes(action.path)
          ? state.filePaths
          : sortedUnique([...state.filePaths, action.path]),
        dirPaths: sortedUnique([...state.dirPaths, ...parentDirsOf(action.path)]),
        fileStatuses: { ...state.fileStatuses, [action.path]: isExisting ? "U" : "A" },
        activeFile: action.path,
        openTabs: sortedUnique([...state.openTabs, action.path]),
      };
      }

    case "APPEND_TOKEN":
      {
        const currentStatus = state.fileStatuses[action.path];
        const isKnownExisting = state.filePaths.includes(action.path);
      return {
        ...state,
        files: {
          ...state.files,
          [action.path]: (state.files[action.path] ?? "") + action.token,
        },
        fileStatuses: {
          ...state.fileStatuses,
          [action.path]: currentStatus ?? (isKnownExisting ? "U" : "A"),
        },
      };
      }

    case "UPDATE_FILE":
      // Manual update means modified
      return {
        ...state,
        files: { ...state.files, [action.path]: action.content },
        fileStatuses: { 
          ...state.fileStatuses, 
          [action.path]:
            state.fileStatuses[action.path] === "U"
              ? "U"
              : state.fileStatuses[action.path] === "A"
                ? "A"
                : "M"
        },
      };

    case "DELETE_PATH":
      {
        const target = action.path;
        const isDir = state.dirPaths.includes(target) || state.filePaths.some((p) => p.startsWith(`${target}/`));
        const shouldDelete = (path: string) => path === target || (isDir && path.startsWith(`${target}/`));

        const nextFiles = Object.fromEntries(
          Object.entries(state.files).filter(([path]) => !shouldDelete(path))
        );
        const nextFilePaths = state.filePaths.filter((path) => !shouldDelete(path));
        const nextFileStatuses = Object.fromEntries(
          Object.entries(state.fileStatuses).filter(([path]) => !shouldDelete(path))
        );
        const nextDirPaths = state.dirPaths.filter(
          (path) => path !== target && !(isDir && path.startsWith(`${target}/`))
        );
        const nextOpenTabs = state.openTabs.filter((path) => !shouldDelete(path));

        let nextActiveFile = state.activeFile;
        if (nextActiveFile && shouldDelete(nextActiveFile)) {
          nextActiveFile = nextOpenTabs[0] ?? nextFilePaths[0] ?? null;
        }

        return {
          ...state,
          files: nextFiles,
          filePaths: nextFilePaths,
          dirPaths: nextDirPaths,
          fileStatuses: nextFileStatuses,
          openTabs: nextOpenTabs,
          activeFile: nextActiveFile,
        };
      }

    case "RENAME_PATH":
    case "MOVE_PATH":
      {
        const fromPath = action.type === "RENAME_PATH" ? action.fromPath : action.fromPath;
        const toPath = action.type === "RENAME_PATH" ? action.toPath : action.toPath;
        if (!fromPath || !toPath || fromPath === toPath) return state;

        const touchedFilePaths = state.filePaths
          .map((path) => ({ path, next: renameKey(path, fromPath, toPath) }))
          .filter((x) => x.next !== null) as Array<{ path: string; next: string }>;

        const nextFiles = { ...state.files };
        const nextFileStatuses = { ...state.fileStatuses };
        touchedFilePaths.forEach(({ path, next }) => {
          nextFiles[next] = state.files[path] ?? "";
          delete nextFiles[path];
          if (path in nextFileStatuses) {
            nextFileStatuses[next] = nextFileStatuses[path];
            delete nextFileStatuses[path];
          }
        });

        const untouchedFilePaths = state.filePaths.filter((path) => renameKey(path, fromPath, toPath) === null);
        const renamedFilePaths = touchedFilePaths.map((x) => x.next);
        const nextFilePaths = sortedUnique([...untouchedFilePaths, ...renamedFilePaths]);

        const touchedDirPaths = state.dirPaths
          .map((path) => renameKey(path, fromPath, toPath))
          .filter((p): p is string => Boolean(p));
        const untouchedDirPaths = state.dirPaths.filter((path) => renameKey(path, fromPath, toPath) === null);
        const nextDirPaths = sortedUnique([
          ...untouchedDirPaths,
          ...touchedDirPaths,
          ...deriveDirs(nextFilePaths),
          ...parentDirsOf(toPath),
        ]);

        const mapPath = (path: string): string => renameKey(path, fromPath, toPath) ?? path;
        const nextOpenTabs = sortedUnique(state.openTabs.map(mapPath));
        const nextActiveFile = state.activeFile ? mapPath(state.activeFile) : null;

        return {
          ...state,
          files: nextFiles,
          filePaths: nextFilePaths,
          dirPaths: nextDirPaths,
          fileStatuses: nextFileStatuses,
          openTabs: nextOpenTabs,
          activeFile: nextActiveFile,
        };
      }

    case "SET_ACTIVE_FILE":
      return {
        ...state,
        activeFile: action.path,
        openTabs: sortedUnique([...state.openTabs, action.path]),
      };

    case "CLOSE_TAB":
      {
        const nextOpenTabs = state.openTabs.filter((tabPath) => tabPath !== action.path);
        const nextActiveFile =
          state.activeFile === action.path
            ? (nextOpenTabs[nextOpenTabs.length - 1] ?? null)
            : state.activeFile;

        return {
          ...state,
          openTabs: nextOpenTabs,
          activeFile: nextActiveFile,
        };
      }

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const initialState: AiIdeState = {
  workspaceId: null,
  files: {},
  filePaths: [],
  dirPaths: [],
  fileStatuses: {},
  openTabs: [],
  activeFile: null,
  status: "idle",
  statusMessage: "",
  generationLog: [],
};

interface AiIdeContextValue {
  state: AiIdeState;
  dispatch: React.Dispatch<Action>;
  setActiveFile: (path: string) => void;
  closeTab: (path: string) => void;
  reset: () => void;
}

const AiIdeContext = createContext<AiIdeContextValue | null>(null);

export function AiIdeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setActiveFile = useCallback(
    (path: string) => dispatch({ type: "SET_ACTIVE_FILE", path }),
    []
  );

  const closeTab = useCallback(
    (path: string) => dispatch({ type: "CLOSE_TAB", path }),
    []
  );

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return (
    <AiIdeContext.Provider value={{ state, dispatch, setActiveFile, closeTab, reset }}>
      {children}
    </AiIdeContext.Provider>
  );
}

export function useAiIde() {
  const ctx = useContext(AiIdeContext);
  if (!ctx) throw new Error("useAiIde must be used inside AiIdeProvider");
  return ctx;
}
