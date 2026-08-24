import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight, ChevronDown,
  FileCode, FileText, FileJson, Folder, FolderOpen, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileNode, GitStatus } from "@/lib/api";
import { api } from "@/lib/api";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useWorkspaceTree } from "@/hooks/use-workspace";
import { useGitStatus } from "@/hooks/use-git";

// ── Git status badge ─────────────────────────────────────────────────────────

type FileStatus = "staged" | "modified" | "untracked" | "deleted";

function StatusBadge({ status }: { status: FileStatus }) {
  const styles: Record<FileStatus, string> = {
    staged:    "text-positive",
    modified:  "text-[var(--color-warning)]",
    untracked: "text-sky-700",
    deleted:   "text-red-700",
  };
  const label: Record<FileStatus, string> = {
    staged:    "A",
    modified:  "M",
    untracked: "U",
    deleted:   "D",
  };
  return (
    <span className={cn("ml-auto text-[9px] font-bold flex-shrink-0 pl-1", styles[status])}>
      {label[status]}
    </span>
  );
}

// ── File icon ────────────────────────────────────────────────────────────────

function getFileIcon(node: FileNode) {
  if (node.type === "directory") return null;
  const lang = node.language ?? "";
  if (["typescript", "javascript"].includes(lang))
    return <FileCode className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />;
  if (lang === "python")
    return <FileCode className="h-3.5 w-3.5 text-amber-700 flex-shrink-0" />;
  if (lang === "json")
    return <FileJson className="h-3.5 w-3.5 text-[var(--color-warning)] flex-shrink-0" />;
  return <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
}

// ── Tree node ────────────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  node: FileNode;
  depth?: number;
  activeFile: string | null;
  statusMap: Record<string, FileStatus>;
  revealDirs: Set<string>;
}

function FileTreeNode({ node, depth = 0, activeFile, statusMap, revealDirs }: FileTreeNodeProps) {
  const shouldReveal = node.type === "directory" && revealDirs.has(node.path);
  const [expanded, setExpanded] = useState(depth < 1 || shouldReveal);

  // Expand when a new path is revealed (e.g. switching back from tree mode)
  useEffect(() => {
    if (shouldReveal) setExpanded(true);
  }, [shouldReveal]);
  const { workspace, openFile } = useWorkspaceContext();

  const handleFileClick = async () => {
    if (!workspace) return;
    try {
      const file = await api.getWorkspaceFile(workspace.workspace_id, node.path);
      openFile(file.path, file.language, file.content);
    } catch {
      // ignore
    }
  };

  // Does this directory (recursively) contain any changed files?
  const dirHasChanges = useMemo(() => {
    if (node.type !== "directory") return false;
    const checkChildren = (children: FileNode[] = []): boolean =>
      children.some((c) =>
        c.type === "file" ? !!statusMap[c.path] : checkChildren(c.children)
      );
    return checkChildren(node.children);
  }, [node, statusMap]);

  if (node.type === "directory") {
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full px-1 py-0.5 rounded text-xs hover:bg-muted/50 transition-colors text-left"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
          {expanded
            ? <FolderOpen className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />
            : <Folder className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />}
          <span className="truncate text-foreground/80 flex-1 min-w-0">{node.name}</span>
          {!expanded && dirHasChanges && (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] flex-shrink-0 mr-1" />
          )}
        </button>
        {expanded && node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            statusMap={statusMap}
            revealDirs={revealDirs}
          />
        ))}
      </div>
    );
  }

  const fileStatus = statusMap[node.path];

  return (
    <button
      className={cn(
        "flex items-center gap-1.5 w-full px-1 py-0.5 rounded text-xs transition-colors text-left group",
        activeFile === node.path
          ? "bg-primary/15 text-primary"
          : "hover:bg-muted/50 text-foreground/70 hover:text-foreground"
      )}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      onClick={handleFileClick}
      title={node.path}
    >
      {getFileIcon(node)}
      <span className={cn(
        "truncate flex-1 min-w-0",
        fileStatus === "modified" && "text-[var(--color-warning)]",
        fileStatus === "staged" && "text-positive",
        fileStatus === "untracked" && "text-sky-700",
        fileStatus === "deleted" && "text-red-700 line-through",
      )}>
        {node.name}
      </span>
      {fileStatus && <StatusBadge status={fileStatus} />}
    </button>
  );
}

