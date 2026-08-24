/**
 * ImpactPanel Git Changes + Root-to-Leaf Dependency Flow
 *
 * Lives in the right CopilotPanel as a tab. Two modes:
 *  1. "Changes" shows git-changed files with M/U/A/D status
 *  2. "Flow"    shows React Flow dependency graph for a selected file
 *
 * Clicking a node in the flow opens the file in the Monaco editor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  FileCode,
  FileText,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  Zap,
  ChevronRight,
  Info,
  X,
  Download,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useGitStatus } from "@/hooks/use-git";
import { useWorkspaceGraph } from "@/hooks/use-impact";
import { api } from "@/lib/api";
import type { GraphNode as ApiGraphNode, GraphEdge as ApiGraphEdge } from "@/lib/api";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = "staged" | "modified" | "untracked" | "deleted";

interface FileChangeItem {
  path: string;
  status: FileStatus;
  name: string;
}

interface NodeInfo {
  node: ApiGraphNode;
  importedBy: string[];  // paths that import this file
  imports: string[];     // paths this file imports
}

// ── Custom React Flow Node ─────────────────────────────────────────────────────

interface FlowNodeData {
  label: string;
  filePath: string;
  ext: string;
  isChanged: boolean;
  isImpacted: boolean;
  isSelected: boolean;
  status?: FileStatus;
  [key: string]: unknown;
}

function DependencyNode({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;

  const bgClass = d.isChanged
    ? "bg-red-500/20 border-red-400/60"
    : d.isImpacted
    ? "bg-amber-500/15 border-amber-400/50"
    : "bg-muted/30 border-border/60";

  const dotColor = d.isChanged ? "bg-red-400" : d.isImpacted ? "bg-amber-400" : "bg-muted-foreground/40";
  const labelColor = d.isChanged ? "text-red-200" : d.isImpacted ? "text-amber-200" : "text-foreground/80";
  const pathColor = "text-muted-foreground/60";

  const statusLabel: Partial<Record<FileStatus, string>> = {
    staged: "A",
    modified: "M",
    untracked: "U",
    deleted: "D",
  };
  const statusColor: Partial<Record<FileStatus, string>> = {
    staged: "text-positive",
    modified: "text-[var(--color-warning)]",
    untracked: "text-sky-700",
    deleted: "text-red-700",
  };

  const dir = d.filePath.includes("/")
    ? d.filePath.substring(0, d.filePath.lastIndexOf("/") + 1)
    : "";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 min-w-[160px] max-w-[220px] shadow-md transition-all duration-150",
        bgClass,
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background"
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border/80 !w-2 !h-2" />

      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", dotColor)} />
        <span className={cn("text-[11px] font-semibold truncate flex-1", labelColor)}>
          {d.label}
        </span>
        {d.status && (
          <span className={cn("text-[9px] font-bold flex-shrink-0", statusColor[d.status])}>
            {statusLabel[d.status]}
          </span>
        )}
      </div>

      {dir && (
        <p className={cn("text-[9px] truncate mt-0.5 pl-3", pathColor)} title={d.filePath}>
          {dir}
        </p>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-border/80 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { dependency: DependencyNode };

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusLabel(status: FileStatus): string {
  return { staged: "A", modified: "M", untracked: "U", deleted: "D" }[status];
}

function statusColor(status: FileStatus): string {
  return {
    staged: "text-positive",
    modified: "text-[var(--color-warning)]",
    untracked: "text-sky-700",
    deleted: "text-red-700",
  }[status];
}

function fileIcon(path: string) {
  const ext = path.split(".").pop() ?? "";
  if (["ts", "tsx", "js", "jsx"].includes(ext))
    return <FileCode className="h-3 w-3 text-sky-700 flex-shrink-0" />;
  if (ext === "py")
    return <FileCode className="h-3 w-3 text-amber-700 flex-shrink-0" />;
  return <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
}

function toFlowNodes(
  apiNodes: ApiGraphNode[],
  statusMap: Record<string, FileStatus>,
  selectedId: string | null
): Node[] {
  return apiNodes.map((n) => ({
    id: n.id,
    type: "dependency",
    position: { x: n.x, y: n.y },
    data: {
      label: n.name,
      filePath: n.path,
      ext: n.ext,
      isChanged: n.is_changed,
      isImpacted: n.is_impacted,
      isSelected: n.id === selectedId,
      status: statusMap[n.path],
    } satisfies FlowNodeData,
    selected: n.id === selectedId,
  }));
}

function toFlowEdges(apiEdges: ApiGraphEdge[]): Edge[] {
  return apiEdges.map((e, i) => ({
    id: `e-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    animated: false,
    style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "hsl(var(--border))",
      width: 14,
      height: 14,
    },
  }));
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ImpactPanel() {
  const { workspace, openFile } = useWorkspaceContext();

  // Git status
  const gitStatusQuery = useGitStatus(workspace?.workspace_id ?? null);
  const gitStatus = gitStatusQuery.data;

  // Build changed-file list
  const changedFiles = useMemo<FileChangeItem[]>(() => {
    if (!gitStatus) return [];
    const items: FileChangeItem[] = [];
    const add = (paths: string[], status: FileStatus) =>
      paths.forEach((p) =>
        items.push({ path: p, status, name: p.split("/").pop() ?? p })
      );
    add(gitStatus.staged ?? [], "staged");
    // unstaged overrides staged in display
    add(gitStatus.unstaged ?? [], "modified");
    add(gitStatus.untracked ?? [], "untracked");
    // de-dup by path (last write wins)
    const map = new Map<string, FileChangeItem>();
    items.forEach((i) => map.set(i.path, i));
    return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
  }, [gitStatus]);

  const statusMap = useMemo<Record<string, FileStatus>>(() => {
    const m: Record<string, FileStatus> = {};
    changedFiles.forEach((f) => { m[f.path] = f.status; });
    return m;
  }, [changedFiles]);

  // Flow state
  const [mode, setMode] = useState<"changes" | "flow">("changes");
  const [focusFile, setFocusFile] = useState<FileChangeItem | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);

  // React Flow state
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Graph mutation
  const graphMutation = useWorkspaceGraph();

  // Build graph for a focus file
  const buildGraph = useCallback(
    async (file: FileChangeItem) => {
      if (!workspace) return;
      setFocusFile(file);
      setMode("flow");
      setSelectedNodeId(null);
      setNodeInfo(null);

      try {
        const result = await graphMutation.mutateAsync({
          workspace_id: workspace.workspace_id,
          file_paths: [file.path],
        });

        // Build adjacency maps for info panel
        const importedByMap: Record<string, string[]> = {};
        const importsMap: Record<string, string[]> = {};
        result.edges.forEach((e) => {
          importsMap[e.source] = [...(importsMap[e.source] ?? []), e.target];
          importedByMap[e.target] = [...(importedByMap[e.target] ?? []), e.source];
        });

        // Store maps in closure via ref for node click handler
        adjacencyRef.current = { importedByMap, importsMap };

        const nodes = toFlowNodes(result.nodes, statusMap, file.path);
        const edges = toFlowEdges(result.edges);
        setRfNodes(nodes);
        setRfEdges(edges);
      } catch (err: any) {
        toast.error(err?.response?.data?.detail ?? "Failed to build dependency graph");
        setMode("changes");
      }
    },
    [workspace, graphMutation, statusMap]
  );

  const adjacencyRef = useRef<{
    importedByMap: Record<string, string[]>;
    importsMap: Record<string, string[]>;
  }>({ importedByMap: {}, importsMap: {} });

  // Node click → open file in editor + show info
  const onNodeClick = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      if (!workspace) return;
      const nodeData = node.data as FlowNodeData;
      const filePath = nodeData.filePath;

      // Update selected highlight
      setSelectedNodeId(filePath);
      setRfNodes((nds) =>
        nds.map((n) => ({
          ...n,
          selected: n.id === filePath,
          data: { ...n.data, isSelected: n.id === filePath },
        }))
      );

      // Show info
      const { importedByMap, importsMap } = adjacencyRef.current;
      setNodeInfo({
        node: {
          id: filePath,
          path: filePath,
          name: nodeData.label,
          ext: nodeData.ext,
          is_changed: nodeData.isChanged,
          is_impacted: nodeData.isImpacted,
          layer: 0,
          layer_index: 0,
          x: node.position.x,
          y: node.position.y,
        },
        importedBy: importedByMap[filePath] ?? [],
        imports: importsMap[filePath] ?? [],
      });

      // Open file in Monaco editor
      try {
        const file = await api.getWorkspaceFile(workspace.workspace_id, filePath);
        openFile(file.path, file.language, file.content);
      } catch {
        // file might not exist in workspace (external dep) silent
      }
    },
    [workspace, openFile, setRfNodes]
  );

  const handleRefresh = () => {
    gitStatusQuery.refetch();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!workspace) return null;

  const isLoading = gitStatusQuery.isLoading;
  const isFetching = gitStatusQuery.isFetching || graphMutation.isPending;

  // ── FLOW VIEW ───────────────────────────────────────────────────────────────
  if (mode === "flow") {
    return (
      <div className="h-full flex flex-col">
        {/* Flow header */}
        <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-border/40 bg-muted/10">
          <button
            onClick={() => { setMode("changes"); setFocusFile(null); setNodeInfo(null); }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Changes
          </button>
          <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
          <span className="text-xs font-medium truncate flex-1 text-foreground/80" title={focusFile?.path}>
            {focusFile?.name}
          </span>
          {focusFile?.status && (
            <span className={cn("text-[9px] font-bold", statusColor(focusFile.status))}>
              {statusLabel(focusFile.status)}
            </span>
          )}
        </div>

        {/* Loading state */}
        {graphMutation.isPending && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <RefreshCw className="h-5 w-5 text-primary animate-spin mx-auto" />
              <p className="text-xs text-muted-foreground">Building dependency graph…</p>
            </div>
          </div>
        )}

        {/* React Flow graph */}
        {!graphMutation.isPending && (
          <div className="flex-1 min-h-0 relative">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.3 }}
              minZoom={0.3}
              maxZoom={2}
              attributionPosition="bottom-right"
              className="bg-background"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                color="hsl(var(--border))"
                className="opacity-40"
              />
              <Controls
                className="!bg-muted/80 !border-border/50 !shadow-none"
                showInteractive={false}
              />
              <MiniMap
                className="!bg-muted/80 !border-border/50"
                nodeColor={(n) => {
                  const d = n.data as FlowNodeData;
                  if (d.isChanged) return "hsl(0 70% 50%)";
                  if (d.isImpacted) return "hsl(38 90% 50%)";
                  return "hsl(var(--muted-foreground))";
                }}
                maskColor="hsl(var(--background) / 0.6)"
              />
              <Panel position="top-right" className="flex gap-1 flex-wrap">
                <span className="flex items-center gap-1 text-[9px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  Changed
                </span>
                <span className="flex items-center gap-1 text-[9px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Impacted
                </span>
                <span className="flex items-center gap-1 text-[9px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                  Normal
                </span>
              </Panel>
            </ReactFlow>
          </div>
        )}

        {/* Node info drawer shown when a node is selected */}
        {nodeInfo && !graphMutation.isPending && (
          <div className="flex-shrink-0 border-t border-border/40 bg-muted/10">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border/20">
              <div className="flex items-center gap-1.5 min-w-0">
                <Info className="h-3 w-3 text-primary flex-shrink-0" />
                <span className="text-[10px] font-medium truncate">{nodeInfo.node.name}</span>
                {statusMap[nodeInfo.node.path] && (
                  <span className={cn("text-[9px] font-bold", statusColor(statusMap[nodeInfo.node.path]))}>
                    {statusLabel(statusMap[nodeInfo.node.path])}
                  </span>
                )}
              </div>
              <button
                onClick={() => setNodeInfo(null)}
                className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted/50"
              >
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </button>
            </div>

            <div className="px-2 py-1.5 space-y-1.5 max-h-36 overflow-y-auto">
              <p className="text-[9px] text-muted-foreground/60 font-mono truncate">{nodeInfo.node.path}</p>

              {nodeInfo.importedBy.length > 0 && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                    Imported by ({nodeInfo.importedBy.length})
                  </p>
                  {nodeInfo.importedBy.map((p) => (
                    <div key={p} className="flex items-center gap-1 py-0.5">
                      <span className="h-1 w-1 rounded-full bg-amber-400 flex-shrink-0" />
                      <span className="text-[9px] font-mono text-foreground/70 truncate">{p}</span>
                    </div>
                  ))}
                </div>
              )}

              {nodeInfo.imports.length > 0 && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">
                    Imports ({nodeInfo.imports.length})
                  </p>
                  {nodeInfo.imports.map((p) => (
                    <div key={p} className="flex items-center gap-1 py-0.5">
                      <span className="h-1 w-1 rounded-full bg-blue-400 flex-shrink-0" />
                      <span className="text-[9px] font-mono text-foreground/70 truncate">{p}</span>
                    </div>
                  ))}
                </div>
              )}

              {nodeInfo.imports.length === 0 && nodeInfo.importedBy.length === 0 && (
                <p className="text-[9px] text-muted-foreground/50">No local dependencies detected</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── CHANGES VIEW ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-semibold text-foreground/80 uppercase tracking-wider">
            Git Changes
          </span>
          {changedFiles.length > 0 && (
            <Badge variant="secondary" className="h-4 text-[9px] px-1 py-0">
              {changedFiles.length}
            </Badge>
          )}
        </div>
        <button
          onClick={handleRefresh}
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3 w-3 text-muted-foreground", isFetching && "animate-spin text-primary")} />
        </button>
      </div>

      {/* Instructions banner */}
      <div className="flex-shrink-0 px-2 py-1.5 bg-primary/5 border-b border-border/20">
        <p className="text-[9px] text-muted-foreground/80 flex items-center gap-1">
          <Zap className="h-2.5 w-2.5 text-primary flex-shrink-0" />
          Click any file to see root→leaf dependency flow
        </p>
      </div>

      {/* File list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="px-2 py-4 space-y-1 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-5 rounded bg-muted/40" style={{ width: `${55 + (i % 3) * 15}%` }} />
            ))}
          </div>
        ) : changedFiles.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <CheckCircle2 className="h-5 w-5 text-positive mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Working tree clean</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">No changes to show</p>
          </div>
        ) : (
          <div className="py-1">
            {/* Status groups */}
            {(["staged", "modified", "untracked", "deleted"] as FileStatus[]).map((st) => {
              const group = changedFiles.filter((f) => f.status === st);
              if (group.length === 0) return null;
              const groupLabel = { staged: "Staged", modified: "Modified", untracked: "Untracked", deleted: "Deleted" }[st];
              return (
                <div key={st}>
                  <div className="px-2 py-0.5">
                    <span className={cn("text-[9px] font-semibold uppercase tracking-wider", statusColor(st))}>
                      {groupLabel} ({group.length})
                    </span>
                  </div>
                  {group.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => buildGraph(file)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/40 transition-colors group"
                      title={`Click to view dependency flow for ${file.path}`}
                    >
                      {fileIcon(file.path)}
                      <span
                        className={cn(
                          "text-[11px] flex-1 truncate min-w-0",
                          st === "staged" && "text-positive",
                          st === "modified" && "text-[var(--color-warning)]",
                          st === "untracked" && "text-sky-700",
                          st === "deleted" && "text-red-700 line-through",
                        )}
                      >
                        {file.name}
                      </span>
                      <span className={cn("text-[9px] font-bold flex-shrink-0", statusColor(st))}>
                        {statusLabel(st)}
                      </span>
                      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </button>
                  ))}
                  <Separator className="my-0.5 opacity-20" />
                </div>
              );
            })}

            {/* Full paths footer */}
            <div className="px-2 pb-2 pt-1">
              <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider mb-1">Full Paths</p>
              {changedFiles.map((file) => (
                <p key={file.path} className="text-[8px] font-mono text-muted-foreground/40 truncate">
                  {file.path}
                </p>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Footer summary */}
      {!isLoading && changedFiles.length > 0 && (
        <div className="flex-shrink-0 border-t border-border/20 px-2 py-1 flex items-center gap-2">
          {gitStatus?.staged && gitStatus.staged.length > 0 && (
            <span className="text-[9px] text-positive">{gitStatus.staged.length}A</span>
          )}
          {gitStatus?.unstaged && gitStatus.unstaged.length > 0 && (
            <span className="text-[9px] text-[var(--color-warning)]">{gitStatus.unstaged.length}M</span>
          )}
          {gitStatus?.untracked && gitStatus.untracked.length > 0 && (
            <span className="text-[9px] text-sky-700">{gitStatus.untracked.length}U</span>
          )}
        </div>
      )}
    </div>
  );
}
