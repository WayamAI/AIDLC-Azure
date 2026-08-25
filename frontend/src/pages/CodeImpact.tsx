import { useCallback, useMemo, useState, memo } from "react";
import { toast } from "sonner";
import Editor from "@monaco-editor/react";
import {
  GitBranch,
  Github,
  Zap,
  Loader2,
  File,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  Flame,
  ArrowLeft,
  X,
  RefreshCw,
  FileCode,
  FileText,
} from "lucide-react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  Handle,
  Position,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useConnectWorkspace } from "@/hooks/use-workspace";
import { useMonacoTheme } from "@/hooks/use-editor-theme";
import { useActiveRepo } from "@/context/RepoContext";
import { impactApi, api } from "@/lib/api";
import { buildAdjacency, deriveRootToLeafChain, type Adjacency } from "@/lib/dep-graph";
import type {
  WorkspaceInfo,
  WorkspaceGraphResponse,
  FileNode,
  GraphNode,
  GraphEdge,
} from "@/lib/api";

interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
}

interface FlowNodeData extends Record<string, unknown> {
  label: string;
  path: string;
  ext: string;
  tone: "focus" | "chain" | "normal";
  isRoot: boolean;
  isLeaf: boolean;
  isFocus: boolean;
  isTest: boolean;
  imports: number;
  importedBy: number;
}

const NODE_W = 230;
const NODE_H = 76;
const X_GAP = 130;
const Y_GAP = 118;
const MAX_HOPS = 3;
const MAX_SUBSET = 140;
const MAX_LAYERS = 40;

function parseRepoUrl(value: string): { owner: string; repo: string; normalized: string } | null {
  const input = value.trim().replace(/\.git$/, "");
  if (!input) return null;

  const noProtocol = input
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^github\.com\//, "");

  const parts = noProtocol.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  return {
    owner: parts[0],
    repo: parts[1],
    normalized: `https://github.com/${parts[0]}/${parts[1]}`,
  };
}

function mapWorkspaceTree(nodes: FileNode[]): TreeNode[] {
  return nodes
    .map((n) => ({
      name: n.name,
      path: n.path,
      isFile: n.type === "file",
      children: n.children ? mapWorkspaceTree(n.children) : [],
    }))
    .sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

function fileIcon(path: string, isRoot: boolean) {
  if (isRoot) return <Flame className="h-4 w-4 text-[var(--color-warning)] flex-shrink-0" />;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py"].includes(ext)) {
    return <FileCode className="h-4 w-4 text-sky-700 flex-shrink-0" />;
  }
  return <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
}

/**
 * Collect the connected neighbourhood around the focus file: everything it
 * imports (downstream) and everything importing it (upstream), up to MAX_HOPS,
 * capped at MAX_SUBSET nodes. The root-to-leaf chain is always included.
 */
function collectNeighbourhood(
  focusPath: string,
  chain: string[],
  adj: Adjacency,
): { subset: Set<string>; truncated: boolean } {
  const subset = new Set<string>([focusPath, ...chain.filter((p) => adj.nodeSet.has(p))]);
  let truncated = false;

  const expand = (map: Map<string, string[]>) => {
    let frontier = [focusPath];
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbour of map.get(node) ?? []) {
          if (subset.has(neighbour)) continue;
          if (subset.size >= MAX_SUBSET) {
            truncated = true;
            return;
          }
          subset.add(neighbour);
          next.push(neighbour);
        }
      }
      if (next.length === 0) return;
      frontier = next;
    }
    // more neighbours exist beyond the hop limit
    if (frontier.some((n) => (map.get(n) ?? []).some((x) => !subset.has(x)))) truncated = true;
  };

  expand(adj.parents);
  expand(adj.children);
  return { subset, truncated };
}

