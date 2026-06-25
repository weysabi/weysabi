export interface UsageRecord {
  keyFingerprint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  timestamp: number;
  status: "success" | "error";
}

export interface UsageLedger {
  record(entry: UsageRecord): Promise<void>;
  query(opts?: {
    keyFingerprint?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ records: UsageRecord[]; total: number }>;
  stats(keyFingerprint?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
  }>;
}

export class InMemoryUsageLedger implements UsageLedger {
  private records: UsageRecord[] = [];

  async record(entry: UsageRecord): Promise<void> {
    this.records.push(entry);
  }

  async query(opts?: {
    keyFingerprint?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ records: UsageRecord[]; total: number }> {
    let filtered = this.records;
    if (opts?.keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === opts.keyFingerprint);
    }
    const total = filtered.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const records = filtered.slice(offset, offset + limit);
    return { records, total };
  }

  async stats(keyFingerprint?: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
  }> {
    let filtered = this.records;
    if (keyFingerprint) {
      filtered = filtered.filter((r) => r.keyFingerprint === keyFingerprint);
    }
    return {
      totalRequests: filtered.length,
      totalTokens: filtered.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCostUsd: filtered.reduce((sum, r) => sum + (r.estimatedCostUsd ?? 0), 0),
    };
  }
}
