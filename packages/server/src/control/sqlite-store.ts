import { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "crypto";
import type {
  ProjectStore,
  PromptStore,
  ConversationStore,
  RunStore,
  DocumentStore,
  ApiKeyStore,
  ControlPlaneStore,
} from "./store";
import type { Page, PageOptions } from "./types";
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ManagedPrompt,
  CreatePromptInput,
  UpdatePromptInput,
  PromptVersion,
  CreatePromptVersionInput,
  Conversation,
  CreateConversationInput,
  UpdateConversationInput,
  ConversationMessage,
  AppendMessageInput,
  UpdateMessageInput,
  ConversationQuery,
  MessageQuery,
  Run,
  CreateRunInput,
  UpdateRunInput,
  RunQuery,
  RunStats,
  RunStatsQuery,
  ManagedDocument,
  CreateDocumentInput,
  DocumentQuery,
  ProjectApiKey,
  CreatedProjectApiKey,
  CreateApiKeyInput,
  UpdateApiKeyInput,
  ApiKeyQuery,
} from "./types";
import { fingerprintApiKey } from "../quota";
import {
  ControlConflictError,
  ControlResourceNotFoundError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "./errors";

function now(): number {
  return Date.now();
}

// ─── Row types ──────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  metadata: string;
  settings: string;
  created_at: number;
  updated_at: number;
}

interface PromptRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  published_version_id: string | null;
  created_at: number;
  updated_at: number;
}

interface PromptVersionRow {
  id: string;
  project_id: string;
  prompt_id: string;
  version: number;
  messages: string;
  input_schema: string | null;
  output_schema: string | null;
  model: string | null;
  fallbacks: string | null;
  temperature: number | null;
  max_tokens: number | null;
  status: string;
  created_at: number;
  published_at: number | null;
}

interface ConversationRow {
  id: string;
  project_id: string;
  external_user_id: string | null;
  title: string | null;
  summary: string | null;
  status: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  project_id: string;
  conversation_id: string;
  role: string;
  content: string;
  status: string;
  token_count: number | null;
  metadata: string;
  created_at: number;
}

interface RunRow {
  id: string;
  project_id: string;
  conversation_id: string | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  requested_model: string;
  resolved_model: string | null;
  provider: string | null;
  fallback_attempts: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  metadata: string;
  created_at: number;
  completed_at: number | null;
}

interface DocumentRow {
  id: string;
  project_id: string;
  name: string;
  source_type: string;
  source_uri: string | null;
  content_hash: string;
  status: string;
  chunk_count: number;
  metadata: string;
  created_at: number;
  updated_at: number;
}

interface ApiKeyRow {
  id: string;
  project_id: string;
  name: string;
  fingerprint: string;
  key_hash: string;
  scopes: string;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

function notFound(resource: string, id: string, code: string): ControlResourceNotFoundError {
  return new ControlResourceNotFoundError(resource, id, code);
}

function requireChanges(
  result: { changes: number },
  resource: string,
  id: string,
  code: string
): void {
  if (result.changes === 0) throw notFound(resource, id, code);
}

// ─── Converters ─────────────────────────────────────────────

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    metadata: JSON.parse(row.metadata),
    settings: JSON.parse(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPrompt(row: PromptRow): ManagedPrompt {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    publishedVersionId: row.published_version_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPromptVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    promptId: row.prompt_id,
    version: row.version,
    messages: JSON.parse(row.messages),
    inputSchema: row.input_schema ? JSON.parse(row.input_schema) : undefined,
    outputSchema: row.output_schema ? JSON.parse(row.output_schema) : undefined,
    model: row.model ?? undefined,
    fallbacks: row.fallbacks ? JSON.parse(row.fallbacks) : undefined,
    temperature: row.temperature ?? undefined,
    maxTokens: row.max_tokens ?? undefined,
    status: row.status as PromptVersion["status"],
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
  };
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.project_id,
    externalUserId: row.external_user_id ?? undefined,
    title: row.title ?? undefined,
    summary: row.summary ?? undefined,
    status: row.status as Conversation["status"],
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    role: row.role as ConversationMessage["role"],
    content: row.content,
    status: row.status as ConversationMessage["status"],
    tokenCount: row.token_count ?? undefined,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
  };
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    conversationId: row.conversation_id ?? undefined,
    userMessageId: row.user_message_id ?? undefined,
    assistantMessageId: row.assistant_message_id ?? undefined,
    promptId: row.prompt_id ?? undefined,
    promptVersionId: row.prompt_version_id ?? undefined,
    requestedModel: row.requested_model,
    resolvedModel: row.resolved_model ?? undefined,
    provider: row.provider ?? undefined,
    fallbackAttempts: JSON.parse(row.fallback_attempts),
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    estimatedCostUsd: row.estimated_cost_usd ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
    status: row.status as Run["status"],
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function rowToDocument(row: DocumentRow): ManagedDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sourceType: row.source_type as ManagedDocument["sourceType"],
    sourceUri: row.source_uri ?? undefined,
    contentHash: row.content_hash,
    status: row.status as ManagedDocument["status"],
    chunkCount: row.chunk_count,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToApiKey(row: ApiKeyRow): ProjectApiKey {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    fingerprint: row.fingerprint,
    scopes: JSON.parse(row.scopes),
    expiresAt: row.expires_at ?? undefined,
    lastUsedAt: row.last_used_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
  };
}

