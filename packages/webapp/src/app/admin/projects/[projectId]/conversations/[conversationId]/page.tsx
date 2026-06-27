"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { MessageSquare, User, Bot, AlertCircle } from "lucide-react";
import { useAdmin } from "@/lib/admin";

interface Message {
  id: string;
  role: string;
  content: string;
  status: string;
  tokenCount?: number;
  createdAt: number;
}

export default function ConversationDetailPage() {
  const { projectId, conversationId } = useParams<{
    projectId: string;
    conversationId: string;
  }>();
  const { apiFetch } = useAdmin();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(
          `/v1/projects/${projectId}/conversations/${conversationId}/messages`
        );
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { items: Message[] };
          setMessages(data.items);
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
  }, [projectId, conversationId, apiFetch]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Conversation</h2>
        <p className="text-sm text-muted-foreground font-mono mt-0.5">{conversationId}</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <MessageSquare className="h-10 w-10 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">No messages</h3>
          <p className="text-sm text-muted-foreground">This conversation has no messages yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl border p-5 ${
                msg.role === "assistant"
                  ? "border-primary/10 bg-primary/5"
                  : msg.role === "system"
                    ? "border-yellow-500/10 bg-yellow-500/5"
                    : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {msg.role === "user" ? (
                  <User className="h-4 w-4 text-muted-foreground" />
                ) : msg.role === "assistant" ? (
                  <Bot className="h-4 w-4 text-primary" />
                ) : (
                  <MessageSquare className="h-4 w-4 text-yellow-600" />
                )}
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  {msg.role}
                </span>
                {msg.status !== "complete" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-600">
                    <AlertCircle className="h-3 w-3" />
                    {msg.status}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              {msg.tokenCount != null && (
                <p className="mt-2 text-xs text-muted-foreground">{msg.tokenCount} tokens</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
