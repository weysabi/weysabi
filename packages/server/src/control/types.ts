import { z } from "zod";

// ─── Pagination ────────────────────────────────────────────

export const PageOptionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

// ─── Projects ──────────────────────────────────────────────

export const ProjectSettingsSchema = z.object({
  defaultModel: z.string().optional(),
  fallbackModels: z.array(z.string()).optional(),
  defaultPromptId: z.string().optional(),
  retentionDays: z.number().int().positive().optional(),
});

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export interface Project {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/u,
      "Slug must start with a letter or number and contain only lowercase letters, numbers, and hyphens"
    ),
  metadata: z.record(z.string(), z.unknown()).default({}),
  settings: ProjectSettingsSchema.default({}),
});

export interface CreateProjectInput {
  name: string;
  slug: string;
  metadata?: Record<string, unknown>;
  settings?: ProjectSettings;
}

export const UpdateProjectInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u)
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  settings: ProjectSettingsSchema.partial().optional(),
});

export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

// ─── Prompts ───────────────────────────────────────────────

export const PromptMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});

export const PromptVersionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  promptId: z.string(),
  version: z.number().int().positive(),
  messages: z.array(PromptMessageSchema),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
  fallbacks: z.array(z.string()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  status: z.enum(["draft", "published", "archived"]),
  createdAt: z.number(),
  publishedAt: z.number().optional(),
});

export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export interface ManagedPrompt {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  publishedVersionId?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Conversations ─────────────────────────────────────────

export type ConversationStatus = "active" | "archived" | "deleted";

export interface Conversation {
  id: string;
  projectId: string;
  externalUserId?: string;
  title?: string;
  summary?: string;
  status: ConversationStatus;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  projectId: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  status: "pending" | "complete" | "interrupted" | "failed";
  tokenCount?: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

// ─── Runs ──────────────────────────────────────────────────

export type RunStatus = "pending" | "streaming" | "success" | "failed" | "interrupted";

export interface RunAttempt {
  model: string;
  provider: string;
  latencyMs?: number;
  error?: string;
}

export interface Run {
  id: string;
  projectId: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  promptId?: string;
  promptVersionId?: string;
  requestedModel: string;
  resolvedModel?: string;
  provider?: string;
  fallbackAttempts: RunAttempt[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  status: RunStatus;
  errorCode?: string;
  errorMessage?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
}

// ─── Prompt Inputs ─────────────────────────────────────────

export const CreatePromptInputSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/u,
      "Slug must start with a letter or number and contain only lowercase letters, numbers, and hyphens"
    ),
  description: z.string().optional(),
});

export type CreatePromptInput = z.infer<typeof CreatePromptInputSchema>;

export const UpdatePromptInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/u)
    .optional(),
  description: z.string().optional(),
});

export type UpdatePromptInput = z.infer<typeof UpdatePromptInputSchema>;