// ─── Project Store ──────────────────────────────────────────

class SqliteProjectStore implements ProjectStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const settings = JSON.stringify(input.settings ?? {});
    const timestamp = now();
    try {
      this.db.run(
        `INSERT INTO projects (id, name, slug, metadata, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, input.name, input.slug, metadata, settings, timestamp, timestamp]
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        throw new ProjectSlugConflictError(input.slug);
      }
      throw err;
    }
    return this.get(id) as Promise<Project>;
  }

  async get(projectId: string): Promise<Project | null> {
    const row = this.db
      .query<ProjectRow, string>("SELECT * FROM projects WHERE id = ?")
      .get(projectId);
    return row ? rowToProject(row) : null;
  }

  async getBySlug(slug: string): Promise<Project | null> {
    const row = this.db
      .query<ProjectRow, string>("SELECT * FROM projects WHERE slug = ?")
      .get(slug);
    return row ? rowToProject(row) : null;
  }

  async list(options?: Partial<PageOptions>): Promise<Page<Project>> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM projects")
      .get()!;
    const rows = this.db
      .query<
        ProjectRow,
        [number, number]
      >("SELECT * FROM projects ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset);
    return { items: rows.map(rowToProject), total: countRow.count };
  }

  async update(projectId: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.get(projectId);
    if (!existing) {
      throw new ProjectNotFoundError(projectId);
    }
    const name = input.name ?? existing.name;
    const slug = input.slug ?? existing.slug;
    const metadata = JSON.stringify(input.metadata ?? existing.metadata);
    const settings = JSON.stringify({ ...existing.settings, ...(input.settings ?? {}) });
    try {
      this.db.run(
        "UPDATE projects SET name = ?, slug = ?, metadata = ?, settings = ?, updated_at = ? WHERE id = ?",
        [name, slug, metadata, settings, now(), projectId]
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        throw new ProjectSlugConflictError(slug);
      }
      throw err;
    }
    return this.get(projectId) as Promise<Project>;
  }

  async delete(projectId: string): Promise<void> {
    requireChanges(
      this.db.run("DELETE FROM projects WHERE id = ?", [projectId]),
      "Project",
      projectId,
      "PROJECT_NOT_FOUND"
    );
  }
}

// ─── Prompt Store ───────────────────────────────────────────

class SqlitePromptStore implements PromptStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createPrompt(input: CreatePromptInput): Promise<ManagedPrompt> {
    const id = randomUUID();
    const timestamp = now();
    try {
      this.db.run(
        "INSERT INTO prompts (id, project_id, name, slug, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          input.projectId,
          input.name,
          input.slug,
          input.description ?? null,
          timestamp,
          timestamp,
        ]
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        throw new ControlConflictError(
          `Prompt slug "${input.slug}" is already taken in this project`,
          "PROMPT_SLUG_CONFLICT"
        );
      }
      throw err;
    }
    return this.getPrompt(input.projectId, id) as Promise<ManagedPrompt>;
  }

  async getPrompt(projectId: string, promptId: string): Promise<ManagedPrompt | null> {
    const row = this.db
      .query<PromptRow, [string, string]>("SELECT * FROM prompts WHERE id = ? AND project_id = ?")
      .get(promptId, projectId);
    return row ? rowToPrompt(row) : null;
  }

  async getPromptBySlug(projectId: string, slug: string): Promise<ManagedPrompt | null> {
    const row = this.db
      .query<PromptRow, [string, string]>("SELECT * FROM prompts WHERE project_id = ? AND slug = ?")
      .get(projectId, slug);
    return row ? rowToPrompt(row) : null;
  }

  async listPrompts(
    projectId: string,
    options?: Partial<PageOptions>
  ): Promise<Page<ManagedPrompt>> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) as count FROM prompts WHERE project_id = ?")
      .get(projectId)!;
    const rows = this.db
      .query<
        PromptRow,
        [string, number, number]
      >("SELECT * FROM prompts WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(projectId, limit, offset);
    return { items: rows.map(rowToPrompt), total: countRow.count };
  }

  async updatePrompt(
    projectId: string,
    promptId: string,
    input: UpdatePromptInput
  ): Promise<ManagedPrompt> {
    const existing = await this.getPrompt(projectId, promptId);
    if (!existing) {
      throw notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    }
    const name = input.name ?? existing.name;
    const slug = input.slug ?? existing.slug;
    const description = input.description !== undefined ? input.description : existing.description;
    try {
      this.db.run(
        "UPDATE prompts SET name = ?, slug = ?, description = ?, updated_at = ? WHERE id = ? AND project_id = ?",
        [name, slug, description ?? null, now(), promptId, projectId]
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        throw new ControlConflictError(
          `Prompt slug "${slug}" is already taken in this project`,
          "PROMPT_SLUG_CONFLICT"
        );
      }
      throw err;
    }
    return this.getPrompt(projectId, promptId) as Promise<ManagedPrompt>;
  }

  async deletePrompt(projectId: string, promptId: string): Promise<void> {
    requireChanges(
      this.db.run("DELETE FROM prompts WHERE id = ? AND project_id = ?", [promptId, projectId]),
      "Prompt",
      promptId,
      "PROMPT_NOT_FOUND"
    );
  }

  async createVersion(input: CreatePromptVersionInput): Promise<PromptVersion> {
    const id = randomUUID();
    const messages = JSON.stringify(input.messages);
    const inputSchema = input.inputSchema ? JSON.stringify(input.inputSchema) : null;
    const outputSchema = input.outputSchema ? JSON.stringify(input.outputSchema) : null;
    const fallbacks = input.fallbacks ? JSON.stringify(input.fallbacks) : null;
    const timestamp = now();
    const insert = this.db.transaction(() => {
      const prompt = this.db
        .query<
          { id: string },
          [string, string]
        >("SELECT id FROM prompts WHERE id = ? AND project_id = ?")
        .get(input.promptId, input.projectId);
      if (!prompt) throw notFound("Prompt", input.promptId, "PROMPT_NOT_FOUND");

      const existingVersions = this.db
        .query<
          { max: number },
          [string, string]
        >("SELECT COALESCE(MAX(version), 0) as max FROM prompt_versions WHERE prompt_id = ? AND project_id = ?")
        .get(input.promptId, input.projectId)!;
      const version = existingVersions.max + 1;
      this.db.run(
        "INSERT INTO prompt_versions (id, project_id, prompt_id, version, messages, input_schema, output_schema, model, fallbacks, temperature, max_tokens, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          input.projectId,
          input.promptId,
          version,
          messages,
          inputSchema,
          outputSchema,
          input.model ?? null,
          fallbacks,
          input.temperature ?? null,
          input.maxTokens ?? null,
          "draft",
          timestamp,
        ]
      );
    });
    insert.immediate();
    return this.getVersion(input.projectId, id) as Promise<PromptVersion>;
  }

  async getVersion(projectId: string, versionId: string): Promise<PromptVersion | null> {
    const row = this.db
      .query<
        PromptVersionRow,
        [string, string]
      >("SELECT * FROM prompt_versions WHERE id = ? AND project_id = ?")
      .get(versionId, projectId);
    return row ? rowToPromptVersion(row) : null;
  }

  async listVersions(
    projectId: string,
    promptId: string,
    options?: Partial<PageOptions>
  ): Promise<Page<PromptVersion>> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query<
        { count: number },
        [string, string]
      >("SELECT COUNT(*) as count FROM prompt_versions WHERE project_id = ? AND prompt_id = ?")
      .get(projectId, promptId)!;
    const rows = this.db
      .query<
        PromptVersionRow,
        [string, string, number, number]
      >("SELECT * FROM prompt_versions WHERE project_id = ? AND prompt_id = ? ORDER BY version DESC LIMIT ? OFFSET ?")
      .all(projectId, promptId, limit, offset);
    return { items: rows.map(rowToPromptVersion), total: countRow.count };
  }

  async publishVersion(
    projectId: string,
    promptId: string,
    versionId: string
  ): Promise<ManagedPrompt> {
    const prompt = await this.getPrompt(projectId, promptId);
    if (!prompt) throw notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    const version = await this.getVersion(projectId, versionId);
    if (!version) throw notFound("Prompt version", versionId, "PROMPT_VERSION_NOT_FOUND");
    if (version.promptId !== promptId) {
      throw new ControlConflictError(
        `Prompt version "${versionId}" does not belong to prompt "${promptId}"`,
        "PROMPT_VERSION_MISMATCH"
      );
    }
    const timestamp = now();
    const publish = this.db.transaction(() => {
      this.db.run(
        "UPDATE prompt_versions SET status = 'archived' WHERE prompt_id = ? AND project_id = ? AND status = 'published' AND id <> ?",
        [promptId, projectId, versionId]
      );
      requireChanges(
        this.db.run(
          "UPDATE prompt_versions SET status = 'published', published_at = ? WHERE id = ? AND prompt_id = ? AND project_id = ?",
          [timestamp, versionId, promptId, projectId]
        ),
        "Prompt version",
        versionId,
        "PROMPT_VERSION_NOT_FOUND"
      );
      requireChanges(
        this.db.run(
          "UPDATE prompts SET published_version_id = ?, updated_at = ? WHERE id = ? AND project_id = ?",
          [versionId, timestamp, promptId, projectId]
        ),
        "Prompt",
        promptId,
        "PROMPT_NOT_FOUND"
      );
    });
    publish.immediate();
    return this.getPrompt(projectId, promptId) as Promise<ManagedPrompt>;
  }
}

// ─── Conversation Store ─────────────────────────────────────

class SqliteConversationStore implements ConversationStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const timestamp = now();
    this.db.run(
      "INSERT INTO conversations (id, project_id, external_user_id, title, metadata, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.projectId,
        input.externalUserId ?? null,
        input.title ?? null,
        metadata,
        "active",
        timestamp,
        timestamp,
      ]
    );
    return this.getConversation(input.projectId, id) as Promise<Conversation>;
  }

  async getConversation(projectId: string, conversationId: string): Promise<Conversation | null> {
    const row = this.db
      .query<
        ConversationRow,
        [string, string]
      >("SELECT * FROM conversations WHERE id = ? AND project_id = ?")
      .get(conversationId, projectId);
    return row ? rowToConversation(row) : null;
  }

  async listConversations(
    projectId: string,
    options?: ConversationQuery
  ): Promise<Page<Conversation>> {
    const conditions: string[] = ["project_id = ?"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [projectId];
    if (options?.externalUserId) {
      conditions.push("external_user_id = ?");
      params.push(options.externalUserId);
    }
    if (options?.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }
    const where = conditions.join(" AND ");
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query(`SELECT COUNT(*) as count FROM conversations WHERE ${where}`)
      .get(...params)! as { count: number };
    const rows = this.db
      .query(`SELECT * FROM conversations WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ConversationRow[];
    return { items: rows.map(rowToConversation), total: countRow.count };
  }

  async updateConversation(
    projectId: string,
    conversationId: string,
    input: UpdateConversationInput
  ): Promise<Conversation> {
    const existing = await this.getConversation(projectId, conversationId);
    if (!existing) {
      throw notFound("Conversation", conversationId, "CONVERSATION_NOT_FOUND");
    }
    const title = input.title !== undefined ? input.title : existing.title;
    const summary = input.summary !== undefined ? input.summary : existing.summary;
    const status = input.status ?? existing.status;
    const metadata = input.metadata
      ? JSON.stringify(input.metadata)
      : JSON.stringify(existing.metadata);
    this.db.run(
      "UPDATE conversations SET title = ?, summary = ?, status = ?, metadata = ?, updated_at = ? WHERE id = ? AND project_id = ?",
      [title ?? null, summary ?? null, status, metadata, now(), conversationId, projectId]
    );
    return this.getConversation(projectId, conversationId) as Promise<Conversation>;
  }

  async deleteConversation(projectId: string, conversationId: string): Promise<void> {
    requireChanges(
      this.db.run("DELETE FROM conversations WHERE id = ? AND project_id = ?", [
        conversationId,
        projectId,
      ]),
      "Conversation",
      conversationId,
      "CONVERSATION_NOT_FOUND"
    );
  }

  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const timestamp = now();
    this.db.run(
      "INSERT INTO conversation_messages (id, project_id, conversation_id, role, content, status, token_count, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.projectId,
        input.conversationId,
        input.role,
        input.content,
        input.status ?? "complete",
        input.tokenCount ?? null,
        metadata,
        timestamp,
      ]
    );
    return this.getMessage(input.projectId, id) as Promise<ConversationMessage>;
  }

  private async getMessage(
    projectId: string,
    messageId: string
  ): Promise<ConversationMessage | null> {
    const row = this.db
      .query<
        MessageRow,
        [string, string]
      >("SELECT * FROM conversation_messages WHERE id = ? AND project_id = ?")
      .get(messageId, projectId);
    return row ? rowToMessage(row) : null;
  }

  async updateMessage(
    projectId: string,
    messageId: string,
    input: UpdateMessageInput
  ): Promise<ConversationMessage> {
    const existing = await this.getMessage(projectId, messageId);
    if (!existing) {
      throw notFound("Message", messageId, "MESSAGE_NOT_FOUND");
    }
    const content = input.content ?? existing.content;
    const status = input.status ?? existing.status;
    const tokenCount = input.tokenCount !== undefined ? input.tokenCount : existing.tokenCount;
    this.db.run(
      "UPDATE conversation_messages SET content = ?, status = ?, token_count = ? WHERE id = ? AND project_id = ?",
      [content, status, tokenCount ?? null, messageId, projectId]
    );
    return this.getMessage(projectId, messageId) as Promise<ConversationMessage>;
  }

  async listMessages(
    projectId: string,
    conversationId: string,
    options?: MessageQuery
  ): Promise<Page<ConversationMessage>> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query<
        { count: number },
        [string, string]
      >("SELECT COUNT(*) as count FROM conversation_messages WHERE project_id = ? AND conversation_id = ?")
      .get(projectId, conversationId)!;
    const rows = this.db
      .query<
        MessageRow,
        [string, string, number, number]
      >("SELECT * FROM conversation_messages WHERE project_id = ? AND conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?")
      .all(projectId, conversationId, limit, offset);
    return { items: rows.map(rowToMessage), total: countRow.count };
  }
}

