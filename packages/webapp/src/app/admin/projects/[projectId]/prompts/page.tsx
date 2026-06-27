"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MessageSquare, Plus, ExternalLink, Eye } from "lucide-react";
import { useAdmin, slugFromName } from "@/lib/admin";

interface Prompt {
  id: string;
  name: string;
  slug: string;
  description?: string;
  publishedVersionId?: string;
  createdAt: number;
}

export default function PromptsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { apiFetch } = useAdmin();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  function openCreate() {
    setCreateName("");
    setCreateSlug("");
    setCreateError(null);
    setShowCreate(true);
  }

  async function loadPrompts() {
    setLoading(true);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/prompts`);
      if (res.ok) {
        const data = (await res.json()) as { items: Prompt[] };
        setPrompts(data.items);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrompts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, apiFetch]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName || !createSlug) return;
    setCreateError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/prompts`, {
        method: "POST",
        body: JSON.stringify({ name: createName, slug: createSlug }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setShowCreate(false);
      setCreateName("");
      setCreateSlug("");
      await loadPrompts();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create prompt");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Prompts</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage prompt templates and versions</p>
        </div>
        <button
          onClick={showCreate ? () => setShowCreate(false) : openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Prompt
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-xl border border-border bg-card p-5 space-y-4"
        >
          {createError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600">
              {createError}
            </div>
          )}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Name</label>
            <input
              type="text"
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                setCreateSlug(slugFromName(e.target.value));
              }}
              placeholder="My Prompt"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">Slug</label>
            <input
              type="text"
              value={createSlug}
              onChange={(e) => setCreateSlug(e.target.value)}
              placeholder="my-prompt"
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
      ) : prompts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <MessageSquare className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">No prompts yet</h3>
          <p className="text-sm text-muted-foreground">Create your first prompt template.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {prompts.map((prompt) => (
            <Link
              key={prompt.id}
              href={`/admin/projects/${projectId}/prompts/${prompt.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-bold">
                  {prompt.name.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-sm">{prompt.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{prompt.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {prompt.publishedVersionId ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <Eye className="h-3 w-3" />
                    Published
                  </span>
                ) : (
                  <span>No published version</span>
                )}
                <ExternalLink className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
