"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { KeyRound, Plus, Trash2, Copy, Check, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { useAdmin, errorMessage } from "@/lib/admin";
import { buildListUrl } from "@/lib/admin-list";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  expiresAt?: number;
  revokedAt?: number;
  createdAt: number;
}

export default function ApiKeysPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { apiFetch } = useAdmin();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;
  const [search, setSearch] = useState("");
  const [fetchKey, setFetchKey] = useState(0);

  function applySearch() {
    setPage(1);
    setFetchKey((k) => k + 1);
    setLoading(true);
  }

  function openCreate() {
    setCreateName("");
    setError(null);
    setShowCreate(true);
  }

  async function loadKeys() {
    setLoading(true);
    try {
      const url = buildListUrl(`/v1/projects/${projectId}/api-keys`, page, limit, { search });
      const res = await apiFetch(url);
      if (res.ok) {
        const data = (await res.json()) as { items: ApiKey[]; total: number };
        setKeys(data.items);
        setTotal(data.total);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, apiFetch, page, fetchKey]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName) return;
    setError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ name: createName }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { key: string };
      setCreatedKey(data.key);
      setCreateName("");
      await loadKeys();
    } catch (err) {
      setError(errorMessage(err, "Failed to create API key"));
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    setError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/api-keys/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await loadKeys();
    } catch (err) {
      setError(errorMessage(err, "Failed to revoke"));
    }
  }

  async function copyKey() {
    if (createdKey) {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">API Keys</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage API keys for this project</p>
      </div>

      {createdKey && (
        <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/5 p-5">
          <p className="text-sm font-semibold text-green-700 mb-2">API Key Created</p>
          <p className="text-xs text-muted-foreground mb-3">
            Copy this key now. You won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-mono break-all">
              {createdKey}
            </code>
            <button
              onClick={copyKey}
              className="rounded-lg border border-border px-3 py-2.5 transition-all hover:bg-muted"
              title="Copy"
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setCreatedKey(null)}
              className="rounded-lg border border-border px-3 py-2.5 text-sm transition-all hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            placeholder="Search by name..."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>
        <button
          onClick={applySearch}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </button>
        <button
          onClick={showCreate ? () => setShowCreate(false) : openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New API Key
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
              placeholder="My Key"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary"
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
      ) : keys.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <KeyRound className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">No API keys</h3>
          <p className="text-sm text-muted-foreground">
            Create API keys to allow programmatic access to this project.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{key.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {key.prefix}...
                    {key.revokedAt && <span className="ml-2 text-red-500">Revoked</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {new Date(key.createdAt).toLocaleDateString()}
                </span>
                {key.expiresAt && (
                  <span className="text-xs text-muted-foreground">
                    Expires {new Date(key.expiresAt).toLocaleDateString()}
                  </span>
                )}
                {!key.revokedAt && (
                  <button
                    onClick={() => handleRevoke(key.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors"
                    title="Revoke"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Pagination page={page} totalPages={Math.ceil(total / limit)} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
