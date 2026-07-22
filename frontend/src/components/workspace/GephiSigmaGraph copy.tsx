import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import louvain from "graphology-communities-louvain";
import {
  SigmaContainer,
  useRegisterEvents,
  useSigma,
  useLoadGraph,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import { Search, X, Maximize2, Minimize2, Loader2, AlertCircle, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GraphEdge, GraphNode } from "@/lib/api";

interface GephiSigmaGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusPath?: string;
  changedPaths?: Set<string>;
  className?: string;
}

type SigmaNodeAttrs = {
  label: string;
  path: string;
  ext: string;
  size: number;
  color: string;
  x: number;
  y: number;
  degree: number;
  inDegree: number;
  outDegree: number;
  isChanged: boolean;
};

// ── Design Tokens ────────────────────────────────────────────────────────────

const PALETTE = [
  "#2dd4bf", // teal-400
  "#fb923c", // orange-400
  "#38bdf8", // sky-400
  "#a78bfa", // violet-400
  "#4ade80", // green-400
  "#f472b6", // pink-400
  "#fbbf24", // amber-400
  "#818cf8", // indigo-400
  "#f87171", // red-400
  "#94a3b8", // slate-400
];

function extFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext || "unknown";
}

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashToUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function deterministicPosition(path: string): { x: number; y: number } {
  const u1 = hashToUnit(`${path}:x`);
  const u2 = hashToUnit(`${path}:y`);
  const angle = u1 * Math.PI * 2;
  const radius = 20 + u2 * 90;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function colorForCommunity(community: number): string {
  return PALETTE[Math.abs(community) % PALETTE.length];
}

function colorForModule(path: string): string {
  const parts = path.split("/");
  // Try to find a meaningful module name (usually first or second directory)
  const moduleName = parts.length > 1 ? parts[0] === "src" ? parts[1] : parts[0] : "root";
  let hash = 0;
  for (let i = 0; i < moduleName.length; i++) {
    hash = moduleName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// ── Graph Logic ──────────────────────────────────────────────────────────────

function buildGraphologyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  changedPaths: Set<string>,
): Graph {
  const graph = new Graph({ type: "directed", multi: false });
  
  // Normalization: strip extensions, convert dots/slashes to a canonical form, strip prefixes
  const normalize = (p: string) => 
    p.replace(/\\/g, "/")
     .replace(/^\.?\//, "")
     .replace(/\.(py|ts|tsx|js|jsx|css|scss|json)$/i, "")
     .split("/")
     .join("."); // Convert everything to dots for a common denominator

  // Map of normalized paths and their suffixes to original paths
  const pathMap = new Map<string, string>(); 
  
  nodes.forEach(n => {
    const fullNorm = normalize(n.path);
    pathMap.set(fullNorm, n.path);
    
    // Support suffix matching (e.g., if edge is "auth.route" and path is "backend/auth/route.py")
    const parts = fullNorm.split(".");
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join(".");
      // Only set if not already present or if the new one is "shorter" (closer match)
      if (!pathMap.has(suffix)) {
        pathMap.set(suffix, n.path);
      }
    }

    // Special handling for directory/init files
    if (n.path.endsWith("/__init__.py")) {
      const dirPath = normalize(n.path.replace("/__init__.py", ""));
      pathMap.set(dirPath, n.path);
    }
  });

  const getOriginalPath = (p: string) => {
    const norm = normalize(p);
    // 1. Try exact match
    if (pathMap.has(p)) return pathMap.get(p)!;
    // 2. Try normalized match
    if (pathMap.has(norm)) return pathMap.get(norm)!;
    
    // 3. Try dot-to-slash conversion if not already handled
    const dotNorm = p.replace(/\./g, "/");
    if (pathMap.has(dotNorm)) return pathMap.get(dotNorm)!;

    return p;
  };

  const nodeSet = new Set(nodes.map((n) => n.path));
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  // Resolve edges with multi-strategy matching
  const matchedEdges: { source: string; target: string }[] = [];
  edges.forEach(e => {
    const s = getOriginalPath(e.source);
    const t = getOriginalPath(e.target);
    if (nodeSet.has(s) && nodeSet.has(t) && s !== t) {
      matchedEdges.push({ source: s, target: t });
      outDegree.set(s, (outDegree.get(s) ?? 0) + 1);
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  });

  for (const node of nodes) {
    const indeg = inDegree.get(node.path) ?? 0;
    const outdeg = outDegree.get(node.path) ?? 0;
    const degree = indeg + outdeg;

    // Phase 1: Multi-factor Importance Score
    const importance = (indeg * 2.8) + (outdeg * 1.5); // Boost weights
    const size = 7 + Math.sqrt(importance) * 5;

    const pos = deterministicPosition(node.path);

    graph.addNode(node.path, {
      label: baseName(node.path),
      path: node.path,
      ext: extFromPath(node.path),
      degree,
      inDegree: indeg,
      outDegree: outdeg,
      importance,
      size: Math.min(50, Math.max(7, size)),
      x: pos.x,
      y: pos.y,
      color: (changedPaths.has(node.path) || node.is_changed) ? "#f97316" : colorForModule(node.path),
      isChanged: (changedPaths.has(node.path) || node.is_changed),
    } as SigmaNodeAttrs);
  }

  for (const e of matchedEdges) {
    const edgeKey = `${e.source}->${e.target}`;
    if (!graph.hasEdge(edgeKey)) {
      graph.addDirectedEdgeWithKey(edgeKey, e.source, e.target, {
        weight: 1.5,
        size: 2,
        color: "#94a3b8", // Slate-400 for better visibility
      });
    }
  }

  if (graph.order > 0) {
    try {
      const communities = louvain(graph);
      graph.forEachNode((node) => {
        const community = Number(communities[node] ?? 0);
        const attrs = graph.getNodeAttributes(node) as SigmaNodeAttrs;
        if (!attrs.isChanged) {
          graph.setNodeAttribute(node, "color", colorForCommunity(community));
        }
      });

      const settings = forceAtlas2.inferSettings(graph);
      forceAtlas2.assign(graph, {
        iterations: 260,
        settings: {
          ...settings,
          gravity: 1,
          scalingRatio: 55,
          linLogMode: true,
          adjustSizes: true,
          edgeWeightInfluence: 0.9,
          strongGravityMode: true,
          slowDown: 1.2,
        },
      });
    } catch (e) {
      console.error("Layout failed:", e);
    }

    let cx = 0;
    let cy = 0;
    let count = 0;
    graph.forEachNode((node) => {
      const x = graph.getNodeAttribute(node, "x") as number;
      const y = graph.getNodeAttribute(node, "y") as number;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      cx += x;
      cy += y;
      count += 1;
    });

    const centerX = count > 0 ? cx / count : 0;
    const centerY = count > 0 ? cy / count : 0;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    graph.forEachNode((node) => {
      const x = (graph.getNodeAttribute(node, "x") as number) - centerX;
      const y = (graph.getNodeAttribute(node, "y") as number) - centerY;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const scale = 190 / span;
    graph.forEachNode((node) => {
      const x = graph.getNodeAttribute(node, "x") as number;
      const y = graph.getNodeAttribute(node, "y") as number;
      graph.setNodeAttribute(node, "x", (x - centerX) * scale);
      graph.setNodeAttribute(node, "y", (y - centerY) * scale);
    });
  }
  return graph;
}

// ── Interaction Components ───────────────────────────────────────────────────

function GraphTooltip({ node, graph }: { node: string | null; graph: Graph }) {
  const sigma = useSigma();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!node || !graph.hasNode(node)) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const { x, y } = graph.getNodeAttributes(node) as any;
      const pos = sigma.graphToViewport({ x, y });
      setPosition(pos);
    };

    updatePosition();
    sigma.getCamera().on("updated", updatePosition);
    return () => {
      sigma.getCamera().off("updated", updatePosition);
    };
  }, [node, graph, sigma]);

  if (!node || !position || !graph.hasNode(node)) return null;
  const attrs = graph.getNodeAttributes(node) as SigmaNodeAttrs;

  return (
    <div
      className="absolute z-50 pointer-events-none transform -translate-x-1/2 -translate-y-[calc(100%+16px)] animate-in fade-in zoom-in-95 duration-200"
      style={{ left: position.x, top: position.y }}
    >
      <div className="bg-white/90 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 shadow-2xl min-w-[200px] space-y-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
            <FileCode className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-black text-slate-900 truncate block uppercase tracking-tight">
              {attrs.label}
            </span>
            <span className="text-[8px] text-slate-500 font-mono truncate block">
              {attrs.path}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
          <div className="flex flex-col items-center bg-slate-100/50 rounded-lg p-1.5">
            <span className="text-[7px] text-slate-500 font-bold uppercase tracking-widest">InBound</span>
            <span className="text-[10px] font-black text-sky-600">{attrs.inDegree}</span>
          </div>
          <div className="flex flex-col items-center bg-slate-100/50 rounded-lg p-1.5">
            <span className="text-[7px] text-slate-500 font-bold uppercase tracking-widest">OutBound</span>
            <span className="text-[10px] font-black text-orange-600">{attrs.outDegree}</span>
          </div>
        </div>

        {attrs.isChanged && (
          <div className="bg-orange-50 border border-orange-500/20 rounded-lg py-1 px-2 text-[8px] font-black text-orange-600 uppercase tracking-widest text-center">
            Modified File
          </div>
        )}
      </div>
      {/* Arrow */}
      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-white rotate-45 border-r border-b border-slate-200/60" />
    </div>
  );
}

function GraphInteractionLayer({
  graph,
  focusPath,
  selectedNode,
  setSelectedNode,
  setHoveredNode,
  activeExtensions,
  searchText,
  cameraResetCount,
  insightMode,
  isolateFocus,
  isExpanded,
}: {
  graph: Graph;
  focusPath?: string;
  selectedNode: string | null;
  setSelectedNode: (node: string | null) => void;
  setHoveredNode: (node: string | null) => void;
  activeExtensions: Set<string>;
  searchText: string;
  cameraResetCount: number;
  insightMode: boolean;
  isolateFocus: boolean;
  isExpanded: boolean;
}) {
  const sigma = useSigma();
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const [hoveredNodeInternal, setHoveredInternal] = useState<string | null>(null);
  const lastResetRef = useRef(0);

  const getCenterCamera = useCallback(() => {
    if (!graph || graph.order === 0) {
      return { x: 0, y: 0, ratio: 1.2 };
    }

    const normalizedSearch = searchText.trim().toLowerCase();
    const activeFocusNode = selectedNode || focusPath || null;
    let focusNeighborhood = new Set<string>();
    if (isolateFocus && activeFocusNode && graph.hasNode(activeFocusNode)) {
      focusNeighborhood = new Set(graph.neighbors(activeFocusNode) as string[]);
      focusNeighborhood.add(activeFocusNode);
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    graph.forEachNode((node) => {
      const attrs = graph.getNodeAttributes(node) as SigmaNodeAttrs;

      if (!activeExtensions.has(attrs.ext)) return;

      if (
        insightMode &&
        attrs.inDegree === 0 &&
        attrs.outDegree <= 1 &&
        !attrs.isChanged &&
        node !== focusPath &&
        node !== selectedNode
      ) {
        return;
      }

      if (normalizedSearch.length > 0) {
        const label = attrs.label?.toLowerCase() ?? "";
        const path = attrs.path?.toLowerCase() ?? "";
        if (!label.includes(normalizedSearch) && !path.includes(normalizedSearch)) return;
      }

      if (isolateFocus && activeFocusNode && focusNeighborhood.size > 0 && !focusNeighborhood.has(node)) {
        return;
      }

      const x = Number(attrs.x);
      const y = Number(attrs.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      count += 1;
    });

    if (
      count === 0 ||
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY)
    ) {
      return { x: 0, y: 0, ratio: 1.2 };
    }

    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const ratio = clamp(span / 120, 0.72, 2.8);
    const centerX = sumX / count;
    const centerY = sumY / count;

    return { x: centerX, y: centerY, ratio };
  }, [graph, activeExtensions, insightMode, searchText, isolateFocus, selectedNode, focusPath]);

  const centerGraph = useCallback(
    (duration = 0) => {
      const camera = sigma.getCamera();
      if (!camera) return;
      camera.animate(getCenterCamera(), { duration });
      sigma.refresh();
    },
    [sigma, getCenterCamera],
  );

  useEffect(() => {
    if (!graph || !sigma) return;
    try {
      loadGraph(graph);
      const t1 = window.setTimeout(() => centerGraph(0), 80);
      const t2 = window.setTimeout(() => centerGraph(180), 260);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    } catch (e) {
      console.error("Failed to load graph:", e);
    }
  }, [graph, loadGraph, sigma, centerGraph]);

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => {
        setHoveredInternal(node);
        setHoveredNode(node);
      },
      leaveNode: () => {
        setHoveredInternal(null);
        setHoveredNode(null);
      },
      clickNode: ({ node }) => setSelectedNode(node),
      clickStage: () => setSelectedNode(null),
    });
  }, [registerEvents, setSelectedNode, setHoveredNode]);

  useEffect(() => {
    // If a manual reset was triggered, show the whole graph
    if (cameraResetCount > lastResetRef.current) {
      lastResetRef.current = cameraResetCount;
      sigma.getCamera().animate(getCenterCamera(), { duration: 800 });
      return;
    }

    const focus = selectedNode || null;
    if (focus && graph.hasNode(focus)) {
      const { x, y } = graph.getNodeAttributes(focus) as any;
      if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) {
        sigma.getCamera().animate({ x, y, ratio: 0.55 }, { duration: 800 });
      }
    }
  }, [sigma, graph, selectedNode, cameraResetCount, getCenterCamera]);

  useEffect(() => {
    // Keep graph centered when filters/search change, unless user explicitly selected a node.
    if (selectedNode) return;
    if (!sigma.getCamera()) return;
    centerGraph(300);
  }, [sigma, selectedNode, centerGraph]);

  useEffect(() => {
    // Recenter when the viewport/container resizes (split panes, fullscreen, sidebar changes).
    const handleResize = () => centerGraph(220);
    window.addEventListener("resize", handleResize);

    const container = (sigma as any).getContainer?.() as HTMLElement | undefined;
    const observer =
      container && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => handleResize())
        : null;
    if (container && observer) observer.observe(container);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (observer) observer.disconnect();
    };
  }, [sigma, centerGraph]);

  useEffect(() => {
    // Fullscreen/compact toggle can apply size changes in two phases.
    const t1 = window.setTimeout(() => centerGraph(120), 40);
    const t2 = window.setTimeout(() => centerGraph(260), 220);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isExpanded, centerGraph]);

  useEffect(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    
    const activeFocusNode = hoveredNodeInternal || selectedNode || focusPath || null;
    let connected = new Set<string>();
    
    if (activeFocusNode && graph.hasNode(activeFocusNode)) {
      connected = new Set(graph.neighbors(activeFocusNode) as string[]);
      connected.add(activeFocusNode);
    }

    sigma.setSetting("nodeReducer", (node, data) => {
      try {
        if (!graph.hasNode(node)) return data;
        const attrs = graph.getNodeAttributes(node) as SigmaNodeAttrs;
        
        // Phase 1 -> 3: Reduce Noise (Insight Mode)
        // Hide leaf nodes with no inbound connections in insight mode
        if (insightMode && attrs.inDegree === 0 && attrs.outDegree <= 1 && !attrs.isChanged && node !== focusPath && node !== selectedNode) {
          return { ...data, hidden: true };
        }

        if (!activeExtensions || !activeExtensions.has(attrs.ext)) return { ...data, hidden: true };

        const matchesSearch = normalizedSearch.length === 0 ||
          (attrs.label && attrs.label.toLowerCase().includes(normalizedSearch)) ||
          (attrs.path && attrs.path.toLowerCase().includes(normalizedSearch));

        if (!matchesSearch && normalizedSearch.length > 0) {
          return { ...data, color: "#f1f5f9", label: "", zIndex: 0 };
        }

        // Phase 2: Focus Mode (Persistent on Click or Hover or Selected UI File)
        const isCurrentFocus = node === activeFocusNode;
        const isCurrentlyEdited = node === focusPath; // UI explicitly is editing this

        // Dim nodes that are not in the neighborhood of the active focus
        if (isolateFocus && activeFocusNode && !connected.has(node)) {
          return { ...data, color: "#f8fafc", label: "", zIndex: 0 };
        }

        const result: any = {
          ...data,
          color: isCurrentlyEdited ? "#0ea5e9" : attrs.color,
          label: attrs.label,
          zIndex: isCurrentFocus ? 100 : (connected.has(node) ? 10 : 1),
          // Keep labels focused to reduce clutter in dense graphs
          forceLabel: isCurrentFocus || isCurrentlyEdited,
        };

        if (isCurrentFocus && typeof data.size === "number") {
          result.size = data.size + 12;
        }

        return result;
      } catch (e) {
        return data;
      }
    });

    sigma.setSetting("edgeReducer", (edge, data) => {
      try {
        if (!graph.hasEdge(edge)) return data;
        const source = graph.source(edge);
        const target = graph.target(edge);
        if (!graph.hasNode(source) || !graph.hasNode(target)) return data;
        
        const sourceAttrs = graph.getNodeAttributes(source) as SigmaNodeAttrs;
        const targetAttrs = graph.getNodeAttributes(target) as SigmaNodeAttrs;

        if (!activeExtensions || !activeExtensions.has(sourceAttrs.ext) || !activeExtensions.has(targetAttrs.ext)) {
          return { ...data, hidden: true };
        }

        // Phase 1: Insight mode hides connections to hidden nodes
        if (insightMode) {
           const sIn = sourceAttrs.inDegree;
           const tIn = targetAttrs.inDegree;
           // If either end would be hidden by insight mode, hide the edge
           if ((sIn === 0 && sourceAttrs.outDegree <= 1 && source !== focusPath && source !== selectedNode) ||
               (tIn === 0 && targetAttrs.outDegree <= 1 && target !== focusPath && target !== selectedNode)) {
             return { ...data, hidden: true };
           }
        }

        if (activeFocusNode) {
          const isConnected = source === activeFocusNode || target === activeFocusNode;
          
          if (!isConnected) {
            return isolateFocus ? { ...data, hidden: true } : { ...data, color: "#cbd5e1", size: 1, zIndex: 1 };
          }
          
          // Differentiate dependency directions
          // Target === activeFocusNode means the Source imports it (Source depends on Focus) -> INBOUND (Who uses me) -> Cyan
          // Source === activeFocusNode means the Focus imports Target (Focus depends on Target) -> OUTBOUND (What I use) -> Orange 
          const isOutbound = source === activeFocusNode;
          return { 
            ...data, 
            color: isOutbound ? "#f97316" : "#0ea5e9", 
            size: isOutbound ? 3 : 2, 
            zIndex: 10 
          };
        }

        return { ...data, color: "#cbd5e1", size: 1 };
      } catch (e) {
        return data;
      }
    });

    sigma.refresh();
  }, [sigma, graph, hoveredNodeInternal, activeExtensions, selectedNode, focusPath, searchText, insightMode, isolateFocus]);

  return null;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function GephiSigmaGraph({
  nodes,
  edges,
  focusPath,
  changedPaths = new Set<string>(),
  className,
}: GephiSigmaGraphProps) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [cameraResetCount, setCameraResetCount] = useState(0);
  const [insightMode, setInsightMode] = useState(false);
  const [isolateFocus, setIsolateFocus] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const allExts = useMemo(() => [...new Set(nodes.map((n) => extFromPath(n.path)))].sort(), [nodes]);
  const [activeExtensions, setActiveExtensions] = useState<Set<string>>(new Set(allExts));

  useEffect(() => setActiveExtensions(new Set(allExts)), [allExts.join("|")]);

  const graph = useMemo(() => {
    try {
      setIsInitializing(true);
      const g = buildGraphologyGraph(nodes, edges, changedPaths);
      setIsInitializing(false);
      return g;
    } catch (e) {
      setIsInitializing(false);
      return new Graph();
    }
  }, [nodes, edges, changedPaths]);

  const handleToggleExpanded = () => {
    setIsExpanded((prev) => !prev);
    setSelectedNode(null);
    setCameraResetCount((prev) => prev + 1);
  };

  const rootClassName = cn(
    "h-full min-h-[500px] flex flex-col bg-white rounded-2xl overflow-hidden border border-slate-200/60 shadow-sm transition-all duration-300",
    isExpanded && "fixed inset-0 z-[80] rounded-none border-0 shadow-2xl",
    className,
  );

  return (
    <div className={rootClassName}>
      {/* Translucent Light Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-200/40 bg-white/80 backdrop-blur-xl flex items-center gap-8 flex-wrap z-20">
        <div className="relative min-w-[320px] flex-1 max-w-[600px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Explore dependency universe..."
            className="w-full h-11 rounded-2xl border border-slate-200/60 bg-slate-50/50 pl-12 pr-12 text-[13px] text-slate-700 outline-none focus:ring-2 focus:ring-primary/20 transition-all font-mono tracking-tight placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setInsightMode(!insightMode)}
            className={cn(
              "h-10 px-4 rounded-xl text-[11px] font-black border transition-all duration-300 uppercase tracking-widest flex items-center gap-2",
              insightMode
                ? "border-amber-400/40 bg-amber-400/10 text-amber-600 shadow-sm"
                : "border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50",
            )}
            title={insightMode ? "Showing critical path only" : "Showing full architectural mess"}
          >
            <div className={cn("w-2 h-2 rounded-full", insightMode ? "bg-amber-500 animate-pulse" : "bg-slate-300")} />
            {insightMode ? "Insight View" : "Full View"}
          </button>

          <button
            onClick={() => setIsolateFocus(!isolateFocus)}
            className={cn(
              "h-10 px-4 rounded-xl text-[11px] font-black border transition-all duration-300 uppercase tracking-widest flex items-center gap-2",
              isolateFocus
                ? "border-sky-400/40 bg-sky-400/10 text-sky-600 shadow-sm"
                : "border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50",
            )}
            title={isolateFocus ? "Isolating neighbors of the focused file" : "Showing all connections"}
          >
            <div className={cn("w-2 h-2 rounded-full", isolateFocus ? "bg-sky-500 animate-pulse" : "bg-slate-300")} />
            {isolateFocus ? "Isolated" : "Show All"}
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {allExts.slice(0, 8).map((ext) => (
            <button
              key={ext}
              onClick={() => setActiveExtensions(prev => {
                const next = new Set(prev);
                if (next.has(ext)) next.delete(ext); else next.add(ext);
                return next;
              })}
              className={cn(
                "h-10 px-4 rounded-xl text-[11px] font-black border transition-all duration-300 uppercase tracking-widest",
                activeExtensions.has(ext)
                  ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                  : "border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50",
              )}
            >
              .{ext}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-6">
          <div className="hidden xl:flex flex-col items-end opacity-40">
            <span className="text-[11px] font-black text-slate-800 uppercase tracking-widest leading-none">{nodes.length} COMPONENTS</span>
            <span className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase">{edges.length} LINKS</span>
          </div>
          <button
            onClick={handleToggleExpanded}
            className="p-3 rounded-2xl bg-white border border-slate-200/60 text-slate-400 hover:text-primary transition-all hover:border-primary/30 active:scale-95 shadow-sm"
            title={isExpanded ? "Collapse graph" : "Expand graph"}
          >
            {isExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Luxury Canvas Area */}
      <div className="relative flex-1 min-h-0">
        {isInitializing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/40 backdrop-blur-xl">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-primary/20 animate-pulse rounded-full" />
              <Loader2 className="h-12 w-12 animate-spin text-primary/40 relative z-10" />
            </div>
            <span className="text-[11px] uppercase font-black tracking-[0.2em] text-primary/40 mt-6">Assembling Dependency Matrix</span>
          </div>
        )}

        <SigmaContainer
          key={`${nodes.length}-${edges.length}-${isExpanded ? "expanded" : "compact"}`}
          style={{ height: "100%", width: "100%", background: "transparent" }}
          settings={{
            allowInvalidContainer: true,
            renderLabels: true,
            defaultNodeType: "circle",
            defaultEdgeType: "line",
            labelDensity: 0.3,
            labelGridCellSize: 50,
            labelRenderedSizeThreshold: 14,
            minCameraRatio: 0.001,
            maxCameraRatio: 50,
            zIndex: true,
            labelFont: "Inter, system-ui, sans-serif",
            labelSize: 12,
            labelColor: { color: "#475569" },
            labelWeight: "700",
          }}
        >
          <GraphInteractionLayer
            graph={graph}
            focusPath={focusPath}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            setHoveredNode={setHoveredNode}
            activeExtensions={activeExtensions}
            searchText={search}
            cameraResetCount={cameraResetCount}
            insightMode={insightMode}
            isolateFocus={isolateFocus}
            isExpanded={isExpanded}
          />
          <GraphTooltip node={hoveredNode} graph={graph} />
        </SigmaContainer>

        {/* Persistent Selection Indicator (Minimal) */}
        {selectedNode && (
          <div className="absolute left-8 bottom-8 flex items-center gap-4 bg-white/70 backdrop-blur-2xl border border-slate-200/60 px-5 py-3 rounded-2xl shadow-xl animate-in slide-in-from-bottom-8 duration-700">
            <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_15px_rgba(255,161,43,0.5)] animate-pulse" />
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-800 uppercase tracking-tight truncate max-w-[240px]">
                {baseName(selectedNode)}
              </span>
              <span className="text-[8px] text-slate-400 font-mono truncate max-w-[240px]">
                Active Selection
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="ml-4 p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
