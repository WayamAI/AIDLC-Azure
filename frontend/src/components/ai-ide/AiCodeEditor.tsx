import { useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useAiIde } from "@/context/AiIdeContext";
import { useMonacoTheme } from "@/hooks/use-editor-theme";
import { apiClient } from "@/lib/api";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function languageFor(path: string | null): string {
  if (!path) return "typescript";
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md")) return "markdown";
  return "typescript";
}

/** Workspace path of the model the editor is showing, from the model's URI. */
export function modelPathOf(uriPath: string): string {
  return uriPath.replace(/^\/+/, "");
}

export function AiCodeEditor() {
  const { state, dispatch, setActiveFile, closeTab } = useAiIde();
  const { activeFile, files, status, openTabs, fileStatuses, workspaceId } = state;
  const monacoTheme = useMonacoTheme();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const content = activeFile ? (files[activeFile] ?? "") : "";
  const locked = status === "generating" || status === "planning" || status === "creating";

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <p>Select a file from the explorer to open it</p>
          <p className="text-xs text-ink-quaternary">or use the chat panel to create one</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-9 bg-raised border-b border-stroke-muted overflow-x-auto flex-shrink-0">
        <div className="flex items-center min-w-0">
          {openTabs.map((tabPath) => {
            const fileName = tabPath.split("/").pop() || tabPath;
            const isActive = tabPath === activeFile;
            const statusTag = fileStatuses[tabPath];
            const isDirty = statusTag === "M" || statusTag === "A" || statusTag === "U";

            return (
              <button
                key={tabPath}
                onClick={() => setActiveFile(tabPath)}
                className={cn(
                  "flex items-center gap-1.5 px-3 h-9 text-xs border-r border-stroke-muted whitespace-nowrap transition-colors flex-shrink-0",
                  isActive
                    ? "bg-container text-ink border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-ink hover:bg-raised"
                )}
              >
                <span className="truncate max-w-[120px]">{fileName}</span>
                {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-status-warning flex-shrink-0" />}
                <X
                  className="h-3 w-3 opacity-50 hover:opacity-100 flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tabPath);
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          // One model per file: switching tabs swaps models instead of rewriting one
          // model's text, so a switch can never be mistaken for an edit.
          path={activeFile}
          language={languageFor(activeFile)}
          value={content}
          theme={monacoTheme}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            // The workspace's node_modules are not here, so type-level checks would flag every
            // import as missing; keep syntax errors, drop the semantic ones.
            const ts = monaco.languages.typescript;
            for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
              defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
              defaults.setCompilerOptions({
                ...defaults.getCompilerOptions(),
                jsx: ts.JsxEmit.ReactJSX,
                allowNonTsExtensions: true,
                target: ts.ScriptTarget.ESNext,
                moduleResolution: ts.ModuleResolutionKind.NodeJs,
              });
            }
          }}
          onChange={(value) => {
            if (value === undefined || !activeFile) return;
            // Only an edit to the file on screen counts; anything else is the editor
            // settling a model it was handed, and must not touch another file.
            const shownPath = editorRef.current?.getModel()?.uri.path;
            if (shownPath && modelPathOf(shownPath) !== activeFile) return;
            if (value === (files[activeFile] ?? "")) return;
            dispatch({ type: "UPDATE_FILE", path: activeFile, content: value });
            if (!workspaceId || locked) return;
            if (saveTimer.current) clearTimeout(saveTimer.current);
            const path = activeFile;
            const ws = workspaceId;
            saveTimer.current = setTimeout(() => {
              apiClient
                .post("/ai-ide/file/update", { workspace_id: ws, path, content: value })
                .catch((error: { response?: { data?: { detail?: string } }; message?: string }) => {
                  // The edit stays in the editor; say that the server copy is now behind.
                  toast.error(
                    `Could not save ${path}: ${error?.response?.data?.detail || error?.message || "unknown error"}`,
                    { id: `ai-ide-save-${path}` },
                  );
                });
            }, 600);
          }}
          options={{
            readOnly: locked,
            minimap: { enabled: true },
            fontSize: 13,
            lineHeight: 20,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            formatOnPaste: true,
            formatOnType: false,
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            folding: true,
            lineNumbers: "on",
            glyphMargin: false,
            renderLineHighlight: "line",
          }}
        />
      </div>
    </div>
  );
}
