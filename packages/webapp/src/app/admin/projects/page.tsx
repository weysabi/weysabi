"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FolderKanban, ExternalLink } from "lucide-react";
import { useAdmin, slugFromName } from "@/lib/admin";

export default function ProjectsPage() {
  const { projects, loading, error, refreshProjects, apiFetch, connected } = useAdmin();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function openCreate() {
    setCreateName("");
    setCreateSlug("");
    setCreateError(null);
    setShowCreate(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName || !createSlug) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch("/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name: createName, slug: createSlug }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `Failed: ${res.status}`);
      }
      const project = (await res.json()) as { id: string };
      setShowCreate(false);
      setCreateName("");
      setCreateSlug("");
      await refreshProjects();
      router.push(`/admin/projects/${project.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your AI projects and their resources
          </p>
        </div>
        <button
          onClick={showCreate ? () => setShowCreate(false) : openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Project
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
              placeholder="My Project"
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
              placeholder="my-project"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary font-mono"
              required
              pattern="^[a-z0-9][a-z0-9-]*$"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
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

      {!connected && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FolderKanban className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">Connect to a server</h2>
          <p className="text-sm text-muted-foreground">
            Enter your server URL and admin API key above to manage projects.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading && projects.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      )}

      {connected && !loading && projects.length === 0 && !error && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FolderKanban className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mb-2">No projects yet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Create your first project to get started.
          </p>
        </div>
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/admin/projects/${project.id}`}
              className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm">
                    {project.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono">{project.slug}</p>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Created {new Date(project.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