// ── Skeleton loader ──────────────────────────────────────────────────────────

function TreeSkeleton() {
  return (
    <div className="px-2 py-1 space-y-1 animate-pulse">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-muted/40"
          style={{ width: `${50 + (i % 4) * 12}%`, marginLeft: `${(i % 3) * 8}px` }}
        />
      ))}
    </div>
  );
}

// ── FileExplorer ─────────────────────────────────────────────────────────────

export function FileExplorer({ revealPath }: { revealPath?: string | null } = {}) {
  const { workspace, activeTab } = useWorkspaceContext();

  // Compute the set of directory paths that need to be force-expanded to reveal revealPath
  const revealDirs = useMemo<Set<string>>(() => {
    const target = revealPath ?? activeTab;
    if (!target) return new Set();
    const parts = target.split("/");
    const dirs = new Set<string>();
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
    return dirs;
  }, [revealPath, activeTab]);

  const treeQuery = useWorkspaceTree(workspace?.workspace_id ?? null);
  const gitStatusQuery = useGitStatus(workspace?.workspace_id ?? null);

  // Build a flat path → status map from git status
  const statusMap = useMemo<Record<string, FileStatus>>(() => {
    const s = gitStatusQuery.data;
    if (!s) return {};
    const map: Record<string, FileStatus> = {};
    s.staged.forEach((p) => { map[p] = "staged"; });
    // unstaged overwrites staged so M takes priority in display
    s.unstaged.forEach((p) => { map[p] = "modified"; });
    s.untracked.forEach((p) => { map[p] = "untracked"; });
    return map;
  }, [gitStatusQuery.data]);

  const handleRefresh = () => {
    treeQuery.refetch();
    gitStatusQuery.refetch();
  };

  if (!workspace) return null;

  const tree = treeQuery.data?.tree ?? [];
  const isLoading = treeQuery.isLoading;
  const isFetching = treeQuery.isFetching || gitStatusQuery.isFetching;
  const isError = treeQuery.isError;

  const changedCount = Object.keys(statusMap).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-2 pt-2 pb-1.5 flex-shrink-0 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium truncate">
              {workspace.repo_url.split("/").slice(-2).join("/")}
            </p>
            <p className="text-[10px] text-muted-foreground/60">{workspace.branch}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {changedCount > 0 && (
              <span className="text-[9px] text-[var(--color-warning)] font-medium">{changedCount}M</span>
            )}
            <button
              onClick={handleRefresh}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/50 transition-colors"
              title="Refresh file tree"
            >
              <RefreshCw className={cn("h-3 w-3 text-muted-foreground", isFetching && "animate-spin text-primary")} />
            </button>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {isLoading ? (
          <TreeSkeleton />
        ) : isError ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-muted-foreground">Failed to load files</p>
            <button
              className="mt-1 text-[10px] text-primary hover:underline"
              onClick={() => treeQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : tree.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">No files found</p>
        ) : (
          tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeTab}
              statusMap={statusMap}
              revealDirs={revealDirs}
            />
          ))
        )}
      </div>

      {/* Git status footer */}
      {!isLoading && (
        <div className="flex-shrink-0 border-t border-border/20 px-2 py-1 flex items-center gap-2">
          {changedCount > 0 ? (
            <>
              {(gitStatusQuery.data?.unstaged?.length ?? 0) > 0 && (
                <span className="text-[9px] text-[var(--color-warning)]">
                  {gitStatusQuery.data!.unstaged.length}M
                </span>
              )}
              {(gitStatusQuery.data?.staged?.length ?? 0) > 0 && (
                <span className="text-[9px] text-positive">
                  {gitStatusQuery.data!.staged.length}A
                </span>
              )}
              {(gitStatusQuery.data?.untracked?.length ?? 0) > 0 && (
                <span className="text-[9px] text-sky-700">
                  {gitStatusQuery.data!.untracked.length}U
                </span>
              )}
            </>
          ) : (
            <span className="text-[9px] text-muted-foreground/50">clean</span>
          )}
          <span className="ml-auto text-[9px] text-muted-foreground/40">
            {tree.length > 0 ? `${countFiles(tree)} files` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((acc, n) => {
    if (n.type === "file") return acc + 1;
    return acc + countFiles(n.children ?? []);
  }, 0);
}