// ─── Run Store ──────────────────────────────────────────────

class SqliteRunStore implements RunStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private requireOwned(
    table: "conversations" | "conversation_messages" | "prompts" | "prompt_versions",
    projectId: string,
    id: string,
    resource: string,
    code: string
  ): void {
    const row = this.db
      .query<
        { id: string },
        [string, string]
      >(`SELECT id FROM ${table} WHERE id = ? AND project_id = ?`)
      .get(id, projectId);
    if (!row) throw notFound(resource, id, code);
  }

  async create(input: CreateRunInput): Promise<Run> {
    if (input.conversationId) {
      this.requireOwned(
        "conversations",
        input.projectId,
        input.conversationId,
        "Conversation",
        "CONVERSATION_NOT_FOUND"
      );
    }
    for (const messageId of [input.userMessageId, input.assistantMessageId]) {
      if (messageId) {
        this.requireOwned(
          "conversation_messages",
          input.projectId,
          messageId,
          "Message",
          "MESSAGE_NOT_FOUND"
        );
      }
    }
    if (input.promptId) {
      this.requireOwned("prompts", input.projectId, input.promptId, "Prompt", "PROMPT_NOT_FOUND");
    }
    if (input.promptVersionId) {
      this.requireOwned(
        "prompt_versions",
        input.projectId,
        input.promptVersionId,
        "Prompt version",
        "PROMPT_VERSION_NOT_FOUND"
      );
      if (input.promptId) {
        const version = this.db
          .query<
            { prompt_id: string },
            [string, string]
          >("SELECT prompt_id FROM prompt_versions WHERE id = ? AND project_id = ?")
          .get(input.promptVersionId, input.projectId)!;
        if (version.prompt_id !== input.promptId) {
          throw new ControlConflictError(
            `Prompt version "${input.promptVersionId}" does not belong to prompt "${input.promptId}"`,
            "PROMPT_VERSION_MISMATCH"
          );
        }
      }
    }
    const id = randomUUID();
    const fallbackAttempts = JSON.stringify(input.fallbackAttempts ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});
    const timestamp = now();
    this.db.run(
      "INSERT INTO runs (id, project_id, conversation_id, user_message_id, assistant_message_id, prompt_id, prompt_version_id, requested_model, resolved_model, provider, fallback_attempts, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, latency_ms, status, error_code, error_message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.projectId,
        input.conversationId ?? null,
        input.userMessageId ?? null,
        input.assistantMessageId ?? null,
        input.promptId ?? null,
        input.promptVersionId ?? null,
        input.requestedModel,
        input.resolvedModel ?? null,
        input.provider ?? null,
        fallbackAttempts,
        input.promptTokens ?? null,
        input.completionTokens ?? null,
        input.totalTokens ?? null,
        input.estimatedCostUsd ?? null,
        input.latencyMs ?? null,
        input.status ?? "pending",
        input.errorCode ?? null,
        input.errorMessage ?? null,
        metadata,
        timestamp,
      ]
    );
    return this.get(input.projectId, id) as Promise<Run>;
  }

  async update(projectId: string, runId: string, input: UpdateRunInput): Promise<Run> {
    const existing = await this.get(projectId, runId);
    if (!existing) {
      throw notFound("Run", runId, "RUN_NOT_FOUND");
    }
    if (input.assistantMessageId) {
      this.requireOwned(
        "conversation_messages",
        projectId,
        input.assistantMessageId,
        "Message",
        "MESSAGE_NOT_FOUND"
      );
    }
    const assistantMessageId =
      input.assistantMessageId !== undefined
        ? input.assistantMessageId
        : existing.assistantMessageId;
    const resolvedModel =
      input.resolvedModel !== undefined ? input.resolvedModel : existing.resolvedModel;
    const provider = input.provider !== undefined ? input.provider : existing.provider;
    const fallbackAttempts = input.fallbackAttempts
      ? JSON.stringify(input.fallbackAttempts)
      : JSON.stringify(existing.fallbackAttempts);
    const promptTokens =
      input.promptTokens !== undefined ? input.promptTokens : existing.promptTokens;
    const completionTokens =
      input.completionTokens !== undefined ? input.completionTokens : existing.completionTokens;
    const totalTokens = input.totalTokens !== undefined ? input.totalTokens : existing.totalTokens;
    const estimatedCostUsd =
      input.estimatedCostUsd !== undefined ? input.estimatedCostUsd : existing.estimatedCostUsd;
    const latencyMs = input.latencyMs !== undefined ? input.latencyMs : existing.latencyMs;
    const status = input.status ?? existing.status;
    const errorCode = input.errorCode !== undefined ? input.errorCode : existing.errorCode;
    const errorMessage =
      input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage;
    const metadata = input.metadata
      ? JSON.stringify(input.metadata)
      : JSON.stringify(existing.metadata);
    const completedAt = input.completedAt !== undefined ? input.completedAt : existing.completedAt;
    this.db.run(
      "UPDATE runs SET assistant_message_id = ?, resolved_model = ?, provider = ?, fallback_attempts = ?, prompt_tokens = ?, completion_tokens = ?, total_tokens = ?, estimated_cost_usd = ?, latency_ms = ?, status = ?, error_code = ?, error_message = ?, metadata = ?, completed_at = ? WHERE id = ? AND project_id = ?",
      [
        assistantMessageId ?? null,
        resolvedModel ?? null,
        provider ?? null,
        fallbackAttempts,
        promptTokens ?? null,
        completionTokens ?? null,
        totalTokens ?? null,
        estimatedCostUsd ?? null,
        latencyMs ?? null,
        status,
        errorCode ?? null,
        errorMessage ?? null,
        metadata,
        completedAt ?? null,
        runId,
        projectId,
      ]
    );
    return this.get(projectId, runId) as Promise<Run>;
  }

  async get(projectId: string, runId: string): Promise<Run | null> {
    const row = this.db
      .query<RunRow, [string, string]>("SELECT * FROM runs WHERE id = ? AND project_id = ?")
      .get(runId, projectId);
    return row ? rowToRun(row) : null;
  }

  async list(projectId: string, query?: RunQuery): Promise<Page<Run>> {
    const conditions: string[] = ["project_id = ?"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [projectId];
    if (query?.conversationId) {
      conditions.push("conversation_id = ?");
      params.push(query.conversationId);
    }
    if (query?.promptId) {
      conditions.push("prompt_id = ?");
      params.push(query.promptId);
    }
    if (query?.status) {
      conditions.push("status = ?");
      params.push(query.status);
    }
    const where = conditions.join(" AND ");
    const limit = query?.limit ?? 50;
    const offset = query?.offset ?? 0;
    const countRow = this.db
      .query(`SELECT COUNT(*) as count FROM runs WHERE ${where}`)
      .get(...params)! as { count: number };
    const rows = this.db
      .query(`SELECT * FROM runs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as RunRow[];
    return { items: rows.map(rowToRun), total: countRow.count };
  }

  async stats(projectId: string, query?: RunStatsQuery): Promise<RunStats> {
    const conditions: string[] = ["project_id = ?"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [projectId];
    if (query?.from) {
      conditions.push("created_at >= ?");
      params.push(query.from);
    }
    if (query?.to) {
      conditions.push("created_at <= ?");
      params.push(query.to);
    }
    const where = conditions.join(" AND ");
    const row = this.db
      .query(
        `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) as interrupted,
        SUM(total_tokens) as tokens,
        SUM(estimated_cost_usd) as cost,
        AVG(latency_ms) as avg_latency
      FROM runs WHERE ${where}`
      )
      .get(...params)! as {
      total: number;
      success: number;
      failed: number;
      interrupted: number;
      tokens: number | null;
      cost: number | null;
      avg_latency: number | null;
    };
    return {
      totalRuns: row.total,
      successCount: row.success,
      failedCount: row.failed,
      interruptedCount: row.interrupted,
      totalTokens: row.tokens ?? 0,
      totalCostUsd: row.cost ?? 0,
      avgLatencyMs: row.avg_latency ?? 0,
    };
  }
}

// ─── Document Store ─────────────────────────────────────────

class SqliteDocumentStore implements DocumentStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async create(input: CreateDocumentInput): Promise<ManagedDocument> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const timestamp = now();
    try {
      this.db.run(
        "INSERT INTO documents (id, project_id, name, source_type, source_uri, content_hash, status, chunk_count, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          input.projectId,
          input.name,
          input.sourceType,
          input.sourceUri ?? null,
          input.contentHash,
          "pending",
          input.chunkCount ?? 0,
          metadata,
          timestamp,
          timestamp,
        ]
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE")) {
        throw new ControlConflictError(
          `Document with content hash "${input.contentHash}" already exists in this project`,
          "DOCUMENT_CONTENT_CONFLICT"
        );
      }
      throw err;
    }
    return this.get(input.projectId, id) as Promise<ManagedDocument>;
  }

  async get(projectId: string, documentId: string): Promise<ManagedDocument | null> {
    const row = this.db
      .query<
        DocumentRow,
        [string, string]
      >("SELECT * FROM documents WHERE id = ? AND project_id = ?")
      .get(documentId, projectId);
    return row ? rowToDocument(row) : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async list(projectId: string, options?: DocumentQuery): Promise<Page<ManagedDocument>> {
    const conditions: string[] = ["project_id = ?"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] = [projectId];
    if (options?.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }
    if (options?.sourceType) {
      conditions.push("source_type = ?");
      params.push(options.sourceType);
    }
    const where = conditions.join(" AND ");
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query(`SELECT COUNT(*) as count FROM documents WHERE ${where}`)
      .get(...params)! as { count: number };
    const rows = this.db
      .query(`SELECT * FROM documents WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as DocumentRow[];
    return { items: rows.map(rowToDocument), total: countRow.count };
  }

  async delete(projectId: string, documentId: string): Promise<void> {
    this.db.run("DELETE FROM documents WHERE id = ? AND project_id = ?", [documentId, projectId]);
  }

  async updateStatus(
    projectId: string,
    documentId: string,
    status: ManagedDocument["status"]
  ): Promise<ManagedDocument> {
    const existing = await this.get(projectId, documentId);
    if (!existing) {
      throw notFound("Document", documentId, "DOCUMENT_NOT_FOUND");
    }
    this.db.run("UPDATE documents SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?", [
      status,
      now(),
      documentId,
      projectId,
    ]);
    return this.get(projectId, documentId) as Promise<ManagedDocument>;
  }
}

