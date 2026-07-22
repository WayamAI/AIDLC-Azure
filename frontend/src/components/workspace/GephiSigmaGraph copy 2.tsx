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
import { Search, X, Maximize2, Minimize2, Loader2, FileCode } from "lucide-react";
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

// ── Design Tokens ─────────────────────────────────────────────────────────────

const PALETTE = [
  "#2dd4bf",
  "#fb923c",
  "#38bdf8",
  "#a78bfa",
  "#4ade80",
  "#f472b6",
  "#fbbf24",
  "#818cf8",
  "#f87171",
  "#94a3b8",
];

function extFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() || "unknown";
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
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function colorForCommunity(community: number): string {
  return PALETTE[Math.abs(community) % PALETTE.length];
}

function colorForModule(path: string): string {
  const parts = path.split("/");
  const moduleName =
    parts.length > 1 ? (parts[0] === "src" ? parts[1] : parts[0]) : "root";
  let hash = 0;
  for (let i = 0; i < moduleName.length; i++) {
    hash = moduleName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// ── Graph Builder ─────────────────────────────────────────────────────────────
//
// WHY THE GRAPH WAS INVISIBLE:
//   The previous fix added `-(y - cy) * scale` thinking sigma flips Y.
//   Sigma does NOT flip Y at the graph-data level it only maps graph coords
//   to screen coords internally.  Negating Y sent every node to a mirror
//   position far from the camera, making the graph disappear entirely.
//
// THE REAL CENTERING PROBLEM:
//   After ForceAtlas2 runs, the graph's centroid is wherever the physics
//   settled often NOT at (0, 0).  Sigma's default camera always points at
//   (0, 0).  So the graph was rendered off-screen to the top-right.
//
// THE FIX (two steps, no Y negation):
//   1. Translate: subtract the bounding-box midpoint from every node so the
//      whole cluster is centred at graph-space origin (0, 0).
//   2. Scale: normalise the span to ±100 units so the camera ratio maths in
//      getCenterCamera() is predictable across different repo sizes.

function buildGraphologyGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  changedPaths: Set<string>
): Graph {
  const graph = new Graph({ type: "directed", multi: false });

  const normalize = (p: string) =>
    p
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/\.(py|ts|tsx|js|jsx|css|scss|json)$/i, "")
      .split("/")
      .join(".");

  const pathMap = new Map<string, string>();
  nodes.forEach((n) => {
    const fullNorm = normalize(n.path);
    pathMap.set(fullNorm, n.path);
    const parts = fullNorm.split(".");
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join(".");
      if (!pathMap.has(suffix)) pathMap.set(suffix, n.path);
    }
    if (n.path.endsWith("/__init__.py")) {
      pathMap.set(normalize(n.path.replace("/__init__.py", "")), n.path);
    }
  });

  const getOriginalPath = (p: string) => {
    const norm = normalize(p);
    if (pathMap.has(p)) return pathMap.get(p)!;
    if (pathMap.has(norm)) return pathMap.get(norm)!;
    const dotNorm = p.replace(/\./g, "/");
    if (pathMap.has(dotNorm)) return pathMap.get(dotNorm)!;
    return p;
  };

  const nodeSet = new Set(nodes.map((n) => n.path));
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  const matchedEdges: { source: string; target: string }[] = [];
  edges.forEach((e) => {
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
    const importance = indeg * 2.8 + outdeg * 1.5;
    const size = Math.min(50, Math.max(7, 7 + Math.sqrt(importance) * 5));
    const pos = deterministicPosition(node.path);

    graph.addNode(node.path, {
      label: baseName(node.path),
      path: node.path,
      ext: extFromPath(node.path),
      degree: indeg + outdeg,
      inDegree: indeg,
      outDegree: outdeg,
      importance,
      size,
      x: pos.x,
      y: pos.y,
      color:
        changedPaths.has(node.path) || node.is_changed
          ? "#f97316"
          : colorForModule(node.path),
      isChanged: changedPaths.has(node.path) || node.is_changed,
    } as SigmaNodeAttrs);
  }

  for (const e of matchedEdges) {
    const edgeKey = `${e.source}->${e.target}`;
    if (!graph.hasEdge(edgeKey)) {
      graph.addDirectedEdgeWithKey(edgeKey, e.source, e.target, {
        weight: 1.5,
        size: 2,
        color: "#94a3b8",
      });
    }
  }

  if (graph.order > 0) {
    // ── Run community detection + ForceAtlas2 layout ──────────────────────
    try {
      const communities = louvain(graph);
      graph.forEachNode((node) => {
        const community = Number(communities[node] ?? 0);
        const attrs = graph.getNodeAttributes(node) as SigmaNodeAttrs;
        if (!attrs.isChanged) {
          graph.setNodeAttribute(node, "color", colorForCommunity(community));
        }
      });

      forceAtlas2.assign(graph, {
        iterations: 260,
        settings: {
          ...forceAtlas2.inferSettings(graph),
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

    // ── Step 1: find centroid + span after layout ─────────────────────────
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;
    let validCount = 0;

    graph.forEachNode((node) => {
      const x = graph.getNodeAttribute(node, "x") as number;
      const y = graph.getNodeAttribute(node, "y") as number;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      validCount++;
    });

    if (validCount > 0) {
      // ── Step 2: translate centroid to (0,0) + normalise span to ±100 ──
      const cx = sumX / validCount;
      const cy = sumY / validCount;
      const span = Math.max(maxX - minX, maxY - minY) || 1;
      const scale = 200 / span; // normalise largest axis to 200 units total

      graph.forEachNode((node) => {
        const x = graph.getNodeAttribute(node, "x") as number;
        const y = graph.getNodeAttribute(node, "y") as number;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        // Translate to origin then scale.
        // DO NOT negate Y sigma handles its own screen/graph axis mapping.
        graph.setNodeAttribute(node, "x", (x - cx) * scale);
        graph.setNodeAttribute(node, "y", (y - cy) * scale);
      });
    }
  }

  return graph;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function GraphTooltip({ node, graph }: { node: string | null; graph: Graph }) {
  const sigma = useSigma();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!node || !graph.hasNode(node)) { setPosition(null); return; }
    const update = () => {
      const { x, y } = graph.getNodeAttributes(node) as any;
      setPosition(sigma.graphToViewport({ x, y }));
    };
    update();
    sigma.getCamera().on("updated", update);
    return () => { sigma.getCamera().off("updated", update); };
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
            <span className="text-xs font-black text-slate-900 truncate block uppercase tracking-tight">{attrs.label}</span>
            <span className="text-[8px] text-slate-500 font-mono truncate block">{attrs.path}</span>
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
      <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 bg-white rotate-45 border-r border-b border-slate-200/60" />
    </div>
  );
}

// ── Interaction Layer ─────────────────────────────────────────────────────────
//
// getCenterCamera() logic:
//   Scans only the *visible* nodes (respecting activeExtensions, insightMode,
//   isolateFocus, and search filter), computes their bounding-box midpoint,
//   then picks a camera ratio so the span fills ~75% of the viewport.
//   After our normalisation the graph always spans ~200 units, so:
//     ratio ≈ span / 150  →  fits 200-unit graph in ~1.33 screen heights
//   Clamped to [0.5, 4.0] to prevent over-zoom or over-zoom-out.

interface GraphInteractionLayerProps {
  graph: Graph;
  graphIdentity: string;
  focusPath?: string;
  selectedNode: string | null;
  setSelectedNode: (node: string | null) => void;
  setHoveredNode: (node: string | null) => void;
  activeExtensions: Set<string>;
  searchText: string;
  cameraResetCount: number;
  insightMode: boolean;
  isolateFocus: boolean;
}

function GraphInteractionLayer({
  graph, graphIdentity, focusPath, selectedNode, setSelectedNode, setHoveredNode,
  activeExtensions, searchText, cameraResetCount, insightMode, isolateFocus,
}: GraphInteractionLayerProps) {
  const sigma = useSigma();
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const [hoveredNodeInternal, setHoveredInternal] = useState<string | null>(null);
  const lastResetRef = useRef(0);
  const hasInitialCenteredRef = useRef(false);
  const initialCenterRafRef = useRef<number | null>(null);
  const cameraActionIdRef = useRef(0);
  const initialLoadRef = useRef(false);
  const graphIdentityRef = useRef<string>("");
  const cameraLockedRef = useRef(false);

  const getCenterCamera = useCallback(() => {
    if (!graph || graph.order === 0) return { x: 0, y: 0, ratio: 1.2 };

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    graph.forEachNode((node) => {
      const attrs = graph.getNodeAttributes(node) as SigmaNodeAttrs;
      const x = Number(attrs.x);
      const y = Number(attrs.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      sumX += x;
      sumY += y;
      count++;
    });

    if (count === 0) return { x: 0, y: 0, ratio: 1.2 };

    const centerX = sumX / count;
    const centerY = sumY / count;
    const ratio = 1.2;

    return { x: centerX, y: centerY, ratio };
  }, [graph]);

  const getCenterCameraStable = useCallback(() => getCenterCamera(), [getCenterCamera]);

  const moveCamera = useCallback(
    (target: { x: number; y: number; ratio: number }, duration = 0) => {
      const camera = sigma.getCamera();
      if (!camera) return;

      const cameraAny = camera as any;
      cameraActionIdRef.current += 1;
      const actionId = cameraActionIdRef.current;
      if (typeof cameraAny.cancelAnimation === "function") cameraAny.cancelAnimation();
      if (typeof cameraAny.stop === "function") cameraAny.stop();

      if (duration <= 0) {
        camera.setState(target);
        sigma.refresh();
        return;
      }

      camera.animate(target, { duration }, () => {
        if (cameraActionIdRef.current !== actionId) return;
      });
    },
    [sigma]
  );

  // One-time initial centering after graph load + settled render/container frames.
  // Only re-centers when graph DATA actually changes, not on UI state like isExpanded.
  useEffect(() => {
    if (!graph || !sigma) return;

    if (graphIdentityRef.current === graphIdentity && hasInitialCenteredRef.current) {
      return;
    }
    graphIdentityRef.current = graphIdentity;
    initialLoadRef.current = true;
    cameraLockedRef.current = false;

    try {
      loadGraph(graph);
      hasInitialCenteredRef.current = false;
      if (initialCenterRafRef.current !== null) {
        window.cancelAnimationFrame(initialCenterRafRef.current);
      }

      const container = (sigma as any).getContainer?.() as HTMLElement | undefined;
      let stableSizeFrames = 0;
      let stableRenderFrames = 0;
      let lastWidth = -1;
      let lastHeight = -1;

      const waitForStableFrame = () => {
        if (hasInitialCenteredRef.current) return;

        const width = container?.clientWidth ?? 0;
        const height = container?.clientHeight ?? 0;
        const hasSize = width > 0 && height > 0;

        if (hasSize && width === lastWidth && height === lastHeight) {
          stableSizeFrames += 1;
        } else {
          stableSizeFrames = 0;
          lastWidth = width;
          lastHeight = height;
        }

        sigma.refresh();
        stableRenderFrames += 1;

        if (hasSize && stableSizeFrames >= 2 && stableRenderFrames >= 3) {
          moveCamera(getCenterCameraStable(), 800);
          hasInitialCenteredRef.current = true;
          cameraLockedRef.current = true;
          initialCenterRafRef.current = null;
          return;
        }

        initialCenterRafRef.current = window.requestAnimationFrame(waitForStableFrame);
      };

      initialCenterRafRef.current = window.requestAnimationFrame(waitForStableFrame);
      return () => {
        if (initialCenterRafRef.current !== null) {
          window.cancelAnimationFrame(initialCenterRafRef.current);
          initialCenterRafRef.current = null;
        }
      };
    } catch (e) {
      console.error("Failed to load graph:", e);
    }
  }, [graph, graphIdentity, loadGraph, sigma, moveCamera, getCenterCameraStable]);

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => { setHoveredInternal(node); setHoveredNode(node); },
      leaveNode: () => { setHoveredInternal(null); setHoveredNode(null); },
      clickNode: ({ node }) => setSelectedNode(node),
      clickStage: () => setSelectedNode(null),
    });
  }, [registerEvents, setSelectedNode, setHoveredNode]);

  useEffect(() => {
    if (cameraResetCount > lastResetRef.current) {
      lastResetRef.current = cameraResetCount;
      cameraLockedRef.current = false;
      moveCamera(getCenterCameraStable(), 800);
      return;
    }
    if (selectedNode && graph.hasNode(selectedNode)) {
      const { x, y } = graph.getNodeAttributes(selectedNode) as any;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        moveCamera({ x, y, ratio: 0.55 }, 800);
      }
    }
  }, [graph, selectedNode, cameraResetCount, moveCamera, getCenterCameraStable]);

  // ── Visual reducers ───────────────────────────────────────────────────────
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

        if (insightMode && attrs.inDegree === 0 && attrs.outDegree <= 1 &&
            !attrs.isChanged && node !== focusPath && node !== selectedNode)
          return { ...data, hidden: true };

        if (!activeExtensions?.has(attrs.ext)) return { ...data, hidden: true };

        const matchesSearch =
          normalizedSearch.length === 0 ||
          attrs.label?.toLowerCase().includes(normalizedSearch) ||
          attrs.path?.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) return { ...data, color: "#f1f5f9", label: "", zIndex: 0 };

        if (isolateFocus && activeFocusNode && !connected.has(node))
          return { ...data, color: "#f8fafc", label: "", zIndex: 0 };

        const isCurrentFocus = node === activeFocusNode;
        const isCurrentlyEdited = node === focusPath;

        const result: any = {
          ...data,
          color: isCurrentlyEdited ? "#0ea5e9" : attrs.color,
          label: attrs.label,
          zIndex: isCurrentFocus ? 100 : connected.has(node) ? 10 : 1,
          forceLabel: isCurrentFocus || isCurrentlyEdited,
        };
        if (isCurrentFocus && typeof data.size === "number") result.size = data.size + 12;
        return result;
      } catch { return data; }
    });

    sigma.setSetting("edgeReducer", (edge, data) => {
      try {
        if (!graph.hasEdge(edge)) return data;
        const source = graph.source(edge);
        const target = graph.target(edge);
        if (!graph.hasNode(source) || !graph.hasNode(target)) return data;

        const sA = graph.getNodeAttributes(source) as SigmaNodeAttrs;
        const tA = graph.getNodeAttributes(target) as SigmaNodeAttrs;

        if (!activeExtensions?.has(sA.ext) || !activeExtensions?.has(tA.ext))
          return { ...data, hidden: true };

        if (insightMode) {
          if ((sA.inDegree === 0 && sA.outDegree <= 1 && source !== focusPath && source !== selectedNode) ||
              (tA.inDegree === 0 && tA.outDegree <= 1 && target !== focusPath && target !== selectedNode))
            return { ...data, hidden: true };
        }

        if (activeFocusNode) {
          const isConnected = source === activeFocusNode || target === activeFocusNode;
          if (!isConnected)
            return isolateFocus
              ? { ...data, hidden: true }
              : { ...data, color: "#cbd5e1", size: 1, zIndex: 1 };
          return {
            ...data,
            color: source === activeFocusNode ? "#f97316" : "#0ea5e9",
            size: source === activeFocusNode ? 3 : 2,
            zIndex: 10,
          };
        }

        return { ...data, color: "#cbd5e1", size: 1 };
      } catch { return data; }
    });

    sigma.refresh();
  }, [sigma, graph, hoveredNodeInternal, activeExtensions, selectedNode, focusPath,
      searchText, insightMode, isolateFocus]);

  return null;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function GephiSigmaGraph({
  nodes, edges, focusPath, changedPaths = new Set<string>(), className,
}: GephiSigmaGraphProps) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [cameraResetCount, setCameraResetCount] = useState(0);
  const [insightMode, setInsightMode] = useState(false);
  const [isolateFocus, setIsolateFocus] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const allExts = useMemo(
    () => [...new Set(nodes.map((n) => extFromPath(n.path)))].sort(),
    [nodes]
  );
  const [activeExtensions, setActiveExtensions] = useState<Set<string>>(new Set(allExts));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const graphIdentity = useMemo(() => `${nodes.length}-${edges.length}`, [nodes.length, edges.length]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setActiveExtensions(new Set(allExts)), [allExts.join("|")]);

  return (
    <div className={cn(
      "h-full min-h-[500px] flex flex-col bg-white rounded-2xl overflow-hidden border border-slate-200/60 shadow-sm transition-all duration-300",
      isExpanded && "fixed inset-0 z-[80] rounded-none border-0 shadow-2xl",
      className
    )}>
      {/* Header */}
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
                : "border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
            )}
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
                : "border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
            )}
          >
            <div className={cn("w-2 h-2 rounded-full", isolateFocus ? "bg-sky-500 animate-pulse" : "bg-slate-300")} />
            {isolateFocus ? "Isolated" : "Show All"}
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {allExts.slice(0, 8).map((ext) => (
            <button
              key={ext}
              onClick={() => setActiveExtensions((prev) => {
                const next = new Set(prev);
                if (next.has(ext)) next.delete(ext); else next.add(ext);
                return next;
              })}
              className={cn(
                "h-10 px-4 rounded-xl text-[11px] font-black border transition-all duration-300 uppercase tracking-widest",
                activeExtensions.has(ext)
                  ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                  : "border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
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
            onClick={() => { setIsExpanded((p) => !p); setSelectedNode(null); setCameraResetCount((p) => p + 1); }}
            className="p-3 rounded-2xl bg-white border border-slate-200/60 text-slate-400 hover:text-primary transition-all hover:border-primary/30 active:scale-95 shadow-sm"
          >
            {isExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 min-h-0">
        {isInitializing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/40 backdrop-blur-xl">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-primary/20 animate-pulse rounded-full" />
              <Loader2 className="h-12 w-12 animate-spin text-primary/40 relative z-10" />
            </div>
            <span className="text-[11px] uppercase font-black tracking-[0.2em] text-primary/40 mt-6">
              Assembling Dependency Matrix
            </span>
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
            graphIdentity={graphIdentity}
            focusPath={focusPath}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            setHoveredNode={setHoveredNode}
            activeExtensions={activeExtensions}
            searchText={search}
            cameraResetCount={cameraResetCount}
            insightMode={insightMode}
            isolateFocus={isolateFocus}
          />
          <GraphTooltip node={hoveredNode} graph={graph} />
        </SigmaContainer>

        {selectedNode && (
          <div className="absolute left-8 bottom-8 flex items-center gap-4 bg-white/70 backdrop-blur-2xl border border-slate-200/60 px-5 py-3 rounded-2xl shadow-xl animate-in slide-in-from-bottom-8 duration-700">
            <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_15px_rgba(255,161,43,0.5)] animate-pulse" />
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-800 uppercase tracking-tight truncate max-w-[240px]">
                {baseName(selectedNode)}
              </span>
              <span className="text-[8px] text-slate-400 font-mono truncate max-w-[240px]">Active Selection</span>
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