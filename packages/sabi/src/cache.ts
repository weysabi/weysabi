import type { CacheAdapter, CompleteResponse } from "./types";

interface CacheEntry {
  value: CompleteResponse;
  expiresAt: number;
}

export class InMemoryCache implements CacheAdapter {
  private store = new Map<string, CacheEntry>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): CompleteResponse | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: CompleteResponse, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

export class RedisCache implements CacheAdapter {
  private client: RedisLikeClient;
  private defaultTtlMs: number;

  constructor(client: RedisLikeClient, defaultTtlMs: number = 60_000) {
    this.client = client;
    this.defaultTtlMs = defaultTtlMs;
  }

  async get(key: string): Promise<CompleteResponse | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CompleteResponse;
    } catch {
      await this.client.del(key);
      return null;
    }
  }

  async set(key: string, value: CompleteResponse, ttlMs?: number): Promise<void> {
    const raw = JSON.stringify(value);
    const ttl = ttlMs ?? this.defaultTtlMs;
    await this.client.set(key, raw, { PX: ttl });
  }
}
