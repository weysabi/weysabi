"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart3,
  Terminal,
  Globe,
  Shield,
  RefreshCw,
  Activity,
  KeyRound,
  DollarSign,
  Plug,
} from "lucide-react";
import { LogoMark } from "@/components/logo";

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

const DEFAULTS = {
  url: (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SABI_ADMIN_URL) || "",
};

function getStored(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function setStored(key: string, value: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, value);
  }
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function AdminPage() {
  const [serverUrl, setServerUrl] = useState(() => getStored("sabi_admin_url", DEFAULTS.url));
  const [apiKey, setApiKey] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [usage, setUsage] = useState<{
    records: UsageRecord[];
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formUrl, setFormUrl] = useState(serverUrl);
  const [formKey, setFormKey] = useState("");

  const fetchData = useCallback(async () => {
    if (!serverUrl) return;
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    try {
      const [statsRes, usageRes] = await Promise.all([
        fetch(`${serverUrl}/v1/admin/stats`, { headers }).then((r) => {
          if (!r.ok) throw new Error(`Stats: ${r.status}`);
          return r.json() as Promise<Stats>;
        }),
        fetch(`${serverUrl}/v1/admin/usage`, { headers }).then((r) => {
          if (!r.ok) throw new Error(`Usage: ${r.status}`);
          return r.json() as Promise<{
            records: UsageRecord[];
            total: number;
          }>;
        }),
      ]);

      setStats(statsRes);
      setUsage(usageRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setStats(null);
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, apiKey]);

  useEffect(() => {
    if (serverUrl) fetchData();
  }, [fetchData, serverUrl]);

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const url = formUrl.replace(/\/+$/, "");
    setServerUrl(url);
    setApiKey(formKey);
    setStored("sabi_admin_url", url);
  }

  const statusColor = stats ? "text-green-500" : error ? "text-red-500" : "text-muted-foreground";
  const statusLabel = stats ? "Connected" : error ? "Error" : "Disconnected";

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

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <LogoMark className="h-8 text-primary" />
          <h1 className="text-3xl font-bold">Admin</h1>
        </div>
        {serverUrl && (
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition-all hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        )}
      </div>

      <form
        onSubmit={handleConnect}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5"
      >
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-muted-foreground mb-1.5 font-medium">
            Server URL
          </label>
          <input
            type="text"
            value={formUrl}
            onChange={(e) => setFormUrl(e.target.value)}
            placeholder="http://localhost:3000"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-muted-foreground mb-1.5 font-medium">
            Admin API Key
          </label>
          <input
            type="password"
            value={formKey}
            onChange={(e) => setFormKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-[42px] items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          Connect
        </button>
        <p className="w-full text-xs text-muted-foreground">
          The admin key stays in memory for this browser session and is not saved locally. Direct
          connection is intended for local or trusted self-hosted environments.
        </p>
      </form>

      {error && (
        <div className="mb-8 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

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
          icon={Shield}
          label="Status"
          value={statusLabel}
          valueClass={statusColor}
          delay={150}
        />
      </div>

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

      {!serverUrl && !stats && !error && (
        <section className="rounded-xl border border-border bg-card p-12 text-center">
          <Plug className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">Connect to a server</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Enter your Weysabi server URL above to view live usage data, token quotas, and request
            history.
          </p>
          <p className="text-xs text-muted-foreground">
            You can also set{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">NEXT_PUBLIC_SABI_ADMIN_URL</code> in
            your environment and rebuild.
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
