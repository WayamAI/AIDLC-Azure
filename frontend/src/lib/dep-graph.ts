/**
 * Shared dependency-graph helpers for the workspace / code-impact views.
 *
 * Edge endpoints are node ids produced by the backend graph builder, so all
 * matching here is exact — a path that is not in the node set is dropped rather
 * than fuzzily remapped.
 */
import type { GraphEdge, GraphNode } from "@/lib/api";

export interface Adjacency {
  /** file -> files that import it */
  parents: Map<string, string[]>;
  /** file -> files it imports */
  children: Map<string, string[]>;
  nodeSet: Set<string>;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const arr = map.get(key);
  if (!arr) {
    map.set(key, [value]);
  } else if (!arr.includes(value)) {
    arr.push(value);
  }
}

export function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Adjacency {
  const nodeSet = new Set(nodes.map((n) => n.path));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) continue;
    push(parents, edge.target, edge.source);
    push(children, edge.source, edge.target);
  }

  return { parents, children, nodeSet };
}

/**
 * Longest simple path leading away from `start` along `adj`.
 *
 * Memoised and cycle-safe. The naive version — recursing with a fresh visited
 * Set per branch — enumerates every simple path and locks up the browser on a
 * real repo graph, where a single utility module can have a hundred importers.
 */
export function longestPath(
  start: string,
  adj: Map<string, string[]>,
  memo: Map<string, string[]> = new Map(),
  stack: Set<string> = new Set(),
): string[] {
  const cached = memo.get(start);
  if (cached) return cached;
  if (stack.has(start)) return [start];

  stack.add(start);
  let best: string[] = [start];
  for (const next of [...(adj.get(start) ?? [])].sort()) {
    const candidate = longestPath(next, adj, memo, stack);
    if (candidate.length + 1 > best.length) best = [start, ...candidate];
  }
  stack.delete(start);
  memo.set(start, best);
  return best;
}

/** Root -> ... -> focusPath -> ... -> leaf, following import direction. */
export function deriveRootToLeafChain(
  focusPath: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): string[] {
  if (!focusPath || nodes.length === 0) return [];

  const { parents, children, nodeSet } = buildAdjacency(nodes, edges);
  if (!nodeSet.has(focusPath)) return [];

  const upstream = longestPath(focusPath, parents).slice().reverse();
  const downstream = longestPath(focusPath, children);
  return [...upstream.slice(0, -1), ...downstream];
}
