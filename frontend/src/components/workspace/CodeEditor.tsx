import { useRef } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { useWorkspaceContext } from "@/context/WorkspaceContext";

interface CodeEditorProps {
  isDiffMode?: boolean;
}

export function CodeEditor({ isDiffMode = false }: CodeEditorProps) {
  const { openTabs, activeTab, diffState, updateTabContent } = useWorkspaceContext();
  const tab = openTabs.find((t) => t.path === activeTab);

  // In diff mode, show the currently selected file's diff
  if (isDiffMode && diffState?.isOpen) {
    const currentDiff = diffState.files.find((f) => f.file_path === diffState.currentFilePath);
    if (!currentDiff) return null;

    return (
      <DiffEditor
        key={currentDiff.file_path}   // remount when switching files
        height="100%"
        original={currentDiff.original}
        modified={currentDiff.modified}
        language={currentDiff.language}
        theme="light"
        options={{
          readOnly: false,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          renderSideBySide: true,
          originalEditable: false,
        }}
      />
    );
  }

  if (!tab) {
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
    <Editor
      height="100%"
      language={tab.language}
      value={tab.content}
      theme="light"
      onChange={(value) => {
        if (value !== undefined) updateTabContent(tab.path, value);
      }}
      options={{
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
  );
}
