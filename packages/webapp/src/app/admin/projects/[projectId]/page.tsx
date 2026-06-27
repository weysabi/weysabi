"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Settings, Save } from "lucide-react";
import { useAdmin } from "@/lib/admin";

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { apiFetch } = useAdmin();
  const [project, setProject] = useState<{
    name: string;
    slug: string;
    settings: { retentionDays?: number; defaultModel?: string };
    createdAt: number;
  } | null>(null);

  const [retentionDays, setRetentionDays] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/v1/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p) {
          const proj = p as {
            name: string;
            slug: string;
            settings: { retentionDays?: number; defaultModel?: string };
            createdAt: number;
          };
          setProject(proj);
          setRetentionDays(String(proj.settings?.retentionDays ?? ""));
          setDefaultModel(proj.settings?.defaultModel ?? "");
        } else {
          setFetchError(true);
        }
      })
      .catch(() => setFetchError(true));
  }, [projectId, apiFetch]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            retentionDays: retentionDays ? Number(retentionDays) : undefined,
            defaultModel: defaultModel || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (fetchError) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-600">
        Failed to load project. Check your connection.
      </div>
    );
  }

  if (!project) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-32 rounded-xl border border-border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Project Settings
        </h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-border">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{project.name}</dd>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono text-xs">{project.slug}</dd>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <dt className="text-muted-foreground">Project ID</dt>
            <dd className="font-mono text-xs">{projectId}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{new Date(project.createdAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {saveError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-600">
          {saveError}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold mb-4">Configuration</h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">
              Default Model
            </label>
            <input
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="e.g. groq/llama-4-scout"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5 font-medium">
              Retention Days
            </label>
            <input
              type="number"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              placeholder="30"
              min={1}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Conversations and runs older than this will be cleaned up automatically.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
