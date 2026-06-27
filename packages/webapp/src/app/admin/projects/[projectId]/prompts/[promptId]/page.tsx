"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { MessageSquare, Plus, Eye, RotateCcw, CheckCircle2 } from "lucide-react";
import { useAdmin } from "@/lib/admin";

interface Prompt {
  id: string;
  name: string;
  slug: string;
  description?: string;
  publishedVersionId?: string;
  createdAt: number;
  updatedAt: number;
}

interface PromptVersion {
  id: string;
  version: number;
  messages: { role: string; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  status: string;
  createdAt: number;
  publishedAt?: number;
}

export default function PromptDetailPage() {
  const { projectId, promptId } = useParams<{ projectId: string; promptId: string }>();
  const { apiFetch } = useAdmin();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newMessages, setNewMessages] = useState([{ role: "system", content: "" }]);
  const [error, setError] = useState<string | null>(null);

  function openNewVersion() {
    setNewMessages([{ role: "system", content: "" }]);
    setError(null);
    setShowNewVersion(true);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [promptRes, versionsRes] = await Promise.all([
        apiFetch(`/v1/projects/${projectId}/prompts/${promptId}`),
        apiFetch(`/v1/projects/${projectId}/prompts/${promptId}/versions`),
      ]);
      if (promptRes.ok) setPrompt((await promptRes.json()) as Prompt);
      if (versionsRes.ok) {
        const data = (await versionsRes.json()) as { items: PromptVersion[] };
        setVersions(data.items);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, promptId, apiFetch]);

  async function handleCreateVersion() {
    const validMessages = newMessages.filter((m) => m.content.trim());
    if (validMessages.length === 0) return;
    setError(null);
    try {
      const res = await apiFetch(`/v1/projects/${projectId}/prompts/${promptId}/versions`, {
        method: "POST",
        body: JSON.stringify({ messages: validMessages }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setShowNewVersion(false);
      setNewMessages([{ role: "system", content: "" }]);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create version");
    }
  }

  async function handlePublish(versionId: string) {
    setError(null);
    try {
      const res = await apiFetch(
        `/v1/projects/${projectId}/prompts/${promptId}/versions/${versionId}/publish`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-40 rounded-xl border border-border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {prompt && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {prompt.name}
              </h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{prompt.slug}</p>
            </div>
            {prompt.publishedVersionId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                Published
              </span>
            )}
          </div>
          {prompt.description && (
            <p className="text-sm text-muted-foreground mb-4">{prompt.description}</p>
          )}
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600">
              {error}
            </div>
          )}
          <button
            onClick={showNewVersion ? () => setShowNewVersion(false) : openNewVersion}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Version
          </button>
        </div>
      )}

      {showNewVersion && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h4 className="text-sm font-semibold">New Version — Messages</h4>
          {newMessages.map((msg, i) => (
            <div key={i} className="space-y-2">
              <select
                value={msg.role}
                onChange={(e) => {
                  const copy = [...newMessages];
                  copy[i] = { ...copy[i], role: e.target.value };
                  setNewMessages(copy);
                }}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none"
              >
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </select>
              <textarea
                value={msg.content}
                onChange={(e) => {
                  const copy = [...newMessages];
                  copy[i] = { ...copy[i], content: e.target.value };
                  setNewMessages(copy);
                }}
                placeholder="Message content..."
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary font-mono"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              onClick={() => setNewMessages([...newMessages, { role: "user", content: "" }])}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              + Add message
            </button>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleCreateVersion}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
            >
              Save Version
            </button>
            <button
              onClick={() => setShowNewVersion(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-all hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-4">Version History ({versions.length})</h4>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet.</p>
        ) : (
          <div className="space-y-3">
            {versions.map((version) => (
              <div
                key={version.id}
                className={`rounded-xl border p-5 transition-all ${
                  version.status === "published"
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="font-mono text-sm font-bold">v{version.version}</span>
                    <span className="ml-3 text-xs text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString()}
                    </span>
                    {version.status === "published" && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
                        <Eye className="h-3 w-3" />
                        Published
                      </span>
                    )}
                  </div>
                  {version.status !== "published" && (
                    <button
                      onClick={() => handlePublish(version.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs transition-all hover:bg-muted"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Publish
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {version.messages.map((msg, i) => (
                    <div key={i} className="flex gap-2 text-sm">
                      <span className="shrink-0 w-16 text-xs font-medium text-muted-foreground uppercase">
                        {msg.role}
                      </span>
                      <span className="text-foreground whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {msg.content}
                      </span>
                    </div>
                  ))}
                </div>
                {(version.model || version.temperature) && (
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    {version.model && (
                      <span>
                        Model: <span className="font-mono">{version.model}</span>
                      </span>
                    )}
                    {version.temperature != null && (
                      <span>
                        Temp: <span className="font-mono">{version.temperature}</span>
                      </span>
                    )}
                    {version.maxTokens && (
                      <span>
                        Max tokens: <span className="font-mono">{version.maxTokens}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
