"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MessageSquare, ExternalLink, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { useAdmin } from "@/lib/admin";
import { buildListUrl } from "@/lib/admin-list";

interface Conversation {
  id: string;
  title?: string;
  externalUserId?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export default function ConversationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { apiFetch } = useAdmin();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const url = buildListUrl(`/v1/projects/${projectId}/conversations`, page, limit, {
      search: filterSearch,
      status: filterStatus,
      externalUserId: filterUserId,
    });
    async function load() {
      try {
        const res = await apiFetch(url);
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { items: Conversation[]; total: number };
          setConversations(data.items);
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

  function applyFilters() {
    setPage(1);
    setFetchKey((k) => k + 1);
    setLoading(true);
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Conversations</h2>
        <p className="text-sm text-muted-foreground mt-1">Browse and manage conversation history</p>
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
            placeholder="Search by title..."
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
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1 font-medium">User ID</label>
          <input
            type="text"
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            placeholder="Filter by user..."
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary w-40"
          />
        </div>
        <button
          onClick={applyFilters}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <MessageSquare className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">No conversations yet</h3>
          <p className="text-sm text-muted-foreground">
            Conversations appear here after users interact with your project.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/admin/projects/${projectId}/conversations/${conv.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-bold shrink-0">
                  {conv.title ? conv.title.charAt(0).toUpperCase() : "?"}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {conv.title || `Conversation ${conv.id.slice(0, 8)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(conv.createdAt).toLocaleString()}
                    {conv.externalUserId && ` — ${conv.externalUserId}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    conv.status === "active"
                      ? "bg-green-500/10 text-green-600"
                      : conv.status === "archived"
                        ? "bg-yellow-500/10 text-yellow-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {conv.status}
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </Link>
          ))}
          <Pagination page={page} totalPages={Math.ceil(total / limit)} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
