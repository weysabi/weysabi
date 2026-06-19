import { readFileSync, writeFileSync } from "fs";
import { cosineSimilarity } from "./store";

export type DistanceFn = (a: Float32Array, b: Float32Array) => number;

export interface VectorIndexConfig {
  M?: number;
  Mmax?: number;
  Mmax0?: number;
  efConstruction?: number;
  efSearch?: number;
  distance?: DistanceFn;
  numDimensions?: number;
}

interface HnswNode {
  id: string;
  vector: Float32Array;
  neighbors: string[][];
  level: number;
}

export class HnswVectorIndex {
  private nodes = new Map<string, HnswNode>();
  private entryPoint: string | null = null;
  private maxLevel = -1;
  private mL: number;
  private M: number;
  private Mmax: number;
  private Mmax0: number;
  private efConstruction: number;
  efSearch: number;
  private distance: DistanceFn;
  private numDimensions: number;

  constructor(config: VectorIndexConfig = {}) {
    this.M = config.M ?? 16;
    this.Mmax = config.Mmax ?? this.M;
    this.Mmax0 = config.Mmax0 ?? this.M * 2;
    this.efConstruction = config.efConstruction ?? 200;
    this.efSearch = config.efSearch ?? 50;
    this.distance = config.distance ?? ((a, b) => 1 - cosineSimilarity(a, b));
    this.numDimensions = config.numDimensions ?? 1536;
    this.mL = 1 / Math.log(this.M);
  }

  private randomLevel(): number {
    return Math.floor(-Math.log(Math.random()) * this.mL);
  }

  add(id: string, vector: Float32Array): void {
    const level = this.randomLevel();
    const node: HnswNode = { id, vector, neighbors: [], level };
    for (let l = 0; l <= level; l++) node.neighbors[l] = [];

    if (this.entryPoint === null) {
      this.entryPoint = id;
      this.maxLevel = level;
      this.nodes.set(id, node);
      return;
    }

    let ep = this.entryPoint;
    const topLevel = this.maxLevel;

    for (let l = topLevel; l > level; l--) {
      ep = this.greedySearch(node.vector, ep, l);
    }

    for (let l = Math.min(level, topLevel); l >= 0; l--) {
      const candidates = this.searchLayer(node.vector, ep, this.efConstruction, l);
      const neighbors = this.selectNeighbors(node.vector, candidates, l === 0 ? this.Mmax0 : this.M);

      for (const nId of neighbors) {
        node.neighbors[l]!.push(nId);
        const nNode = this.nodes.get(nId)!;
        nNode.neighbors[l] = nNode.neighbors[l] ?? [];
        nNode.neighbors[l]!.push(id);

        const maxConn = l === 0 ? this.Mmax0 : this.Mmax;
        if (nNode.neighbors[l]!.length > maxConn) {
          this.shrinkConnections(nNode, l, maxConn);
        }
      }

      ep = neighbors[0] ?? ep;
    }

    if (level > this.maxLevel) {
      this.entryPoint = id;
      this.maxLevel = level;
    }

    this.nodes.set(id, node);
  }

  search(query: Float32Array, k: number): Array<{ id: string; score: number }> {
    if (this.entryPoint === null || this.nodes.size === 0) return [];

    let ep = this.entryPoint;
    for (let l = this.maxLevel; l > 0; l--) {
      ep = this.greedySearch(query, ep, l);
    }

    const candidates = this.searchLayer(query, ep, Math.max(k, this.efSearch), 0);

    const results: Array<{ id: string; score: number }> = [];
    for (const { id, dist } of candidates) {
      results.push({ id, score: 1 - dist });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    for (let l = 0; l <= node.level; l++) {
      for (const nId of node.neighbors[l] ?? []) {
        const nNode = this.nodes.get(nId);
        if (nNode) {
          nNode.neighbors[l] = nNode.neighbors[l]?.filter((x) => x !== id) ?? [];
        }
      }
    }

    this.nodes.delete(id);

    if (this.entryPoint === id) {
      this.entryPoint = this.nodes.size > 0 ? this.nodes.keys().next().value! : null;
      this.maxLevel = this.entryPoint ? Math.max(...Array.from(this.nodes.values()).map((n) => n.level)) : -1;
    }
  }

  size(): number {
    return this.nodes.size;
  }

  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = -1;
  }

  private greedySearch(query: Float32Array, entryId: string, layer: number): string {
    let current = entryId;
    let bestDist = this.distance(query, this.nodes.get(current)!.vector);

    while (true) {
      let improved = false;
      const node = this.nodes.get(current)!;
      for (const nId of node.neighbors[layer] ?? []) {
        const nNode = this.nodes.get(nId);
        if (!nNode) continue;
        const d = this.distance(query, nNode.vector);
        if (d < bestDist) {
          bestDist = d;
          current = nId;
          improved = true;
        }
      }
      if (!improved) break;
    }

    return current;
  }

