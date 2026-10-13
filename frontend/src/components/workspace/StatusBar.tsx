import { GitBranch } from "lucide-react";
import { useWorkspaceContext } from "@/context/WorkspaceContext";

export function StatusBar() {
  const { workspace, openTabs, activeTab, currentBranch } = useWorkspaceContext();
  const activeTabObj = openTabs.find((t) => t.path === activeTab);
  const dirtyCount = openTabs.filter((t) => t.isDirty).length;

  if (!workspace) return null;

  return (
    <div className="h-7 border-t border-stroke-muted bg-container text-ink-tertiary flex items-center px-3 gap-4 text-[11px] flex-shrink-0">
      <div className="flex items-center gap-1">
        <GitBranch className="h-3.5 w-3.5" />
        <span className="font-mono">{currentBranch}</span>
      </div>
      {dirtyCount > 0 && (
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />
          <span className="tabular-nums">{dirtyCount} unsaved</span>
        </div>
      )}
      {activeTabObj && (
        <div className="flex items-center gap-1 ml-auto">
          <span className="font-mono">{activeTabObj.path}</span>
          <span className="text-ink-quaternary">{activeTabObj.language}</span>
        </div>
      )}
    </div>
  );
}
