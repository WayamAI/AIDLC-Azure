import { useState, useMemo, useEffect, useRef } from "react";
import { FileIcon, FolderIcon } from "@/components/FileIcon";
import { FileCode2, FileText, Folder, LayoutList, ChevronRight, ChevronDown, FilePlus, FolderPlus, FolderOpen, Pencil, Trash2, MoveRight, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiIde } from "@/context/AiIdeContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiClient } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";
import { useAskDialog } from "@/components/ui/ask-dialog";

const errorDetail = (error: unknown) => apiErrorMessage(error);
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type TreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  children: Record<string, TreeNode>;
};

function buildTree(paths: string[], explicitDirs: string[]): TreeNode {
  const root: TreeNode = { name: "root", path: "", kind: "dir", children: {} };

  const addPath = (path: string, kind: "file" | "dir") => {
    const parts = path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      
      const isLast = i === parts.length - 1;
      const nodeKind = isLast ? kind : "dir";
      const nodePath = parts.slice(0, i + 1).join("/");

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: nodePath,
          kind: nodeKind,
          children: {},
        };
      }
      current = current.children[part];
    }
  };

  explicitDirs.forEach((dir) => addPath(dir, "dir"));
  paths.forEach((p) => addPath(p, "file"));

  return root;
}

function filterTree(node: TreeNode, query: string): TreeNode | null {
  if (!query.trim()) return node;
  const lower = query.toLowerCase();

  if (node.kind === "file") {
    return node.path.toLowerCase().includes(lower) || node.name.toLowerCase().includes(lower)
      ? node
      : null;
  }

  const children: Record<string, TreeNode> = {};
  for (const child of Object.values(node.children)) {
    const filtered = filterTree(child, query);
    if (filtered) children[filtered.name] = filtered;
  }

  if (node.path === "") {
    return { ...node, children };
  }

  const selfMatch = node.path.toLowerCase().includes(lower) || node.name.toLowerCase().includes(lower);
  if (selfMatch || Object.keys(children).length > 0) {
    return { ...node, children };
  }

  return null;
}