  private searchLayer(
    query: Float32Array,
    entryId: string,
    ef: number,
    layer: number
  ): Array<{ id: string; dist: number }> {
    const visited = new Set<string>([entryId]);
    const entryDist = this.distance(query, this.nodes.get(entryId)!.vector);

    const candidates = new BinaryHeap<{ id: string; dist: number }>((a, b) => a.dist < b.dist);
    const results = new BinaryHeap<{ id: string; dist: number }>((a, b) => a.dist > b.dist);

    candidates.push({ id: entryId, dist: entryDist });
    results.push({ id: entryId, dist: entryDist });

    while (candidates.size() > 0) {
      const closest = candidates.pop()!;
      const furthest = results.peek()!;

      if (closest.dist > furthest.dist) break;

      const node = this.nodes.get(closest.id)!;
      for (const nId of node.neighbors[layer] ?? []) {
        if (visited.has(nId)) continue;
        visited.add(nId);

        const nNode = this.nodes.get(nId);
        if (!nNode) continue;

        const d = this.distance(query, nNode.vector);
        const furthestResult = results.peek()!;

        if (d < furthestResult.dist || results.size() < ef) {
          candidates.push({ id: nId, dist: d });
          results.push({ id: nId, dist: d });

          if (results.size() > ef) {
            results.pop();
          }
        }
      }
    }

    return results.toArray();
  }

  private selectNeighbors(
    query: Float32Array,
    candidates: Array<{ id: string; dist: number }>,
    M: number
  ): string[] {
    return candidates.slice(0, M).map((c) => c.id);
  }

  private shrinkConnections(node: HnswNode, layer: number, maxConn: number): void {
    const neighbors = node.neighbors[layer] ?? [];
    if (neighbors.length <= maxConn) return;

    const scored = neighbors.map((nId) => {
      const nNode = this.nodes.get(nId);
      return { id: nId, dist: nNode ? this.distance(node.vector, nNode.vector) : Infinity };
    });
    scored.sort((a, b) => a.dist - b.dist);
    node.neighbors[layer] = scored.slice(0, maxConn).map((s) => s.id);
  }

  save(path: string, meta: Record<string, unknown> = {}): void {
    const graph: SavedIndex["graph"] = [];
    for (const [id, node] of this.nodes) {
      graph.push({
        id,
        level: node.level,
        neighbors: node.neighbors.map((layer) => [...layer]),
      });
    }

    const saved: SavedIndex = {
      version: 1,
      meta,
      entryPoint: this.entryPoint,
      maxLevel: this.maxLevel,
      config: {
        M: this.M,
        Mmax: this.Mmax,
        Mmax0: this.Mmax0,
        efConstruction: this.efConstruction,
        efSearch: this.efSearch,
        numDimensions: this.numDimensions,
        mL: this.mL,
      },
      graph,
    };

    writeFileSync(path, JSON.stringify(saved), "utf-8");
  }

  load(path: string): SavedIndex {
    const raw = readFileSync(path, "utf-8");
    const saved = JSON.parse(raw) as SavedIndex;

    this.clear();
    this.M = saved.config.M;
    this.Mmax = saved.config.Mmax;
    this.Mmax0 = saved.config.Mmax0;
    this.efConstruction = saved.config.efConstruction;
    this.efSearch = saved.config.efSearch;
    this.numDimensions = saved.config.numDimensions;
    this.mL = saved.config.mL;
    this.entryPoint = saved.entryPoint;
    this.maxLevel = saved.maxLevel;

    for (const g of saved.graph) {
      this.nodes.set(g.id, {
        id: g.id,
        vector: new Float32Array(this.numDimensions),
        neighbors: g.neighbors.map((layer) => [...layer]),
        level: g.level,
      });
    }

    return saved;
  }

  getNodeVector(id: string): Float32Array | undefined {
    return this.nodes.get(id)?.vector;
  }

  getNodeNeighbors(id: string): string[][] | undefined {
    return this.nodes.get(id)?.neighbors;
  }

  getNodeLevel(id: string): number | undefined {
    return this.nodes.get(id)?.level;
  }

  getDistance(a: Float32Array, b: Float32Array): number {
    return this.distance(a, b);
  }
}

export interface VectorIndexSnapshot {
  entryPoint: string | null;
  maxLevel: number;
  M: number;
  Mmax: number;
  Mmax0: number;
  efConstruction: number;
  efSearch: number;
  numDimensions: number;
  nodeCount: number;
  meta?: Record<string, unknown>;
}

export interface SavedIndex {
  version: number;
  meta: Record<string, unknown>;
  entryPoint: string | null;
  maxLevel: number;
  config: {
    M: number;
    Mmax: number;
    Mmax0: number;
    efConstruction: number;
    efSearch: number;
    numDimensions: number;
    mL: number;
  };
  graph: Array<{
    id: string;
    level: number;
    neighbors: string[][];
  }>;
}

class BinaryHeap<T> {
  private items: T[] = [];
  private compare: (a: T, b: T) => boolean;

  constructor(compare: (a: T, b: T) => boolean) {
    this.compare = compare;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const bottom = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }

  toArray(): T[] {
    return [...this.items].sort((a, b) => {
      if (this.compare(a, b)) return -1;
      if (this.compare(b, a)) return 1;
      return 0;
    });
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.compare(this.items[idx]!, this.items[parent]!)) {
        [this.items[idx], this.items[parent]] = [this.items[parent]!, this.items[idx]!];
        idx = parent;
      } else break;
    }
  }

  private sinkDown(idx: number): void {
    const length = this.items.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < length && this.compare(this.items[left]!, this.items[smallest]!)) smallest = left;
      if (right < length && this.compare(this.items[right]!, this.items[smallest]!)) smallest = right;
      if (smallest !== idx) {
        [this.items[idx], this.items[smallest]] = [this.items[smallest]!, this.items[idx]!];
        idx = smallest;
      } else break;
    }
  }
}
