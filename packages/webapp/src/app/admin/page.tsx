"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart3,
  Terminal,
  Globe,
  DollarSign,
  RefreshCw,
  Activity,
  KeyRound,
  Plug,
  TrendingUp,
} from "lucide-react";
import { useAdmin, errorMessage } from "@/lib/admin";

interface Stats {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  activeKeys: number;
}

interface UsageRecord {
  keyFingerprint: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  timestamp: number;
  status: string;
}

interface DailyUsage {
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

type RangePreset = "24h" | "7d" | "30d" | "90d";

const RANGE_LABELS: Record<RangePreset, string> = {
  "24h": "24H",
  "7d": "7 Days",
  "30d": "30 Days",
  "90d": "90 Days",
};

const RANGE_MS: Record<RangePreset, number> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "90d": 7_776_000_000,
};

function fmt(n: number): string {
  return n.toLocaleString();
}

function rangeParams(range: RangePreset): { from: number; to: number } {
  return { from: Date.now() - RANGE_MS[range], to: Date.now() };
}

export default function AdminDashboard() {
  const { apiFetch, connected } = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [usage, setUsage] = useState<{
    records: UsageRecord[];
    total: number;
  } | null>(null);
  const [trend, setTrend] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangePreset>("7d");
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError(null);

    const { from, to } = rangeParams(range);
    const qs = `?from=${from}&to=${to}`;

    try {
      const [statsRes, usageRes, trendRes] = await Promise.all([
        apiFetch(`/v1/admin/stats${qs}`).then((r) => {
          if (!r.ok) throw new Error(`Stats: ${r.status}`);
          return r.json() as Promise<Stats>;
        }),
        apiFetch(`/v1/admin/usage${qs}`).then((r) => {
          if (!r.ok) throw new Error(`Usage: ${r.status}`);
          return r.json() as Promise<{ records: UsageRecord[]; total: number }>;
        }),
        apiFetch(`/v1/admin/usage/trend${qs}`).then((r) => {
          if (!r.ok) return [] as DailyUsage[];
          return r.json() as Promise<DailyUsage[]>;
        }),
      ]);

      if (!mountedRef.current) return;
      setStats(statsRes);
      setUsage(usageRes);
      setTrend(trendRes);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(errorMessage(err, "Connection failed"));
      setStats(null);
      setUsage(null);
      setTrend([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiFetch, connected, range]);

  useEffect(() => {
    mountedRef.current = true;
    if (connected) fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, connected]);

  const keyBarData = useMemo(() => {
    if (!usage) return [];
    const map = new Map<string, number>();
    for (const r of usage.records) {
      map.set(r.keyFingerprint, (map.get(r.keyFingerprint) ?? 0) + r.totalTokens);
    }
    const max = Math.max(...map.values(), 1);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, tokens]) => ({
        key,
        tokens,
        pct: (tokens / max) * 100,
      }));
  }, [usage]);

  const maxTrendTokens = useMemo(() => Math.max(...trend.map((d) => d.tokens), 1), [trend]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Server-wide usage overview</p>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              {(Object.keys(RANGE_LABELS) as RangePreset[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setRange(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    range === key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {RANGE_LABELS[key]}
                </button>
              ))}
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition-all hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-8 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 flex items-center gap-2">
          <span className="text-red-600 font-bold shrink-0">!</span>
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-10">
        <StatCard
          icon={BarChart3}
          label="Total Requests"
          value={stats ? fmt(stats.totalRequests) : "—"}
          delay={0}
        />
        <StatCard
          icon={Terminal}
          label="Tokens Used"
          value={stats ? fmt(stats.totalTokens) : "—"}
          delay={50}
        />
        <StatCard
          icon={Globe}
          label="Active Keys"
          value={stats ? fmt(stats.activeKeys) : "—"}
          delay={100}
        />
        <StatCard
          icon={DollarSign}
          label="Total Cost"
          value={stats ? `$${stats.totalCostUsd.toFixed(4)}` : "—"}
          delay={150}
        />
      </div>

      {/* Daily Trend Chart */}
      {trend.length > 0 && (
        <section className="mb-10 rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Daily Token Usage
          </h3>
          <div className="flex items-end gap-1.5 h-32">
            {trend.map((d) => (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center justify-end h-full"
                title={`${d.date}: ${fmt(d.tokens)} tokens (${fmt(d.requests)} requests)`}
              >
                <div
                  className="w-full rounded-t-sm bg-primary/20 hover:bg-primary/30 transition-colors min-h-[4px]"
                  style={{ height: `${(d.tokens / maxTrendTokens) * 100}%` }}
                />
                {trend.length <= 14 && (
                  <span className="text-[10px] text-muted-foreground mt-1 truncate w-full text-center">
                    {d.date.slice(5)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Keys */}
      {keyBarData.length > 0 && (
        <section className="mb-10 rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Top Keys by Token Usage
          </h3>
          <div className="space-y-3">
            {keyBarData.map((d) => (
              <div key={d.key} className="flex items-center gap-3">
                <span className="w-20 truncate font-mono text-xs text-muted-foreground shrink-0">
                  {d.key}
                </span>
                <div className="flex-1 h-5 rounded-md bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-md bg-primary/20 transition-all duration-500"
                    style={{ width: `${d.pct}%` }}
                  />
                </div>
                <span className="w-24 text-right text-xs font-mono text-muted-foreground shrink-0">
                  {fmt(d.tokens)} tokens
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Usage Table */}
      {usage && usage.records.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Usage
            <span className="text-sm font-normal text-muted-foreground">
              ({fmt(usage.total)} total)
            </span>
          </h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3.5 text-left font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Key
                  </th>
                  <th className="px-4 py-3.5 text-left font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Model
                  </th>
                  <th className="px-4 py-3.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Tokens
                  </th>
                  <th className="px-4 py-3.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Cost
                  </th>
                  <th className="px-4 py-3.5 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Time
                  </th>
                  <th className="px-4 py-3.5 text-center font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.records.map((record, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                      {record.keyFingerprint}
                    </td>
                    <td className="px-4 py-3.5">{record.model}</td>
                    <td className="px-4 py-3.5 text-right font-mono text-sm">
                      {fmt(record.totalTokens)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-sm">
                      {record.estimatedCostUsd != null
                        ? `$${record.estimatedCostUsd.toFixed(6)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-muted-foreground text-xs">
                      {new Date(record.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          record.status === "success"
                            ? "bg-green-500/10 text-green-600"
                            : "bg-red-500/10 text-red-600"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            record.status === "success" ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        {record.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Not Connected */}
      {!connected && !stats && !error && (
        <section className="rounded-xl border border-border bg-card p-12 text-center">
          <Plug className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">Connect to a server</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Enter your Weysabi server URL and admin API key in the bar above to view live usage
            data, token quotas, and request history.
          </p>
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  valueClass,
  delay,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  valueClass?: string;
  delay?: number;
}) {
  return (
    <div
      className="animate-fade-in rounded-xl border border-border bg-card p-5"
      style={{ animationDelay: `${delay ?? 0}ms` }}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <p className={`text-3xl font-bold tracking-tight ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}
