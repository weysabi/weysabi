"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bot,
  Clock,
  Coins,
  Hash,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
} from "lucide-react";
import { useAdmin, errorMessage } from "@/lib/admin";

interface RunDetail {
  id: string;
  conversationId?: string;
  promptId?: string;
  promptVersionId?: string;
  requestedModel?: string;
  resolvedModel?: string;
  provider?: string;
  fallbackAttempts?: Array<{ provider: string; model: string; error?: string }>;
  documentIds?: string[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
}

export default function RunDetailPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const router = useRouter();
  const { apiFetch } = useAdmin();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(`/v1/projects/${projectId}/runs/${runId}`);
        if (cancelled) return;
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        setRun((await res.json()) as RunDetail);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Failed to load run"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, runId, apiFetch]);

  const statusIcon = () => {
    switch (run?.status) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-600" />;
      case "streaming":
      case "pending":
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
      case "interrupted":
        return <AlertCircle className="h-5 w-5 text-yellow-600" />;
      default:
        return <Activity className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const statusBg = () => {
    switch (run?.status) {
      case "success":
        return "bg-green-500/10 text-green-700 border-green-500/20";
      case "failed":
        return "bg-red-500/10 text-red-700 border-red-500/20";
      case "streaming":
      case "pending":
        return "bg-blue-500/10 text-blue-700 border-blue-500/20";
      case "interrupted":
        return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-48 rounded-xl border border-border bg-card" />
        <div className="h-32 rounded-xl border border-border bg-card" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-600">
        {error || "Run not found"}
      </div>
    );
  }

  const fmtLatency = (ms?: number) => {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const fmtTokens = (n?: number) => (n != null ? n.toLocaleString() : "—");

  const fmtCost = (n?: number) => (n != null ? `$${n.toFixed(6)}` : "—");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/projects/${projectId}/runs`}
          className="rounded-md p-1 hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Run Details
          </h1>
          <p className="text-xs text-muted-foreground font-mono">{runId}</p>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`rounded-xl border p-4 ${statusBg()}`}>
        <div className="flex items-center gap-3">
          {statusIcon()}
          <div>
            <p className="font-semibold capitalize">{run.status}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(run.createdAt).toLocaleString()}
              {run.completedAt && ` — ${new Date(run.completedAt).toLocaleString()}`}
              {run.completedAt &&
                run.createdAt &&
                ` (${fmtLatency(run.completedAt - run.createdAt)})`}
            </p>
          </div>
        </div>
      </div>

      {/* Model Info */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Bot className="h-4 w-4" />
          Model
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Requested Model</p>
            <p className="font-mono text-xs">{run.requestedModel || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Resolved Model</p>
            <p className="font-mono text-xs">{run.resolvedModel || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Provider</p>
            <p className="font-mono text-xs">{run.provider || "—"}</p>
          </div>
        </div>
      </div>

      {/* Tokens & Cost */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Coins className="h-4 w-4" />
          Tokens &amp; Cost
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Prompt</p>
            <p className="text-lg font-bold">{fmtTokens(run.promptTokens)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Completion</p>
            <p className="text-lg font-bold">{fmtTokens(run.completionTokens)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Total</p>
            <p className="text-lg font-bold">{fmtTokens(run.totalTokens)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Cost</p>
            <p className="text-lg font-bold font-mono">{fmtCost(run.estimatedCostUsd)}</p>
          </div>
        </div>
      </div>

      {/* Timing */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Timing
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Latency</p>
            <p className="text-lg font-bold">{fmtLatency(run.latencyMs)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Created</p>
            <p className="text-sm">{new Date(run.createdAt).toLocaleString()}</p>
          </div>
          {run.completedAt && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Completed</p>
              <p className="text-sm">{new Date(run.completedAt).toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>

      {/* Error Info */}
      {run.status === "failed" && (run.errorCode || run.errorMessage) && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2 text-red-700">
            <XCircle className="h-4 w-4" />
            Error
          </h2>
          {run.errorCode && (
            <p className="text-xs text-muted-foreground mb-1">
              Code: <span className="font-mono">{run.errorCode}</span>
            </p>
          )}
          {run.errorMessage && (
            <p className="text-sm text-red-700 whitespace-pre-wrap">{run.errorMessage}</p>
          )}
        </div>
      )}

      {/* Fallback Attempts */}
      {run.fallbackAttempts && run.fallbackAttempts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Fallback Attempts ({run.fallbackAttempts.length})
          </h2>
          <div className="space-y-2">
            {run.fallbackAttempts.map((attempt, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">#{i + 1}</span>
                  <span className="font-medium">{attempt.provider}</span>
                  <span className="font-mono text-muted-foreground">/</span>
                  <span className="font-mono text-xs">{attempt.model}</span>
                  {attempt.error && (
                    <span className="ml-auto text-red-600 text-xs">{attempt.error}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related IDs */}
      {(run.conversationId || run.promptId) && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Related Resources
          </h2>
          <div className="space-y-2 text-sm">
            {run.conversationId && (
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <Link
                  href={`/admin/projects/${projectId}/conversations/${run.conversationId}`}
                  className="text-primary hover:underline font-mono text-xs"
                >
                  {run.conversationId}
                </Link>
                <span className="text-xs text-muted-foreground">(Conversation)</span>
              </div>
            )}
            {run.promptId && (
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <Link
                  href={`/admin/projects/${projectId}/prompts/${run.promptId}`}
                  className="text-primary hover:underline font-mono text-xs"
                >
                  {run.promptId}
                  {run.promptVersionId && ` v${run.promptVersionId.slice(0, 8)}`}
                </Link>
                <span className="text-xs text-muted-foreground">(Prompt)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Raw Data */}
      {(run.metadata || (run.documentIds && run.documentIds.length > 0)) && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold flex items-center gap-2 hover:bg-muted/30 transition-colors rounded-xl">
            <Hash className="h-4 w-4" />
            Raw Data
          </summary>
          <div className="border-t border-border px-5 py-4 space-y-4">
            {run.documentIds && run.documentIds.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium">Document IDs</p>
                <div className="flex flex-wrap gap-1.5">
                  {run.documentIds.map((id) => (
                    <code key={id} className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                      {id}
                    </code>
                  ))}
                </div>
              </div>
            )}
            {run.metadata && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium">Metadata</p>
                <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(run.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
