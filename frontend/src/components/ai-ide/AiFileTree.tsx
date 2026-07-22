import { useState, useMemo, useEffect, useRef } from "react";
import { FileCode2, FileText, Folder, LayoutList, ChevronRight, ChevronDown, FilePlus, FolderPlus, FolderOpen, Pencil, Trash2, MoveRight, Search, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiIde } from "@/context/AiIdeContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiClient } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

function fileIcon(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return FileCode2;
  if (path.endsWith(".css") || path.endsWith(".json")) return FileText;
  if (path.endsWith(".md")) return LayoutList;
  return FileCode2;
}

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
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const tree = useMemo(() => buildTree(filePaths, dirPaths), [filePaths, dirPaths]);
  const visibleTree = useMemo(() => filterTree(tree, searchQuery) ?? { ...tree, children: {} }, [tree, searchQuery]);

  const STATUS_STYLE: Record<string, string> = {
    M: "text-orange-700",
    U: "text-sky-700",
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
        const response = await apiClient.post<{ ok: boolean; path: string; content: string }>("/ai-ide/file/create", {
          workspace_id: workspaceId,
          path: fullPath,
        });
        generatedContent = response.data?.content;
      }
      dispatch({ type: "ADD_FILE", path: fullPath, content: generatedContent, markAs: "A", makeActive: true });
      dispatch({ type: "ADD_LOG", message: `Creating ${fullPath}…` });
    } else {
      dispatch({ type: "ADD_DIR", path: fullPath });
      setExpandedDirs((prev) => new Set([...prev, fullPath, creating.parentPath]));
      dispatch({ type: "ADD_LOG", message: `Creating ${fullPath}…` });
    }
    
    setCreating(null);
    setCreateName("");
  };

  const StatusTag = ({ path }: { path: string }) => {
    const s = fileStatuses[path];
    if (!s) return null;
    return (
      <span className={cn("text-[9px] font-bold flex-shrink-0", STATUS_STYLE[s] ?? "text-muted-foreground/40")}>
        {s}
      </span>
    );
  };

  const createAtPath = (targetPath: string, kind: "file" | "dir") => {
    setExpandedDirs((prev) => new Set([...prev, targetPath]));
    setCreating({ kind, parentPath: targetPath });
  };

  const renamePath = async (oldPath: string, fallbackName: string) => {
    const nextPath = window.prompt("Rename path", oldPath)?.trim();
    if (!nextPath || nextPath === oldPath) return;
    if (workspaceId) {
      await apiClient.post("/ai-ide/file/rename", {
        workspace_id: workspaceId,
        from_path: oldPath,
        to_path: nextPath,
      });
    }
    dispatch({ type: "RENAME_PATH", fromPath: oldPath, toPath: nextPath });
    dispatch({ type: "ADD_LOG", message: `Updated ${fallbackName} -> ${nextPath}` });
  };

  const deletePath = async (path: string) => {
    const ok = window.confirm(`Delete ${path}?`);
    if (!ok) return;
    if (workspaceId) {
      await apiClient.post("/ai-ide/file/delete", {
        workspace_id: workspaceId,
        path,
      });
    }
    dispatch({ type: "DELETE_PATH", path });
    dispatch({ type: "ADD_LOG", message: `Deleted ${path}` });
  };

  const movePath = async (fromPath: string) => {
    const toPath = window.prompt("Move to path", fromPath)?.trim();
    if (!toPath || toPath === fromPath) return;
    if (workspaceId) {
      await apiClient.post("/ai-ide/file/move", {
        workspace_id: workspaceId,
        from_path: fromPath,
        to_path: toPath,
      });
    }
    dispatch({ type: "MOVE_PATH", fromPath, toPath });
    dispatch({ type: "ADD_LOG", message: `Updated ${fromPath} -> ${toPath}` });
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
                className="flex items-center gap-1.5 w-full px-1 py-0.5 rounded text-xs transition-colors text-left hover:bg-muted/50 text-foreground/75 hover:text-foreground cursor-pointer group"
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                onClick={() => toggleDir(node.path)}
              >
                {expandedDirs.has(node.path) ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                {expandedDirs.has(node.path) ? (
                  <FolderOpen className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />
                ) : (
                  <Folder className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />
                )}
                <span className="truncate flex-1 min-w-0">{node.name}</span>
                <div className="opacity-0 group-hover:opacity-100 flex items-center pr-1 transition-opacity">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      createAtPath(node.path, "file");
                    }}
                    className="p-1 rounded hover:bg-muted/60"
                  >
                    <FilePlus className="h-3 w-3" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      createAtPath(node.path, "dir");
                    }}
                    className="p-1 rounded hover:bg-muted/60"
                  >
                    <FolderPlus className="h-3 w-3" />
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
                    ? "bg-primary/15 text-primary"
                    : "hover:bg-muted/50 text-foreground/75 hover:text-foreground"
                )}
              >
                {(() => {
                  const Icon = fileIcon(node.name);
                  return <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", node.path === activeFile ? "text-primary" : "text-muted-foreground")} />;
                })()}

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
                   <Folder className="h-3.5 w-3.5 text-sky-700" />
                 )}
                 <input 
                   autoFocus
                   value={createName}
                   onChange={e => setCreateName(e.target.value)}
                   onKeyDown={e => {
                     if (e.key === "Enter") handleCreateSubmit();
                     if (e.key === "Escape") { setCreating(null); setCreateName(""); }
                   }}
                   className="flex-1 bg-background border border-border text-xs h-6 px-2 rounded-sm focus:outline-none focus:border-primary text-foreground"
                 />
               </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const handleOpenFile = async (path: string) => {
    const fileContent = files[path];
    if (fileContent !== undefined) {
      setActiveFile(path);
      dispatch({ type: "SET_ACTIVE_FILE", path });
    }
  };

  const handleFileClick = async (path: string) => {
    try {
      await handleOpenFile(path);
    } catch {
      // Ignore open errors
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 pt-2 pb-1.5 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium truncate">
              View Entry
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              Root = changed file, tree = dependency flow
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setExpandedDirs((p) => new Set([...p, ""]));
                setCreating({ kind: "file", parentPath: "" });
              }}
              className="h-5 px-1.5 flex items-center gap-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors text-primary"
              title="New File"
            >
              <FilePlus className="h-2.5 w-2.5" />
              <span className="text-[9px] font-semibold">New</span>
            </button>
            <button
              onClick={() => {
                setExpandedDirs((p) => new Set([...p, ""]));
                setCreating({ kind: "dir", parentPath: "" });
              }}
              className="h-5 px-1.5 flex items-center gap-1 rounded hover:bg-muted/50 transition-colors"
              title="New Folder"
            >
              <FolderPlus className="h-2.5 w-2.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => {
                dispatch({ type: "ADD_LOG", message: "Refresh requested" });
              }}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3 w-3 text-muted-foreground", status === "creating" && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="mt-1 relative">
          <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search files"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 overflow-y-auto py-1 px-1">
        {workspaceId && (status === "creating" || filePaths.length === 0) ? (
          <div className="px-2 py-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Loading files from DB...</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-4 rounded border bg-muted/20 border-border/40 animate-pulse"
                />
              ))}
            </div>
            {status === "error" && (
              <p className="text-xs text-destructive mt-3">
                Failed to load files.
              </p>
            )}
          </div>
        ) : Object.keys(visibleTree.children).length > 0 ? (
          renderTree(visibleTree, 0)
        ) : (
          <p className="px-2 py-4 text-xs text-muted-foreground">No files found.</p>
        )}
      </ScrollArea>

      {activeFile && (
        <div className="border-t border-border/20 px-2 py-1 flex-shrink-0">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Active file</p>
          <p className="text-[10px] text-foreground/80 truncate" title={activeFile}>
            {activeFile}
          </p>
        </div>
      )}
    </div>
  );
}