function layoutBranchTree(
  focusPath: string,
  chain: string[],
  nodes: GraphNode[],
  edges: GraphEdge[],
): { rfNodes: Node[]; rfEdges: Edge[]; truncated: boolean } {
  const nodeMap = new Map(nodes.map((n) => [n.path, n]));
  const adj = buildAdjacency(nodes, edges);
  const { parents, children } = adj;

  const { subset, truncated } = collectNeighbourhood(focusPath, chain, adj);

  // Layer = distance from the subset's entry points, so imports flow left→right.
  const roots = [...subset].filter(
    (p) => (parents.get(p) ?? []).filter((x) => subset.has(x)).length === 0,
  );
  const seeds = roots.length > 0 ? roots.sort() : [focusPath];

  // Shortest-path BFS, deliberately: taking the *longest* path instead diverges
  // on circular imports (Python packages are full of them) — every node in a
  // cycle keeps getting pushed one layer deeper until it pins to the cap, and
  // the whole graph collapses into a single column. First visit wins here, so
  // cycles terminate and layers stay meaningful.
  const layer = new Map<string, number>();
  const queue: Array<{ path: string; depth: number }> = seeds.map((r) => ({ path: r, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (layer.has(current.path)) continue;

    layer.set(current.path, Math.min(current.depth, MAX_LAYERS));
    for (const child of children.get(current.path) ?? []) {
      if (!subset.has(child) || layer.has(child)) continue;
      queue.push({ path: child, depth: current.depth + 1 });
    }
  }
  for (const p of subset) {
    if (!layer.has(p)) layer.set(p, 0);
  }

  const chainIndex = new Map<string, number>();
  chain.forEach((p, i) => chainIndex.set(p, i));

  const groups = new Map<number, string[]>();
  for (const p of subset) {
    const d = layer.get(p) ?? 0;
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(p);
  }

  for (const [, arr] of groups) {
    arr.sort((a, b) => {
      const ai = chainIndex.has(a) ? chainIndex.get(a)! : Number.MAX_SAFE_INTEGER;
      const bi = chainIndex.has(b) ? chainIndex.get(b)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }

  const rfNodes: Node[] = [];
  const orderedLayers = [...groups.keys()].sort((a, b) => a - b);
  for (const d of orderedLayers) {
    const arr = groups.get(d) ?? [];
    arr.forEach((p, idx) => {
      const g = nodeMap.get(p);
      const isFocus = p === focusPath;
      const isRoot = chain.length > 0 && p === chain[0] && !isFocus;
      const isLeaf = chain.length > 0 && p === chain[chain.length - 1] && !isFocus;
      const tone: FlowNodeData["tone"] = isFocus
        ? "focus"
        : chainIndex.has(p)
        ? "chain"
        : "normal";

      rfNodes.push({
        id: p,
        type: "impactNode",
        draggable: true,
        selectable: true,
        position: {
          // centre each layer vertically around y = 0
          x: d * (NODE_W + X_GAP),
          y: (idx - (arr.length - 1) / 2) * Y_GAP,
        },
        data: {
          label: p.split("/").pop() ?? p,
          path: p,
          ext: g?.ext ?? ".txt",
          tone,
          isRoot,
          isLeaf,
          isFocus,
          isTest: g?.is_test ?? false,
          imports: (children.get(p) ?? []).length,
          importedBy: (parents.get(p) ?? []).length,
        } satisfies FlowNodeData,
        style: { width: NODE_W, height: NODE_H },
      });
    });
  }

  const chainEdges = new Set<string>();
  for (let i = 0; i < chain.length - 1; i += 1) {
    chainEdges.add(`${chain[i]}->${chain[i + 1]}`);
  }

  const rfEdges: Edge[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!subset.has(edge.source) || !subset.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const id = `e:${edge.source}:${edge.target}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const onChain = chainEdges.has(`${edge.source}->${edge.target}`);
    const touchesFocus = edge.source === focusPath || edge.target === focusPath;
    const strong = onChain || touchesFocus;
    const color = touchesFocus ? "#B45309" : onChain ? "#2563EB" : "hsl(var(--muted-foreground) / 0.45)";

    rfEdges.push({
      id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: touchesFocus,
      zIndex: strong ? 2 : 1,
      style: { stroke: color, strokeWidth: strong ? 2.2 : 1.2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color,
      },
    });
  }

  return { rfNodes, rfEdges, truncated };
}

const ImpactNode = memo(({ data, selected }: NodeProps) => {
  const d = data as FlowNodeData;

  const classes =
    d.tone === "focus"
      ? "border-[var(--color-status-warning)]/60 bg-[var(--color-warning-bg)]"
      : d.tone === "chain"
      ? "border-blue-400/60 bg-blue-400/8"
      : "border-border/60 bg-card";

  return (
    <div
      className={cn(
        "h-full w-full rounded-xl border-2 px-3 py-2",
        "flex flex-col justify-between gap-1 cursor-pointer transition-all duration-150 shadow-md",
        classes,
        selected && "ring-2 ring-primary/30 border-primary"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ background: "hsl(var(--border))", width: 6, height: 6, border: "none", left: -4 }}
      />

      <div className="flex items-center gap-2 min-w-0">
        {fileIcon(d.path, d.isRoot)}
        <span className="font-mono text-[12px] font-semibold text-foreground truncate flex-1">
          {d.label}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase">{d.ext.replace(".", "")}</span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {d.isFocus && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-bg)] text-[var(--color-warning)]">
            selected
          </span>
        )}
        {d.isRoot && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-bg)] text-[var(--color-warning)]">
            root
          </span>
        )}
        {d.isLeaf && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-primary/15 text-primary">
            leaf
          </span>
        )}
        {d.isTest && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-600 dark:text-violet-300">
            test
          </span>
        )}
        {d.tone === "chain" && !d.isRoot && !d.isLeaf && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-400/15 text-sky-700">
            chain
          </span>
        )}
        <span
          className="ml-auto text-[9px] font-mono text-muted-foreground"
          title={`${d.importedBy} file(s) import this - this file imports ${d.imports}`}
        >
          &darr;{d.importedBy} &uarr;{d.imports}
        </span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ background: "hsl(var(--border))", width: 6, height: 6, border: "none", right: -4 }}
      />
    </div>
  );
});
ImpactNode.displayName = "ImpactNode";

const NODE_TYPES = { impactNode: ImpactNode };

function BranchFlowCanvas({
  focusPath,
  chain,
  nodes,
  edges,
  showTests,
  onNodeClick,
}: {
  focusPath: string;
  chain: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  showTests: boolean;
  onNodeClick: (path: string) => void;
}) {
  // Hiding tests drops their nodes AND any edge touching them, so no edge is
  // left dangling. The selected file is never hidden, even if it is a test.
  const visible = useMemo(() => {
    if (showTests) return { nodes, edges };
    const keep = new Set(
      nodes.filter((n) => !n.is_test || n.path === focusPath).map((n) => n.path),
    );
    return {
      nodes: nodes.filter((n) => keep.has(n.path)),
      edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [nodes, edges, showTests, focusPath]);

  const { rfNodes, rfEdges, truncated } = useMemo(
    () => layoutBranchTree(focusPath, chain, visible.nodes, visible.edges),
    [focusPath, chain, visible]
  );

  if (rfNodes.length <= 1) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground/70">
        <Code2 className="h-8 w-8 opacity-20" />
        <p className="text-xs text-center max-w-sm">
          <span className="font-mono text-foreground/80">{focusPath.split("/").pop()}</span> has no
          resolved imports and nothing in this repo imports it, so there is nothing to wire up.
        </p>
        <p className="text-[10px] text-center max-w-sm opacity-70">
          Only relative / <code>@/</code> imports between <code>.ts .tsx .js .jsx .py</code> files are
          tracked; test files are excluded from the graph.
        </p>
      </div>
    );
  }

  return (
    <ReactFlow
      key={focusPath}
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={true}
      minZoom={0.1}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
      onNodeClick={(_e, node) => onNodeClick(node.id)}
      proOptions={{ hideAttribution: true }}
      style={{ background: "transparent" }}
    >
      <Background
        variant={BackgroundVariant.Lines}
        gap={30}
        size={1}
        color="hsl(var(--border) / 0.1)"
      />
      <Controls
        showInteractive={false}
        className="!bg-muted/40 !border-border/40 !shadow-none [&>button]:!bg-transparent [&>button]:!border-border/30"
      />
      <Panel position="top-right">
        <div className="rounded-md border border-border/40 bg-card/80 px-2.5 py-1.5 text-[10px] backdrop-blur space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[#B45309]" /> touches selected file
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[#2563EB]" /> root &rarr; leaf chain
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-muted-foreground/45" /> other links
          </div>
          <div className="pt-0.5 text-muted-foreground">
            arrow points from importer &rarr; imported
          </div>
          {truncated && (
            <div className="pt-1 mt-1 border-t border-border/40 text-[var(--color-warning)]">
              showing {rfNodes.length} nearest files &mdash; more exist beyond {MAX_HOPS} hops
            </div>
          )}
        </div>
      </Panel>
    </ReactFlow>
  );
}

function FileTreeNode({
  node,
  depth,
  selectedFile,
  highlightedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  highlightedPath: string[];
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isHighlighted = highlightedPath.includes(node.path);
  const isSelected = selectedFile === node.path;

  if (node.isFile) {
    return (
      <button
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent",
          isSelected
            ? "bg-primary/10 text-primary font-medium"
            : isHighlighted
            ? "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-sky-700"
            : "text-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node.path)}
      >
        {isHighlighted ? (
          <Flame className="h-3 w-3 shrink-0 text-[var(--color-warning)]" />
        ) : (
          <File className="h-3 w-3 shrink-0 opacity-60" />
        )}
        <span className="truncate flex-1">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-foreground hover:bg-accent transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <FolderOpen className="h-3 w-3 shrink-0 text-amber-500" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-amber-500" />
        )}
        {open ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0 opacity-50" />
        )}
        <span className="font-medium truncate">{node.name}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedFile={selectedFile}
            highlightedPath={highlightedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export default function CodeImpact() {
  const editorTheme = useMonacoTheme();

  const connectWorkspace = useConnectWorkspace();
  const { activeRepo, setActiveRepo } = useActiveRepo();

  const [repoUrl, setRepoUrl] = useState(activeRepo?.repoUrl ?? "");
  const [branch, setBranch] = useState(activeRepo?.branch ?? "main");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);

  const [graphData, setGraphData] = useState<WorkspaceGraphResponse | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string; language: string } | null>(null);
  const [showTests, setShowTests] = useState(false);

  const testFileCount = useMemo(
    () => (graphData?.nodes ?? []).filter((n) => n.is_test).length,
    [graphData],
  );

  const parseRepo = useMemo(() => parseRepoUrl(repoUrl), [repoUrl]);

  const loadWorkspaceGraph = useCallback(async (workspaceId: string): Promise<boolean> => {
    setLoadingGraph(true);
    try {
      const graph = await impactApi.buildWorkspaceGraph({ workspace_id: workspaceId });
      setGraphData(graph);
      return true;
    } catch (err: unknown) {
      setGraphData(null);
      toast.error(
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          ?? "Failed to build dependency graph",
      );
      return false;
    } finally {
      setLoadingGraph(false);
    }
  }, []);

  const handleConnectRepo = async () => {
    if (!parseRepo) {
      toast.error("Enter a valid GitHub repo URL");
      return;
    }

    try {
      const ws = await connectWorkspace.mutateAsync({
        github_url: parseRepo.normalized,
        branch,
      });

      setWorkspace(ws);
      setTreeNodes(mapWorkspaceTree(ws.tree ?? []));
      setActiveRepo(parseRepo.normalized, branch);
      const graphed = await loadWorkspaceGraph(ws.workspace_id);

      setSelectedFile(null);
      setHighlightedPath([]);
      setPreviewFile(null);

      if (graphed) {
        toast.success(`Connected ${parseRepo.owner}/${parseRepo.repo} and analyzed entire repository`);
      } else {
        toast.success(`Connected ${parseRepo.owner}/${parseRepo.repo}. Graph analysis failed — see the error above.`);
      }
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to connect repository");
    }
  };

  const handleFileSelect = useCallback((filePath: string) => {
    if (!graphData) return;

    setSelectedFile(filePath);
    setPreviewFile(null);

    const chain = deriveRootToLeafChain(filePath, graphData.nodes ?? [], graphData.edges ?? []);
    setHighlightedPath(chain.length > 0 ? chain : [filePath]);
  }, [graphData]);

  const handleNodePreview = useCallback(async (filePath: string) => {
    if (!workspace) return;

    if (previewFile?.path === filePath) {
      setPreviewFile(null);
      return;
    }

    try {
      const fc = await api.getWorkspaceFile(workspace.workspace_id, filePath);
      setPreviewFile({ path: filePath, content: fc.content, language: fc.language });
    } catch {
      toast.error("Could not load file preview");
    }
  }, [workspace, previewFile]);

  const chain = useMemo(() => {
    if (!selectedFile) return [];
    if (highlightedPath.length > 0) return highlightedPath;
    return [selectedFile];
  }, [selectedFile, highlightedPath]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {!workspace ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-5 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg border border-primary/30 bg-primary/10 flex items-center justify-center">
                <Github className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Code Impact</p>
                <p className="text-xs text-muted-foreground">Enter repository URL first to explore full folders/files (not commit-specific).</p>
              </div>
            </div>

            <div className="space-y-3">
              <Input
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <Input
                placeholder="branch (default: main)"
                value={branch}
                onChange={(e) => setBranch(e.target.value || "main")}
              />
              <Button
                onClick={handleConnectRepo}
                disabled={connectWorkspace.isPending || !repoUrl.trim()}
                className="w-full gap-2"
              >
                {connectWorkspace.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Connect And Analyze Entire Repo
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              <span>Code Impact</span>
            </div>

            <div className="flex flex-1 items-center gap-2 max-w-4xl">
              <Input
                placeholder="GitHub repo URL"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="h-8 text-sm w-[360px]"
              />
              <Input
                placeholder="branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value || "main")}
                className="h-8 text-sm w-36"
              />

              <Button
                size="sm"
                onClick={handleConnectRepo}
                disabled={connectWorkspace.isPending}
                className="h-8 gap-1.5"
              >
                {connectWorkspace.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Reconnect
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (!workspace) return;
                  await loadWorkspaceGraph(workspace.workspace_id);
                  toast.success("Repository graph refreshed");
                }}
                disabled={loadingGraph}
                className="h-8 gap-1.5"
              >
                {loadingGraph ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh Graph
              </Button>
            </div>

            {graphData && (
              <div className="ml-auto flex items-center gap-2 text-xs">
                <Badge variant="secondary" className="text-[10px]">
                  {graphData.nodes.length} nodes
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {graphData.edges.length} edges
                </Badge>
              </div>
            )}
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex w-64 shrink-0 flex-col border-r border-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  View Entry
                </span>
                <button
                  className="ml-auto h-5 w-5 flex items-center justify-center rounded hover:bg-muted/60"
                  onClick={async () => {
                    if (!workspace || loadingGraph) return;
                    await loadWorkspaceGraph(workspace.workspace_id);
                  }}
                  title="Refresh"
                >
                  <RefreshCw className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>

              <div className="px-3 py-1 border-b border-border text-[10px] text-muted-foreground">
                Entire repo folders/files with dependency flow
              </div>

              <ScrollArea className="flex-1">
                <div className="p-1">
                  {treeNodes.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">No files yet</p>
                  ) : (
                    treeNodes.map((node) => (
                      <FileTreeNode
                        key={node.path}
                        node={node}
                        depth={0}
                        selectedFile={selectedFile}
                        highlightedPath={highlightedPath}
                        onSelect={handleFileSelect}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>

              {chain.length > 0 && (
                <div className="border-t border-border p-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Root to leaf</p>
                  <p className="truncate text-[10px]" title={chain.join(" -> ")}>
                    {chain.join(" -> ")}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
                <button
                  className="h-6 px-2 rounded border border-border/40 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-1"
                  onClick={() => {
                    setSelectedFile(null);
                    setHighlightedPath([]);
                    setPreviewFile(null);
                  }}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Reset Selection
                </button>
                <span className="font-semibold">Root → Branches → Leaf</span>
                {chain.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded">
                    {chain.length} chain nodes
                  </span>
                )}
                <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none text-[10px] text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    className="h-3 w-3 accent-[var(--color-warning)]"
                    checked={showTests}
                    onChange={(e) => setShowTests(e.target.checked)}
                  />
                  show test files
                  {testFileCount > 0 && (
                    <span className="text-muted-foreground/60">({testFileCount})</span>
                  )}
                </label>
                <span className="text-muted-foreground">click a node to preview code</span>
              </div>

              <div className="flex-1 min-h-0 flex overflow-hidden">
                <div className={cn("min-h-0", previewFile ? "flex-[6]" : "flex-1")}>
                  {loadingGraph ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mr-2" />
                      Building dependency graph...
                    </div>
                  ) : !selectedFile || !graphData ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/50 p-8">
                      <Code2 className="h-8 w-8 opacity-20" />
                      <p className="text-xs text-center">Select a file on the left to view wire-connected root/branch/leaf graph.</p>
                    </div>
                  ) : (
                    <BranchFlowCanvas
                      focusPath={selectedFile}
                      chain={chain}
                      nodes={graphData.nodes}
                      edges={graphData.edges}
                      showTests={showTests}
                      onNodeClick={handleNodePreview}
                    />
                  )}
                </div>

                {previewFile && (
                  <div className="flex-[4] border-l border-border/40 flex flex-col min-h-0 min-w-0 bg-background">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/20 flex-shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode className="h-3.5 w-3.5 text-sky-700 flex-shrink-0" />
                        <span className="text-xs font-mono font-medium text-foreground/80 truncate" title={previewFile.path}>
                          {previewFile.path.split("/").pop()}
                        </span>
                      </div>
                      <button
                        onClick={() => setPreviewFile(null)}
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/60 flex-shrink-0 ml-2"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>

                    <div className="px-3 py-1 border-b border-border/20 flex-shrink-0 bg-muted/10">
                      <p className="text-[9px] text-muted-foreground/50 truncate font-mono" title={previewFile.path}>
                        {previewFile.path}
                      </p>
                    </div>

                    <div className="flex-1 min-h-0">
                      <Editor
                        height="100%"
                        language={previewFile.language}
                        value={previewFile.content}
                        theme={editorTheme}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          fontSize: 12,
                          lineNumbers: "on",
                          scrollBeyondLastLine: false,
                          wordWrap: "on",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