// ─── API Key Store ──────────────────────────────────────────

class SqliteApiKeyStore implements ApiKeyStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async create(input: CreateApiKeyInput): Promise<CreatedProjectApiKey> {
    const id = randomUUID();
    const secret = `sabi_${randomBytes(32).toString("base64url")}`;
    const fingerprint = await fingerprintApiKey(secret);
    const keyHash = await Bun.password.hash(secret, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 2,
    });
    const scopes = JSON.stringify(input.scopes ?? ["chat:write"]);
    const timestamp = now();
    this.db.run(
      "INSERT INTO project_api_keys (id, project_id, name, fingerprint, key_hash, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        input.projectId,
        input.name,
        fingerprint,
        keyHash,
        scopes,
        input.expiresAt ?? null,
        timestamp,
      ]
    );
    const record = await this.get(input.projectId, id);
    if (!record) throw new Error("Failed to read newly created project API key");
    return { ...record, secret };
  }

  async get(projectId: string, keyId: string): Promise<ProjectApiKey | null> {
    const row = this.db
      .query<
        ApiKeyRow,
        [string, string]
      >("SELECT * FROM project_api_keys WHERE id = ? AND project_id = ?")
      .get(keyId, projectId);
    return row ? rowToApiKey(row) : null;
  }

  async findBySecret(secret: string): Promise<ProjectApiKey | null> {
    const fingerprint = await fingerprintApiKey(secret);
    const row = this.db
      .query<
        ApiKeyRow,
        [string, number]
      >("SELECT * FROM project_api_keys WHERE fingerprint = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
      .get(fingerprint, now());
    if (!row || !(await Bun.password.verify(secret, row.key_hash))) return null;
    const lastUsedAt = now();
    this.db.run("UPDATE project_api_keys SET last_used_at = ? WHERE id = ?", [lastUsedAt, row.id]);
    return { ...rowToApiKey(row), lastUsedAt };
  }

  async list(projectId: string, options?: ApiKeyQuery): Promise<Page<ProjectApiKey>> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const countRow = this.db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) as count FROM project_api_keys WHERE project_id = ?")
      .get(projectId)!;
    const rows = this.db
      .query<
        ApiKeyRow,
        [string, number, number]
      >("SELECT * FROM project_api_keys WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(projectId, limit, offset);
    return { items: rows.map(rowToApiKey), total: countRow.count };
  }

  async update(projectId: string, keyId: string, input: UpdateApiKeyInput): Promise<ProjectApiKey> {
    const existing = await this.get(projectId, keyId);
    if (!existing) {
      throw notFound("API key", keyId, "API_KEY_NOT_FOUND");
    }
    const name = input.name ?? existing.name;
    const scopes = input.scopes ? JSON.stringify(input.scopes) : JSON.stringify(existing.scopes);
    const revokedAt = input.revokedAt !== undefined ? input.revokedAt : existing.revokedAt;
    const lastUsedAt = input.lastUsedAt !== undefined ? input.lastUsedAt : existing.lastUsedAt;
    this.db.run(
      "UPDATE project_api_keys SET name = ?, scopes = ?, revoked_at = ?, last_used_at = ? WHERE id = ? AND project_id = ?",
      [name, scopes, revokedAt ?? null, lastUsedAt ?? null, keyId, projectId]
    );
    return this.get(projectId, keyId) as Promise<ProjectApiKey>;
  }

  async delete(projectId: string, keyId: string): Promise<void> {
    this.db.run("DELETE FROM project_api_keys WHERE id = ? AND project_id = ?", [keyId, projectId]);
  }
}

