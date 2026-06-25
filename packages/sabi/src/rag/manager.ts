import { mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { RagEngine } from "./engine";
import type { RagOptions, RagSearchResult } from "./types";
import type { ProviderConfig } from "../types";

export interface CrossProjectResult extends RagSearchResult {
  project: string;
}

export interface RagManagerConfig {
  basePath?: string;
  options?: RagOptions;
  providers?: {
    embeddingProvider: ProviderConfig & { provider: string };
    fallbacks?: Record<string, ProviderConfig>;
  };
}

const DEFAULT_BASE_PATH = ".sabi/rag/projects";

export class RagManager {
  private engines = new Map<string, RagEngine>();
  private basePath: string;
  private defaultOptions: RagOptions;
  private globalEmbeddingProvider: (ProviderConfig & { provider: string }) | null = null;
  private globalFallbacks: Record<string, ProviderConfig> = {};

  constructor(config: RagManagerConfig = {}) {
    this.basePath = resolve(config.basePath ?? DEFAULT_BASE_PATH);
    this.defaultOptions = config.options ?? {};

    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }

    if (config.providers) {
      this.globalEmbeddingProvider = config.providers.embeddingProvider;
      this.globalFallbacks = config.providers.fallbacks ?? {};
    }
  }

  project(name: string, options?: RagOptions): RagEngine {
    const existing = this.engines.get(name);
    if (existing) return existing;

    const dbPath = join(this.basePath, `${name}.db`);
    const merged: RagOptions = { ...this.defaultOptions, ...options, dbPath };

    const engine = new RagEngine(merged);

    if (this.globalEmbeddingProvider) {
      engine.setProviders(this.globalEmbeddingProvider, this.globalFallbacks);
    }

    this.engines.set(name, engine);
    return engine;
  }

  has(name: string): boolean {
    return this.engines.has(name);
  }

  list(): string[] {
    return Array.from(this.engines.keys());
  }

  remove(name: string): void {
    const engine = this.engines.get(name);
    if (engine) {
      engine.close();
      this.engines.delete(name);
    }
  }

  async queryAll(question: string, topK?: number): Promise<CrossProjectResult[]> {
    if (this.engines.size === 0) return [];

    const results = await Promise.allSettled(
      Array.from(this.engines.entries()).map(async ([name, engine]) => {
        const hits = await engine.query(question, topK);
        return hits.map((h) => ({ ...h, project: name }));
      })
    );

    const merged: CrossProjectResult[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        merged.push(...r.value);
      }
    }

    merged.sort((a, b) => b.score - a.score);
    return topK ? merged.slice(0, topK) : merged;
  }

  close(): void {
    for (const engine of this.engines.values()) {
      engine.close();
    }
    this.engines.clear();
  }
}
