"use client";

import { useState, useEffect } from "react";
import { Plug, Server, Hash, ExternalLink } from "lucide-react";
import { useAdmin } from "@/lib/admin";

interface ModelEntry {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface ModelsResponse {
  object: string;
  data: ModelEntry[];
}

export default function ProvidersPage() {
  const { apiFetch, connected } = useAdmin();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/v1/models");
        if (cancelled) return;
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = (await res.json()) as ModelsResponse;
        if (!cancelled) setModels(data.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load models");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  // Group by owned_by, separating provider wildcards from aliases
  const providers = new Map<string, ModelEntry[]>();
  const aliases: ModelEntry[] = [];

  for (const entry of models) {
    if (entry.id.endsWith("/*")) {
      const existing = providers.get(entry.owned_by) ?? [];
      existing.push(entry);
      providers.set(entry.owned_by, existing);
    } else {
      aliases.push(entry);
    }
  }

  // For each provider, find aliases that resolve to it
  const providerAliases = new Map<string, ModelEntry[]>();
  for (const alias of aliases) {
    const targetProvider = alias.owned_by.split("/")[0] ?? alias.owned_by;
    const existing = providerAliases.get(targetProvider) ?? [];
    existing.push(alias);
    providerAliases.set(targetProvider, existing);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Plug className="h-6 w-6" />
          Providers
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configured AI providers and available models on this server
        </p>
      </div>

      {!connected && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Server className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">Not connected</h2>
          <p className="text-sm text-muted-foreground">
            Connect to a server and provide an admin API key to view providers.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading && connected && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      )}

      {!loading && connected && providers.size === 0 && !error && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Plug className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">No providers configured</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Configure providers in your server options to enable AI model routing.
          </p>
        </div>
      )}

      {!loading && connected && providers.size > 0 && (
        <div className="grid gap-4">
          {Array.from(providers.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, entries]) => {
              const resolvedAliases = providerAliases.get(name) ?? [];
              return (
                <div
                  key={name}
                  className="rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/20"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm uppercase">
                        {name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg capitalize">{name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {entries.length} wildcard
                          {entries.length !== 1 ? "s" : ""}
                          {resolvedAliases.length > 0 &&
                            ` · ${resolvedAliases.length} alias${resolvedAliases.length !== 1 ? "es" : ""}`}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Hash className="h-3 w-3" />
                        Model IDs
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {entries.map((entry) => (
                          <code
                            key={entry.id}
                            className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs"
                          >
                            {entry.id}
                          </code>
                        ))}
                      </div>
                    </div>

                    {resolvedAliases.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                          <ExternalLink className="h-3 w-3" />
                          Aliases
                        </p>
                        <div className="space-y-1">
                          {resolvedAliases.map((alias) => (
                            <div key={alias.id} className="flex items-center gap-2 text-xs">
                              <code className="rounded bg-muted px-2 py-0.5 font-mono">
                                {alias.id}
                              </code>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-muted-foreground font-mono">
                                {alias.owned_by}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