// ─── Database setup ────────────────────────────────────────

const MIGRATIONS: Array<{ version: number; statements: string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
        metadata TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE prompts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT,
        published_version_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(id, project_id), UNIQUE(project_id, slug),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE prompt_versions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, prompt_id TEXT NOT NULL,
        version INTEGER NOT NULL, messages TEXT NOT NULL,
        input_schema TEXT, output_schema TEXT,
        model TEXT, fallbacks TEXT, temperature REAL, max_tokens INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at INTEGER NOT NULL, published_at INTEGER,
        UNIQUE(id, project_id), UNIQUE(prompt_id, version),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(prompt_id, project_id) REFERENCES prompts(id, project_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE conversations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        external_user_id TEXT, title TEXT, summary TEXT, status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(id, project_id),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE conversation_messages (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'complete',
        token_count INTEGER, metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
        UNIQUE(id, project_id),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY(conversation_id, project_id)
          REFERENCES conversations(id, project_id) ON DELETE CASCADE
      )`,
      `CREATE TABLE runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        conversation_id TEXT, user_message_id TEXT, assistant_message_id TEXT,
        prompt_id TEXT, prompt_version_id TEXT,
        requested_model TEXT NOT NULL, resolved_model TEXT, provider TEXT,
        fallback_attempts TEXT NOT NULL DEFAULT '[]',
        prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER,
        estimated_cost_usd REAL, latency_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        error_code TEXT, error_message TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL, completed_at INTEGER,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE documents (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        name TEXT NOT NULL, source_type TEXT NOT NULL, source_uri TEXT,
        content_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, content_hash),
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE project_api_keys (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        name TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_projects_slug ON projects(slug)`,
      `CREATE INDEX idx_prompts_project_slug ON prompts(project_id, slug)`,
      `CREATE INDEX idx_prompt_versions_prompt ON prompt_versions(prompt_id, version)`,
      `CREATE INDEX idx_conversations_project ON conversations(project_id, updated_at)`,
      `CREATE INDEX idx_conversations_user ON conversations(project_id, external_user_id, updated_at)`,
      `CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id, created_at)`,
      `CREATE INDEX idx_runs_project ON runs(project_id, created_at)`,
      `CREATE INDEX idx_runs_conversation ON runs(conversation_id, created_at)`,
      `CREATE INDEX idx_documents_project ON documents(project_id)`,
      `CREATE INDEX idx_api_keys_project ON project_api_keys(project_id)`,
    ],
  },
];

function migrate(db: Database): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS control_plane_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );
  const hasLegacySchema = db
    .query<
      { count: number },
      []
    >("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get()!.count;
  const applied = new Set(
    db
      .query<{ version: number }, []>("SELECT version FROM control_plane_migrations")
      .all()
      .map((row) => row.version)
  );
  if (hasLegacySchema > 0 && applied.size === 0) {
    throw new Error(
      "Unsupported preview control-plane schema detected. Back up and recreate this database before continuing."
    );
  }

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    const apply = db.transaction(() => {
      const alreadyApplied = db
        .query<
          { version: number },
          [number]
        >("SELECT version FROM control_plane_migrations WHERE version = ?")
        .get(migration.version);
      if (alreadyApplied) return;
      for (const sql of migration.statements) db.run(sql);
      db.run("INSERT INTO control_plane_migrations (version, applied_at) VALUES (?, ?)", [
        migration.version,
        now(),
      ]);
    });
    apply.immediate();
  }
}

// ─── Factory ───────────────────────────────────────────────

export function createSqliteControlPlaneStore(dbPath: string): ControlPlaneStore {
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);
  let closed = false;

  return {
    projects: new SqliteProjectStore(db),
    prompts: new SqlitePromptStore(db),
    conversations: new SqliteConversationStore(db),
    runs: new SqliteRunStore(db),
    documents: new SqliteDocumentStore(db),
    apiKeys: new SqliteApiKeyStore(db),
    async close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
