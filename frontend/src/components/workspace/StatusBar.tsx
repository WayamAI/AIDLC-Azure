import { GitBranch, Wifi, WifiOff, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceContext } from "@/context/WorkspaceContext";

export function StatusBar() {
  const { workspace, openTabs, activeTab, currentBranch } = useWorkspaceContext();
  const activeTabObj = openTabs.find((t) => t.path === activeTab);
  const dirtyCount = openTabs.filter((t) => t.isDirty).length;

  if (!workspace) return null;

  return (
    <div className="h-6 bg-primary/90 text-primary-foreground flex items-center px-3 gap-4 text-[10px] flex-shrink-0">
      <div className="flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        <span>{currentBranch}</span>
      </div>
      {dirtyCount > 0 && (
        <div className="flex items-center gap-1">
          <Circle className="h-2 w-2 fill-[var(--color-warning)] text-[var(--color-warning)]" />
          <span>{dirtyCount} unsaved</span>
        </div>
      )}
      {activeTabObj && (
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-primary-foreground/70">{activeTabObj.path}</span>
          <span className="text-primary-foreground/50">·</span>
          <span>{activeTabObj.language}</span>
        </div>
      )}
      <div className="flex items-center gap-1 ml-auto">
        <Wifi className="h-3 w-3 text-positive" />
        <span className="text-primary-foreground/70">AI Ready</span>
      </div>
    </div>
  );
}
