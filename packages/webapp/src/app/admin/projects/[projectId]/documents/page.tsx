"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { FileText, Plus, Trash2, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { useAdmin, errorMessage } from "@/lib/admin";
import { buildListUrl } from "@/lib/admin-list";

interface Document {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  createdAt: number;
}

export default function DocumentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { apiFetch } = useAdmin();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSourceType, setFilterSourceType] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [fetchKey, setFetchKey] = useState(0);

  function applyFilters() {
    setPage(1);
    setFetchKey((k) => k + 1);
    setLoading(true);
  }

  function openCreate() {
    setCreateName("");
    setCreateContent("");
    setError(null);
    setShowCreate(true);
  }

  async function loadDocuments() {
    setLoading(true);
    try {
      const url = buildListUrl(`/v1/projects/${projectId}/documents`, page, limit, {
        search: filterSearch,
        status: filterStatus,
        sourceType: filterSourceType,
      });
      const res = await apiFetch(url);
      if (res.ok) {
        const data = (await res.json()) as { items: Document[]; total: number };
        setDocuments(data.items);
        setTotal(data.total);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, apiFetch, page, fetchKey]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName || !createContent) return;
    setError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/documents`, {
        method: "POST",
        body: JSON.stringify({ name: createName, content: createContent }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setShowCreate(false);
      setCreateName("");
      setCreateContent("");
      await loadDocuments();
    } catch (err) {
      setError(errorMessage(err, "Failed to create document"));
    }
  }

  async function handleDelete(documentId: string) {
    if (!confirm("Delete this document?")) return;
    setError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/documents/${documentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await loadDocuments();
    } catch (err) {
      setError(errorMessage(err, "Failed to delete"));
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "ready":
        return "bg-green-500/10 text-green-600";
      case "indexing":
        return "bg-blue-500/10 text-blue-600";
      case "failed":
        return "bg-red-500/10 text-red-600";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Documents</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage RAG documents for this project
          </p>
        </div>
        <button
          onClick={showCreate ? () => setShowCreate(false) : openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Document
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

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
            placeholder="Search by name..."
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
            <option value="indexing">Indexing</option>
            <option value="ready">Ready</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1 font-medium">Source</label>
          <select
            value={filterSourceType}
            onChange={(e) => setFilterSourceType(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          >
            <option value="">All</option>
            <option value="text">Text</option>
            <option value="file">File</option>
            <option value="url">URL</option>
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

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-xl border border-border bg-card p-5 space-y-4"
        >
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Name</label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="my-knowledge-base"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">
              Content
            </label>
            <textarea
              value={createContent}
              onChange={(e) => setCreateContent(e.target.value)}
              placeholder="Document content for RAG..."
              rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary font-mono"
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-all hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FileText className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">No documents</h3>
          <p className="text-sm text-muted-foreground">
            Add documents to enable RAG for this project.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.sourceType} — {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(doc.status)}`}
                >
                  {doc.status}
                </span>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <Pagination page={page} totalPages={Math.ceil(total / limit)} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