export const CreatePromptVersionInputSchema = z.object({
  projectId: z.string(),
  promptId: z.string(),
  messages: z.array(PromptMessageSchema),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
  fallbacks: z.array(z.string()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
});

export type CreatePromptVersionInput = z.infer<typeof CreatePromptVersionInputSchema>;

// ─── Conversation Inputs ────────────────────────────────────

export const CreateConversationInputSchema = z.object({
  projectId: z.string(),
  externalUserId: z.string().optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CreateConversationInput = z.input<typeof CreateConversationInputSchema>;

export const UpdateConversationInputSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  status: z.enum(["active", "archived", "deleted"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateConversationInput = z.infer<typeof UpdateConversationInputSchema>;

export const AppendMessageInputSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  status: z.enum(["pending", "complete", "interrupted", "failed"]).default("complete"),
  tokenCount: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AppendMessageInput = z.input<typeof AppendMessageInputSchema>;

export const UpdateMessageInputSchema = z.object({
  content: z.string().optional(),
  status: z.enum(["pending", "complete", "interrupted", "failed"]).optional(),
  tokenCount: z.number().int().nonnegative().optional(),
});

export type UpdateMessageInput = z.infer<typeof UpdateMessageInputSchema>;

export const ConversationQuerySchema = z.object({
  externalUserId: z.string().optional(),
  status: z.enum(["active", "archived", "deleted"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ConversationQuery = z.input<typeof ConversationQuerySchema>;

export const MessageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type MessageQuery = z.infer<typeof MessageQuerySchema>;

// ─── Run Inputs ─────────────────────────────────────────────

export const CreateRunInputSchema = z.object({
  projectId: z.string(),
  conversationId: z.string().optional(),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  promptId: z.string().optional(),
  promptVersionId: z.string().optional(),
  requestedModel: z.string(),
  resolvedModel: z.string().optional(),
  provider: z.string().optional(),
  fallbackAttempts: z
    .array(
      z.object({
        model: z.string(),
        provider: z.string(),
        latencyMs: z.number().optional(),
        error: z.string().optional(),
      })
    )
    .default([]),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().optional(),
  latencyMs: z.number().optional(),
  status: z.enum(["pending", "streaming", "success", "failed", "interrupted"]).default("pending"),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CreateRunInput = z.input<typeof CreateRunInputSchema>;

export const UpdateRunInputSchema = z.object({
  resolvedModel: z.string().optional(),
  provider: z.string().optional(),
  fallbackAttempts: z
    .array(
      z.object({
        model: z.string(),
        provider: z.string(),
        latencyMs: z.number().optional(),
        error: z.string().optional(),
      })
    )
    .optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().optional(),
  latencyMs: z.number().optional(),
  status: z.enum(["pending", "streaming", "success", "failed", "interrupted"]).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  completedAt: z.number().optional(),
});

export type UpdateRunInput = z.infer<typeof UpdateRunInputSchema>;

export const RunQuerySchema = z.object({
  conversationId: z.string().optional(),
  promptId: z.string().optional(),
  status: z.enum(["pending", "streaming", "success", "failed", "interrupted"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RunQuery = z.input<typeof RunQuerySchema>;

export interface RunStats {
  totalRuns: number;
  successCount: number;
  failedCount: number;
  interruptedCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
}

export const RunStatsQuerySchema = z.object({
  from: z.number().optional(),
  to: z.number().optional(),
});

export type RunStatsQuery = z.infer<typeof RunStatsQuerySchema>;

// ─── Documents ──────────────────────────────────────────────

export const CreateDocumentInputSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(500),
  sourceType: z.enum(["text", "file", "url"]),
  sourceUri: z.string().optional(),
  contentHash: z.string(),
  chunkCount: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CreateDocumentInput = z.input<typeof CreateDocumentInputSchema>;

export interface ManagedDocument {
  id: string;
  projectId: string;
  name: string;
  sourceType: "text" | "file" | "url";
  sourceUri?: string;
  contentHash: string;
  status: "pending" | "indexing" | "ready" | "failed";
  chunkCount: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export const DocumentQuerySchema = z.object({
  status: z.enum(["pending", "indexing", "ready", "failed"]).optional(),
  sourceType: z.enum(["text", "file", "url"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type DocumentQuery = z.infer<typeof DocumentQuerySchema>;

// ─── API Keys ───────────────────────────────────────────────

export type ProjectScope =
  | "chat:write"
  | "conversations:read"
  | "conversations:write"
  | "prompts:read"
  | "prompts:write"
  | "documents:read"
  | "documents:write"
  | "usage:read"
  | "project:admin";

export interface ProjectApiKey {
  id: string;
  projectId: string;
  name: string;
  fingerprint: string;
  scopes: ProjectScope[];
  expiresAt?: number;
  lastUsedAt?: number;
  revokedAt?: number;
  createdAt: number;
}

export interface CreatedProjectApiKey extends ProjectApiKey {
  /** Returned once at creation. The store never persists this value. */
  secret: string;
}

export const CreateApiKeyInputSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(200),
  scopes: z
    .array(
      z.enum([
        "chat:write",
        "conversations:read",
        "conversations:write",
        "prompts:read",
        "prompts:write",
        "documents:read",
        "documents:write",
        "usage:read",
        "project:admin",
      ])
    )
    .default(["chat:write"]),
  expiresAt: z.number().optional(),
});

export type CreateApiKeyInput = z.input<typeof CreateApiKeyInputSchema>;

export const UpdateApiKeyInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  scopes: z
    .array(
      z.enum([
        "chat:write",
        "conversations:read",
        "conversations:write",
        "prompts:read",
        "prompts:write",
        "documents:read",
        "documents:write",
        "usage:read",
        "project:admin",
      ])
    )
    .optional(),
  revokedAt: z.number().optional(),
  lastUsedAt: z.number().optional(),
});

export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeyInputSchema>;

export const ApiKeyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ApiKeyQuery = z.infer<typeof ApiKeyQuerySchema>;
