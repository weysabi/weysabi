"use client";

import { useState, useEffect, useRef } from "react";
import { Server, Shield, Activity, KeyRound, Database, Globe, RefreshCw } from "lucide-react";
import { useAdmin, errorMessage } from "@/lib/admin";

interface AdminConfig {
  providers: string[];
  modelAliases: { alias: string; model: string }[];
  rateLimitRpm: number;
  quota: { maxTokensPerMin?: number; maxTokensPerDay?: number } | null;
  controlPlane: { enabled: boolean; storage?: string };
  responseCache: boolean;
  ragEnabled: boolean;
}

export default function AdminSettingsPage() {
  const { apiFetch, connected } = useAdmin();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  async function loadConfig() {
    if (!connected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/v1/admin/config");
      if (mountedRef.current === false) return;
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as AdminConfig;
      if (mountedRef.current) setConfig(data);
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err, "Failed to load configuration"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    if (connected) loadConfig();
    return () => {
      mountedRef.current = false;
    };
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!connected) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Globe className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">Connect to a server</h2>
          <p className="text-sm text-muted-foreground">
            Enter your server URL and admin API key above to view server configuration.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !config) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-xl border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-600 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Server configuration overview</p>
        </div>
        <button
          onClick={loadConfig}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition-all hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-8 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Server */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Server className="h-4 w-4" />
            Server
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground mb-1">Rate Limit</dt>
              <dd className="font-mono text-sm font-medium">{config.rateLimitRpm} RPM</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground mb-1">Response Cache</dt>
              <dd className="text-sm font-medium">
                {config.responseCache ? (
                  <span className="text-green-600">Enabled</span>
                ) : (
                  <span className="text-muted-foreground">Disabled</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* Providers */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Providers
          </h2>
          {config.providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers configured</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {config.providers.map((provider) => (
                <span
                  key={provider}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  {provider}
                </span>
              ))}
            </div>
          )}

          {config.modelAliases.length > 0 && (
            <>
              <h3 className="text-xs font-medium text-muted-foreground mt-5 mb-3">Model Aliases</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        Alias
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        Target
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.modelAliases.map((a) => (
                      <tr key={a.alias} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{a.alias}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {a.model}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Quota */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Token Quota
          </h2>
          {config.quota ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground mb-1">Per Minute</dt>
                <dd className="font-mono text-sm font-medium">
                  {config.quota.maxTokensPerMin != null
                    ? `${config.quota.maxTokensPerMin.toLocaleString()} tokens`
                    : "Unlimited"}
                </dd>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground mb-1">Per Day</dt>
                <dd className="font-mono text-sm font-medium">
                  {config.quota.maxTokensPerDay != null
                    ? `${config.quota.maxTokensPerDay.toLocaleString()} tokens`
                    : "Unlimited"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No quota limits configured</p>
          )}
        </section>

        {/* Control Plane */}
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Database className="h-4 w-4" />
            Control Plane
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground mb-1">Status</dt>
              <dd className="text-sm font-medium">
                {config.controlPlane.enabled ? (
                  <span className="text-green-600">Enabled</span>
                ) : (
                  <span className="text-muted-foreground">Disabled</span>
                )}
              </dd>
            </div>
            {config.controlPlane.storage && (
              <div className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground mb-1">Storage</dt>
                <dd className="font-mono text-sm font-medium">{config.controlPlane.storage}</dd>
              </div>
            )}
          </dl>
          {config.ragEnabled && (
            <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
              <span className="font-medium">RAG</span>
              <span className="text-green-600 ml-2">Enabled</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
