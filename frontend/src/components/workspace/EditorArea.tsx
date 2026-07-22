import { X, Check, XCircle, CheckCheck, Save, FilePlus, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CodeEditor } from "./CodeEditor";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useSaveWorkspaceFile } from "@/hooks/use-workspace";
import { toast } from "sonner";

export function EditorArea() {
  const {
    openTabs, activeTab, setActiveTab, closeTab,
    diffState, setCurrentDiffFile,
    acceptFileDiff, rejectFileDiff, acceptAllDiffs, rejectAllDiffs,
    workspace, markTabSaved,
  } = useWorkspaceContext();

  const saveMutation = useSaveWorkspaceFile();

  const activeTabObj = openTabs.find((t) => t.path === activeTab);
  const isDiffOpen = !!diffState?.isOpen;
  const currentFileDiff = isDiffOpen
    ? diffState.files.find((f) => f.file_path === diffState.currentFilePath)
    : null;

  const pendingCount = isDiffOpen
    ? diffState.files.filter((f) => f.status === "pending").length
    : 0;

  const handleSave = async () => {
    if (!activeTabObj || !workspace) return;
    try {
      await saveMutation.mutateAsync({
        workspaceId: workspace.workspace_id,
        path: activeTabObj.path,
        content: activeTabObj.content,
      });
      markTabSaved(activeTabObj.path);
      toast.success("File saved");
    } catch {
      toast.error("Failed to save file");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar always visible */}
      <div className="flex items-center h-9 bg-muted/30 border-b border-border/50 overflow-x-auto flex-shrink-0">
        <div className="flex items-center min-w-0">
          {openTabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-9 text-xs border-r border-border/30 whitespace-nowrap transition-colors flex-shrink-0",
                activeTab === tab.path && !isDiffOpen
                  ? "bg-background text-foreground border-b-2 border-b-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <span className="truncate max-w-[120px]">{tab.path.split("/").pop()}</span>
              {tab.isDirty && <span className="h-1.5 w-1.5 rounded-full bg-orange-400 flex-shrink-0" />}
              <X
                className="h-3 w-3 opacity-50 hover:opacity-100 flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
              />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 px-2 flex-shrink-0">
          {activeTabObj?.isDirty && !isDiffOpen && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="h-3 w-3 mr-1" />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          )}
          {isDiffOpen && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 gap-1">
              <GitCompare className="h-3 w-3" />
              {pendingCount} pending
            </Badge>
          )}
        </div>
      </div>

      {/* Diff mode file navigator + Monaco DiffEditor */}
      {isDiffOpen && diffState ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Diff navigator bar */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/50 bg-muted/20 flex-shrink-0 overflow-x-auto">
            <span className="text-[10px] text-muted-foreground mr-1 flex-shrink-0">Changes:</span>
            {diffState.files.map((f) => (
              <button
                key={f.file_path}
                onClick={() => setCurrentDiffFile(f.file_path)}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] whitespace-nowrap flex-shrink-0 transition-colors border",
                  f.file_path === diffState.currentFilePath
                    ? "bg-background border-primary/40 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  f.status === "accepted" && "opacity-50",
                  f.status === "rejected" && "opacity-30 line-through"
                )}
              >
                {f.is_new && <FilePlus className="h-2.5 w-2.5 text-positive" />}
                {f.status === "accepted" && <Check className="h-2.5 w-2.5 text-positive" />}
                {f.status === "rejected" && <XCircle className="h-2.5 w-2.5 text-red-700" />}
                {f.status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-primary/70 inline-block" />}
                <span className="truncate max-w-[100px]">{f.file_path.split("/").pop()}</span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] bg-primary hover:bg-primary/90"
                onClick={acceptAllDiffs}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Accept All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] border-red-400/40 text-red-700 hover:bg-red-400/10"
                onClick={rejectAllDiffs}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Reject All
              </Button>
            </div>
          </div>

          {/* Current file diff summary + per-file accept/reject */}
          {currentFileDiff && (
            <div className="flex items-center justify-between px-4 py-1.5 bg-primary/5 border-b border-primary/20 flex-shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground truncate">
                  <span className="font-medium text-foreground/80">{currentFileDiff.file_path}</span>
                  {currentFileDiff.is_new && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] h-4 px-1 border-primary/30 text-positive">new file</Badge>
                  )}
                  {" "}{currentFileDiff.summary}
                </p>
              </div>
              {currentFileDiff.status === "pending" && (
                <div className="flex gap-1.5 flex-shrink-0 ml-3">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px] bg-primary hover:bg-primary/90"
                    onClick={() => acceptFileDiff(currentFileDiff.file_path)}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] border-red-400/40 text-red-700 hover:bg-red-400/10"
                    onClick={() => rejectFileDiff(currentFileDiff.file_path)}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Reject
                  </Button>
                </div>
              )}
              {currentFileDiff.status === "accepted" && (
                <Badge className="text-[10px] bg-primary/20 text-positive border-primary/30 ml-3">Accepted</Badge>
              )}
              {currentFileDiff.status === "rejected" && (
                <Badge variant="outline" className="text-[10px] border-red-400/30 text-red-700 ml-3">Rejected</Badge>
              )}
            </div>
          )}

          {/* Monaco DiffEditor */}
          <div className="flex-1 min-h-0">
            <CodeEditor isDiffMode />
          </div>
        </div>
      ) : (
        /* Normal editor */
        <div className="flex-1 min-h-0">
          <CodeEditor isDiffMode={false} />
        </div>
      )}
    </div>
  );
}
