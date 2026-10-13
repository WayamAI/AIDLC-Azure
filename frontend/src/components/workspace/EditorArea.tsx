import { apiErrorMessage } from "@/lib/api-error";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/imcc/StatusBadge";
import { X, Check, XCircle, CheckCheck, Save, FilePlus, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "./CodeEditor";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useSaveWorkspaceFile } from "@/hooks/use-workspace";
import { useAnalyzeCoverage } from "@/hooks/use-coverage";
import { toast } from "sonner";

export function EditorArea() {
  const {
    openTabs, activeTab, setActiveTab, closeTab,
    diffState, setCurrentDiffFile,
    acceptFileDiff, rejectFileDiff, acceptAllDiffs, rejectAllDiffs,
    workspace, markTabSaved,
  } = useWorkspaceContext();

  const saveMutation = useSaveWorkspaceFile();
  const coverageMutation = useAnalyzeCoverage();
  const [coveragePct, setCoveragePct] = useState<number | null>(null);

  useEffect(() => {
    setCoveragePct(null);
  }, [activeTab]);

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

  const canAnalyzeCoverage =
    !!workspace &&
    !!activeTabObj &&
    !isDiffOpen &&
    /\.(py|ts|tsx|js|jsx)$/i.test(activeTabObj.path);

  const handleCoverage = async () => {
    if (!workspace || !activeTabObj) return;
    try {
      const result = await coverageMutation.mutateAsync({
        workspace_id: workspace.workspace_id,
        file_path: activeTabObj.path,
        content: activeTabObj.content,
      });
      setCoveragePct(result.coverage_pct);
      const uncovered = result.gaps.filter((g) => !g.covered).length;
      if (result.coverage_pct == null || result.total_functions === 0) {
        // Nothing to measure is not 0%: say so instead of showing a figure.
        toast.info("No functions were found in this file, so there is no coverage figure for it.");
      } else {
        toast.success(
          uncovered
            ? `${result.coverage_pct}% of functions are referenced in tests; ${uncovered} ${uncovered === 1 ? "is" : "are"} not`
            : `${result.coverage_pct}% of functions are referenced in tests`,
        );
      }
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "The coverage analysis failed."));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar always visible */}
      <div className="flex items-center h-9 bg-container border-b border-stroke-muted overflow-x-auto flex-shrink-0">
        <div className="flex items-center min-w-0">
          {openTabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-9 text-xs border-r border-stroke-muted whitespace-nowrap transition-colors flex-shrink-0",
                activeTab === tab.path && !isDiffOpen
                  ? "bg-container text-ink border-b-2 border-b-primary"
                  : "text-muted-foreground hover:text-ink hover:bg-raised"
              )}
            >
              <span className="truncate max-w-[120px]">{tab.path.split("/").pop()}</span>
              {tab.isDirty && <span className="h-1.5 w-1.5 rounded-full bg-status-warning flex-shrink-0" />}
              <X
                className="h-3 w-3 opacity-50 hover:opacity-100 flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
              />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 px-2 flex-shrink-0">
          {canAnalyzeCoverage && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleCoverage}
              disabled={coverageMutation.isPending}
            >
              <Target className="h-3.5 w-3.5 mr-1" />
              {coverageMutation.isPending
                ? "Analysing…"
                : coveragePct != null
                  ? `${coveragePct}%`
                  : "Coverage"}
            </Button>
          )}
          {activeTabObj?.isDirty && !isDiffOpen && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleSave} disabled={saveMutation.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          )}
          {isDiffOpen && (
            <StatusBadge tone="pending">{pendingCount} pending</StatusBadge>
          )}
        </div>
      </div>

      {/* Diff mode file navigator + Monaco DiffEditor */}
      {isDiffOpen && diffState ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Diff navigator bar */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-stroke-muted bg-raised flex-shrink-0 overflow-x-auto">
            <span className="text-[10px] text-muted-foreground mr-1 flex-shrink-0">Changes:</span>
            {diffState.files.map((f) => (
              <button
                key={f.file_path}
                onClick={() => setCurrentDiffFile(f.file_path)}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] whitespace-nowrap flex-shrink-0 transition-colors border",
                  f.file_path === diffState.currentFilePath
                    ? "bg-container border-stroke text-ink"
                    : "border-transparent text-muted-foreground hover:text-ink hover:bg-raised",
                  f.status === "accepted" && "opacity-50",
                  f.status === "rejected" && "opacity-30 line-through"
                )}
              >
                {f.is_new && <FilePlus className="h-2.5 w-2.5 text-positive" />}
                {f.status === "accepted" && <Check className="h-2.5 w-2.5 text-positive" />}
                {f.status === "rejected" && <XCircle className="h-2.5 w-2.5 text-destructive" />}
                {f.status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />}
                <span className="truncate max-w-[100px]">{f.file_path.split("/").pop()}</span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] bg-primary hover:bg-primary"
                onClick={acceptAllDiffs}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Accept All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] border-stroke-muted text-destructive hover:bg-raised"
                onClick={rejectAllDiffs}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Reject All
              </Button>
            </div>
          </div>

          {/* Current file diff summary + per-file accept/reject */}
          {currentFileDiff && (
            <div className="flex items-center justify-between px-4 py-1.5 bg-raised border-b border-stroke-muted flex-shrink-0">
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground truncate">
                  <span className="font-medium text-ink">{currentFileDiff.file_path}</span>
                  {currentFileDiff.is_new && (
                    <StatusBadge tone="info" className="ml-1.5">New file</StatusBadge>
                  )}
                  {" "}{currentFileDiff.summary}
                </p>
              </div>
              {currentFileDiff.status === "pending" && (
                <div className="flex gap-1.5 flex-shrink-0 ml-3">
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px] bg-primary hover:bg-primary"
                    onClick={() => acceptFileDiff(currentFileDiff.file_path)}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px] border-stroke-muted text-destructive hover:bg-raised"
                    onClick={() => rejectFileDiff(currentFileDiff.file_path)}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Reject
                  </Button>
                </div>
              )}
              {currentFileDiff.status === "accepted" && (
                <StatusBadge tone="success" className="ml-3">Accepted</StatusBadge>
              )}
              {currentFileDiff.status === "rejected" && (
                <StatusBadge tone="critical" className="ml-3">Rejected</StatusBadge>
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
