import { useRef } from "react";
import Editor from "@monaco-editor/react";
import { useAiIde } from "@/context/AiIdeContext";
import { useMonacoTheme } from "@/hooks/use-editor-theme";
import { apiClient } from "@/lib/api";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function AiCodeEditor() {
  const { state, dispatch, setActiveFile, closeTab } = useAiIde();
  const { activeFile, files, status, openTabs, fileStatuses, workspaceId } = state;
  const monacoTheme = useMonacoTheme();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const content = activeFile ? (files[activeFile] ?? "") : "";

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <p>Select a file from the explorer to open it</p>
          <p className="text-xs text-muted-foreground/60">or ask the Workspace AI to generate code</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center h-9 bg-muted/30 border-b border-border/50 overflow-x-auto flex-shrink-0">
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
                  "flex items-center gap-1.5 px-3 h-9 text-xs border-r border-border/30 whitespace-nowrap transition-colors flex-shrink-0",
                  isActive
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <span className="truncate max-w-[120px]">{fileName}</span>
                {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] flex-shrink-0" />}
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
          language={languageFor(activeFile)}
          value={content}
          theme={monacoTheme}
          onChange={(value) => {
            if (value === undefined || !activeFile) return;
            dispatch({ type: "UPDATE_FILE", path: activeFile, content: value });
            if (!workspaceId || status === "generating" || status === "planning" || status === "creating") return;
            if (saveTimer.current) clearTimeout(saveTimer.current);
            const path = activeFile;
            const ws = workspaceId;
            saveTimer.current = setTimeout(() => {
              apiClient
                .post("/ai-ide/file/update", { workspace_id: ws, path, content: value })
                .catch(() => {});
            }, 600);
          }}
          options={{
            readOnly: status === "generating" || status === "planning" || status === "creating",
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
