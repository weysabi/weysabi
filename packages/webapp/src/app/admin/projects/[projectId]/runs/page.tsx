"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Activity, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { useAdmin } from "@/lib/admin";
import { buildListUrl } from "@/lib/admin-list";

interface Run {
  id: string;
  conversationId?: string;
  promptId?: string;
  model: string;
  status: string;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  createdAt: number;
}

export default function RunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { apiFetch } = useAdmin();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [fetchKey, setFetchKey] = useState(0);

  function applyFilters() {
    setPage(1);
    setFetchKey((k) => k + 1);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const url = buildListUrl(`/v1/projects/${projectId}/runs`, page, limit, {
        search: filterSearch,
        status: filterStatus,
      });
      try {
        const res = await apiFetch(url);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { items: Run[]; total: number };
          setRuns(data.items);
          setTotal(data.total);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, apiFetch, page, fetchKey]);

  const statusColor = (status: string) => {
    switch (status) {
      case "success":
        return "bg-green-500/10 text-green-600";
      case "failed":
        return "bg-red-500/10 text-red-600";
      case "streaming":
      case "pending":
        return "bg-blue-500/10 text-blue-600";
      case "interrupted":
        return "bg-yellow-500/10 text-yellow-600";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Runs</h2>
        <p className="text-sm text-muted-foreground mt-1">LLM request history for this project</p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1 font-medium">Search</label>
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
            placeholder="Search by model..."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1 font-medium">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="streaming">Streaming</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="interrupted">Interrupted</option>
          </select>
        </div>
        <button
          onClick={applyFilters}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Search className="h-3.5 w-3.5" />
          Filter
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Activity className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">No runs yet</h3>
          <p className="text-sm text-muted-foreground">
            Runs appear here after LLM requests are made.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Tokens
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Latency
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wider text-muted-foreground">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => router.push(`/admin/projects/${projectId}/runs/${run.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/admin/projects/${projectId}/runs/${run.id}`);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View run ${run.id.slice(0, 8)}`}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{run.model}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(run.status)}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {run.totalTokens?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {run.latencyMs != null ? `${run.latencyMs}ms` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {run.estimatedCostUsd != null ? `$${run.estimatedCostUsd.toFixed(6)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={Math.ceil(total / limit)} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