export function AiFileTree() {
  const { state, setActiveFile, dispatch } = useAiIde();
  const { filePaths, dirPaths, activeFile, files, status, fileStatuses, workspaceId } = state;

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["src", "src/components", "src/pages"]));
  
  const [creating, setCreating] = useState<{ kind: "file" | "dir"; parentPath: string } | null>(null);
  const [createName, setCreateName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  /** Label of the file operation waiting on the server, if any. */
  const [pendingOp, setPendingOp] = useState<string | null>(null);
  const { dialog: askDialog, askText, confirm } = useAskDialog();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const tree = useMemo(() => buildTree(filePaths, dirPaths), [filePaths, dirPaths]);
  const visibleTree = useMemo(() => filterTree(tree, searchQuery) ?? { ...tree, children: {} }, [tree, searchQuery]);

  const STATUS_STYLE: Record<string, string> = {
    M: "text-warning",
    U: "text-info",
    A: "text-positive",
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    const onFocusSearch = () => {
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("ai-ide-focus-search", onFocusSearch as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ai-ide-focus-search", onFocusSearch as EventListener);
    };
  }, []);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCreateSubmit = async () => {
    if (!creating || !createName.trim()) return;
    const parentPath = creating.parentPath ? `${creating.parentPath}/` : "";
    const fullPath = `${parentPath}${createName.trim()}`;
    
    if (creating.kind === "file") {
      let generatedContent: string | undefined;
      if (workspaceId) {
        setPendingOp(`Creating ${fullPath}…`);
        try {
          const response = await apiClient.post<{ ok: boolean; path: string; content: string }>("/ai-ide/file/create", {
            workspace_id: workspaceId,
            path: fullPath,
          });
          generatedContent = response.data?.content;
        } catch (error) {
          // Keep the input open so the name can be corrected and retried.
          toast.error(`Could not create ${fullPath}: ${errorDetail(error)}`);
          return;
        } finally {
          setPendingOp(null);
        }
      }
      dispatch({ type: "ADD_FILE", path: fullPath, content: generatedContent, markAs: "A", makeActive: true });
      dispatch({ type: "ADD_LOG", message: `Created ${fullPath}` });
    } else {
      dispatch({ type: "ADD_DIR", path: fullPath });
      setExpandedDirs((prev) => new Set([...prev, fullPath, creating.parentPath]));
      dispatch({ type: "ADD_LOG", message: `Created folder ${fullPath}` });
    }
    
    setCreating(null);
    setCreateName("");
  };

  const StatusTag = ({ path }: { path: string }) => {
    const s = fileStatuses[path];
    if (!s) return null;
    return (
      <span className={cn("text-[10px] font-bold flex-shrink-0", STATUS_STYLE[s] ?? "text-ink-quaternary")}>
        {s}
      </span>
    );
  };

  const createAtPath = (targetPath: string, kind: "file" | "dir") => {
    setExpandedDirs((prev) => new Set([...prev, targetPath]));
    setCreating({ kind, parentPath: targetPath });
  };

  const renamePath = async (oldPath: string, fallbackName: string) => {
    const nextPath = await askText({
      title: `Rename ${fallbackName}`,
      description: "Enter the full path from the project root.",
      confirmLabel: "Rename",
      input: { label: "Path", defaultValue: oldPath },
    });
    if (!nextPath || nextPath === oldPath) return;
    if (workspaceId) {
      setPendingOp(`Renaming ${fallbackName}…`);
      try {
        await apiClient.post("/ai-ide/file/rename", {
          workspace_id: workspaceId,
          from_path: oldPath,
          to_path: nextPath,
        });
      } catch (error) {
        toast.error(`Could not rename ${oldPath}: ${errorDetail(error)}`);
        return;
      } finally {
        setPendingOp(null);
      }
    }
    dispatch({ type: "RENAME_PATH", fromPath: oldPath, toPath: nextPath });
    dispatch({ type: "ADD_LOG", message: `Renamed ${oldPath} to ${nextPath}` });
  };

  const deletePath = async (path: string) => {
    const ok = await confirm({
      title: `Delete ${path}?`,
      description: "This removes it from the workspace. It cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    if (workspaceId) {
      setPendingOp(`Deleting ${path}…`);
      try {
        await apiClient.post("/ai-ide/file/delete", {
          workspace_id: workspaceId,
          path,
        });
      } catch (error) {
        toast.error(`Could not delete ${path}: ${errorDetail(error)}`);
        return;
      } finally {
        setPendingOp(null);
      }
    }
    dispatch({ type: "DELETE_PATH", path });
    dispatch({ type: "ADD_LOG", message: `Deleted ${path}` });
  };

  const movePath = async (fromPath: string) => {
    const toPath = await askText({
      title: `Move ${fromPath.split("/").pop() ?? fromPath}`,
      description: "Enter the new full path from the project root.",
      confirmLabel: "Move",
      input: { label: "New path", defaultValue: fromPath },
    });
    if (!toPath || toPath === fromPath) return;
    if (workspaceId) {
      setPendingOp(`Moving ${fromPath}…`);
      try {
        await apiClient.post("/ai-ide/file/move", {
          workspace_id: workspaceId,
          from_path: fromPath,
          to_path: toPath,
        });
      } catch (error) {
        toast.error(`Could not move ${fromPath}: ${errorDetail(error)}`);
        return;
      } finally {
        setPendingOp(null);
      }
    }
    dispatch({ type: "MOVE_PATH", fromPath, toPath });
    dispatch({ type: "ADD_LOG", message: `Moved ${fromPath} to ${toPath}` });
  };

  // Pre-sort children: dirs first, then files alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    return nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };

  const renderTree = (node: TreeNode, depth: number = 0) => {
    const childrenNodes = sortNodes(Object.values(node.children));
    
    return (
      <div key={node.path || "root"} className="w-full">
        {node.path !== "" && node.kind === "dir" && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div 
                className="flex items-center gap-1.5 w-full px-1 py-0.5 rounded text-xs transition-colors text-left hover:bg-raised text-ink-secondary hover:text-ink cursor-pointer group"
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                onClick={() => toggleDir(node.path)}
              >
                {expandedDirs.has(node.path) ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                {expandedDirs.has(node.path) ? (
                  <FolderIcon open size={14} />
                ) : (
                  <FolderIcon size={14} />
                )}
                <span className="truncate flex-1 min-w-0">{node.name}</span>
                <div className="opacity-0 group-hover:opacity-100 flex items-center pr-1 transition-opacity">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      createAtPath(node.path, "file");
                    }}
                    className="p-1 rounded hover:bg-raised"
                  >
                    <FilePlus className="h-3.5 w-3.5" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      createAtPath(node.path, "dir");
                    }}
                    className="p-1 rounded hover:bg-raised"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <ContextMenuItem onClick={() => createAtPath(node.path, "file")}>New File</ContextMenuItem>
              <ContextMenuItem onClick={() => createAtPath(node.path, "dir")}>New Folder</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => renamePath(node.path, node.name)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />Rename
              </ContextMenuItem>
              <ContextMenuItem onClick={() => movePath(node.path)}>
                <MoveRight className="h-3.5 w-3.5 mr-2" />Move
              </ContextMenuItem>
              <ContextMenuItem className="text-destructive" onClick={() => deletePath(node.path)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        
        {node.path !== "" && node.kind === "file" && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => handleFileClick(node.path)}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                className={cn(
                  "flex items-center gap-1.5 w-full px-1 py-0.5 rounded text-xs transition-colors text-left",
                  node.path === activeFile
                    ? "bg-raised text-primary"
                    : "hover:bg-raised text-ink-secondary hover:text-ink"
                )}
              >
                <FileIcon name={node.name} size={14} />

                <span className="truncate flex-1 min-w-0">{node.name}</span>

                <StatusTag path={node.path} />
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <ContextMenuItem onClick={() => setActiveFile(node.path)}>Open</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => renamePath(node.path, node.name)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />Rename
              </ContextMenuItem>
              <ContextMenuItem onClick={() => movePath(node.path)}>
                <MoveRight className="h-3.5 w-3.5 mr-2" />Move
              </ContextMenuItem>
              <ContextMenuItem className="text-destructive" onClick={() => deletePath(node.path)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}

        {(node.path === "" || expandedDirs.has(node.path)) && (
          <div className="w-full relative">
            {childrenNodes.map(child => renderTree(child, depth + (node.path === "" ? 0 : 1)))}
            
            {/* Inline creation input */}
            {creating?.parentPath === node.path && (
               <div 
                 className="flex items-center gap-1.5 py-0.5 pr-2 w-full" 
                 style={{ paddingLeft: `${(depth + (node.path === "" ? 0 : 1)) * 12 + 6}px` }}
               >
                 {creating.kind === "file" ? (
                   <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                 ) : (
                   <FolderIcon size={14} />
                 )}
                 <input 
                   autoFocus
                   value={createName}
                   onChange={e => setCreateName(e.target.value)}
                   onKeyDown={e => {
                     if (e.key === "Enter") handleCreateSubmit();
                     if (e.key === "Escape") { setCreating(null); setCreateName(""); }
                   }}
                   className="flex-1 bg-container border border-border text-xs h-6 px-2 rounded-sm focus:outline-none focus:border-primary text-ink"
                 />
               </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const handleFileClick = (path: string) => {
    if (files[path] !== undefined) setActiveFile(path);
  };

  return (
    <div className="h-full flex flex-col">
      {askDialog}
      <div className="px-2 pt-2 pb-1.5 border-b border-stroke-muted flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
              Files
            </p>
            <p className="text-[10px] tabular-nums text-ink-quaternary">
              {filePaths.length} file{filePaths.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setExpandedDirs((p) => new Set([...p, ""]));
                setCreating({ kind: "file", parentPath: "" });
              }}
              className="h-5 px-1.5 flex items-center gap-1 rounded bg-raised hover:bg-raised transition-colors text-primary"
              title="New File"
            >
              <FilePlus className="h-2.5 w-2.5" />
              <span className="text-[10px] font-semibold">New</span>
            </button>
            <button
              onClick={() => {
                setExpandedDirs((p) => new Set([...p, ""]));
                setCreating({ kind: "dir", parentPath: "" });
              }}
              className="h-5 px-1.5 flex items-center gap-1 rounded hover:bg-raised transition-colors"
              title="New Folder"
            >
              <FolderPlus className="h-2.5 w-2.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="mt-1 relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search files"
            className="h-7 pl-7 text-xs"
          />
        </div>
        {pendingOp && (
          <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-ink-tertiary">
            <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
            <span className="truncate">{pendingOp}</span>
          </p>
        )}
      </div>

      <ScrollArea className="flex-1 overflow-y-auto py-1 px-1">
        {status === "creating" ? (
          <p className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Creating the workspace…
          </p>
        ) : Object.keys(visibleTree.children).length > 0 || creating ? (
          renderTree(visibleTree, 0)
        ) : (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {searchQuery.trim()
              ? "No files match this search."
              : status === "planning" || status === "generating"
                ? "No files yet. They appear here as they are generated."
                : "This workspace has no files."}
          </p>
        )}
      </ScrollArea>

      {activeFile && (
        <div className="border-t border-stroke-muted px-2 py-1 flex-shrink-0">
          <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Active file</p>
          <p className="text-[10px] text-ink truncate" title={activeFile}>
            {activeFile}
          </p>
        </div>
      )}
    </div>
  );
}
