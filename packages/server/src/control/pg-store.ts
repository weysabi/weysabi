import { randomBytes, randomUUID } from "crypto";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql, ne } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  CleanupOptions,
  CleanupResult,
  ControlPlaneStore,
  ProjectStore,
  PromptStore,
  ConversationStore,
  RunStore,
  DocumentStore,
  ApiKeyStore,
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
import {
  conversations,
  conversationMessages,
  documents,
  projectApiKeys,
  projects,
  promptVersions,
  prompts,
  runs,
} from "./drizzle/schema";
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

function notFound(resource: string, id: string, code: string): ControlResourceNotFoundError {
  return new ControlResourceNotFoundError(resource, id, code);
}

function isUniqViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

function isFkViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23503";
}

// ─── Projects ───────────────────────────────────────────────

class PgProjectStore implements ProjectStore {
  private db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const id = randomUUID();
    const ts = now();
    try {
      await this.db.insert(projects).values({
        id,
        name: input.name,
        slug: input.slug,
        metadata: JSON.stringify(input.metadata ?? {}),
        settings: JSON.stringify(input.settings ?? {}),
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err: unknown) {
      if (isUniqViolation(err)) {
        throw new ProjectSlugConflictError(input.slug);
      }
      throw err;
    }
    return this.get(id) as Promise<Project>;
  }

  async get(projectId: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    return rows.length ? rowToProject(rows[0]!) : null;
  }

  async getBySlug(slug: string): Promise<Project | null> {
    const rows = await this.db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return rows.length ? rowToProject(rows[0]!) : null;
  }

  async list(options?: Partial<PageOptions>): Promise<Page<Project>> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    if (options?.search) {
      const pattern = `%${options.search}%`;
      const filter = or(ilike(projects.name, pattern), ilike(projects.slug, pattern));
      const countRows = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(filter);
      const total = countRows[0]?.count ?? 0;
      const rows = await this.db
        .select()
        .from(projects)
        .where(filter)
        .orderBy(desc(projects.createdAt))
        .limit(limit)
        .offset(offset);
      return { items: rows.map(rowToProject), total: Number(total) };
    }
    const countRows = await this.db.select({ count: sql<number>`count(*)` }).from(projects);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToProject), total: Number(total) };
  }

  async update(projectId: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.get(projectId);
    if (!existing) {
      throw new ProjectNotFoundError(projectId);
    }
    const name = input.name ?? existing.name;
    const slug = input.slug ?? existing.slug;
    const metadata = JSON.stringify(input.metadata ?? existing.metadata);
    const settings = JSON.stringify({
      ...existing.settings,
      ...(input.settings ?? {}),
    });
    try {
      await this.db
        .update(projects)
        .set({ name, slug, metadata, settings, updatedAt: now() })
        .where(eq(projects.id, projectId));
      return this.get(projectId) as Promise<Project>;
    } catch (err: unknown) {
      if (isUniqViolation(err)) {
        throw new ProjectSlugConflictError(slug);
      }
      throw err;
    }
  }

  async delete(projectId: string): Promise<void> {
    const result = await this.db.delete(projects).where(eq(projects.id, projectId));
    if (result.length === 0) {
      throw notFound("Project", projectId, "PROJECT_NOT_FOUND");
    }
  }
}

// ─── Prompts ─────────────────────────────────────────────────

class PgPromptStore implements PromptStore {
  private db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
  }

  async createPrompt(input: CreatePromptInput): Promise<ManagedPrompt> {
    const id = randomUUID();
    const ts = now();
    try {
      await this.db.insert(prompts).values({
        id,
        projectId: input.projectId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err: unknown) {
      if (isFkViolation(err)) {
        throw new ProjectNotFoundError(input.projectId);
      }
      if (isUniqViolation(err)) {
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
    const rows = await this.db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, promptId), eq(prompts.projectId, projectId)))
      .limit(1);
    return rows.length ? rowToPrompt(rows[0]!) : null;
  }

  async getPromptBySlug(projectId: string, slug: string): Promise<ManagedPrompt | null> {
    const rows = await this.db
      .select()
      .from(prompts)
      .where(and(eq(prompts.projectId, projectId), eq(prompts.slug, slug)))
      .limit(1);
    return rows.length ? rowToPrompt(rows[0]!) : null;
  }

  async listPrompts(
    projectId: string,
    options?: Partial<PageOptions>
  ): Promise<Page<ManagedPrompt>> {
    const conditions: SQL[] = [eq(prompts.projectId, projectId)];
    if (options?.search) {
      const pattern = `%${options.search}%`;
      conditions.push(or(ilike(prompts.name, pattern), ilike(prompts.slug, pattern)) as SQL);
    }
    const filter = and(...conditions);
    const limit = Number(options?.limit ?? 50);
    const offset = Number(options?.offset ?? 0);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(prompts)
      .where(filter);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(prompts)
      .where(filter)
      .orderBy(desc(prompts.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToPrompt), total: Number(total) };
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
      await this.db
        .update(prompts)
        .set({
          name,
          slug,
          description: description ?? null,
          updatedAt: now(),
        })
        .where(and(eq(prompts.id, promptId), eq(prompts.projectId, projectId)));
    } catch (err: unknown) {
      if (isUniqViolation(err)) {
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
    const result = await this.db
      .delete(prompts)
      .where(and(eq(prompts.id, promptId), eq(prompts.projectId, projectId)));
    if (result.length === 0) {
      throw notFound("Prompt", promptId, "PROMPT_NOT_FOUND");
    }
  }

  async createVersion(input: CreatePromptVersionInput): Promise<PromptVersion> {
    const id = randomUUID();
    const messages = JSON.stringify(input.messages);
    const inputSchema = input.inputSchema ? JSON.stringify(input.inputSchema) : null;
    const outputSchema = input.outputSchema ? JSON.stringify(input.outputSchema) : null;
    const fallbacks = input.fallbacks ? JSON.stringify(input.fallbacks) : null;
    const ts = now();

    return this.db.transaction(async (tx) => {
      const promptCheck = await tx
        .select({ id: prompts.id })
        .from(prompts)
        .where(and(eq(prompts.id, input.promptId), eq(prompts.projectId, input.projectId)))
        .limit(1);
      if (promptCheck.length === 0) {
        throw notFound("Prompt", input.promptId, "PROMPT_NOT_FOUND");
      }

      const [maxRow] = await tx
        .select({ max: sql<number>`COALESCE(MAX(version), 0)` })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, input.promptId));
      const version = Number(maxRow?.max ?? 0) + 1;

      await tx.insert(promptVersions).values({
        id,
        projectId: input.projectId,
        promptId: input.promptId,
        version,
        messages,
        inputSchema,
        outputSchema,
        model: input.model ?? null,
        fallbacks,
        temperature: input.temperature ?? null,
        maxTokens: input.maxTokens ?? null,
        status: "draft",
        createdAt: ts,
      });

      const [row] = await tx
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.id, id))
        .limit(1);
      return rowToPromptVersion(row!);
    });
  }

  async getVersion(projectId: string, versionId: string): Promise<PromptVersion | null> {
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.id, versionId), eq(promptVersions.projectId, projectId)))
      .limit(1);
    return rows.length ? rowToPromptVersion(rows[0]!) : null;
  }

  async listVersions(
    projectId: string,
    promptId: string,
    options?: Partial<PageOptions>
  ): Promise<Page<PromptVersion>> {
    const limit = Number(options?.limit ?? 50);
    const offset = Number(options?.offset ?? 0);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(promptVersions)
      .where(and(eq(promptVersions.projectId, projectId), eq(promptVersions.promptId, promptId)));
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.projectId, projectId), eq(promptVersions.promptId, promptId)))
      .orderBy(desc(promptVersions.version))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToPromptVersion), total: Number(total) };
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
    const ts = now();

    await this.db.transaction(async (tx) => {
      await tx
        .update(promptVersions)
        .set({ status: "archived" })
        .where(
          and(
            eq(promptVersions.promptId, promptId),
            eq(promptVersions.projectId, projectId),
            eq(promptVersions.status, "published"),
            ne(promptVersions.id, versionId)
          )
        );
      const result = await tx
        .update(promptVersions)
        .set({ status: "published", publishedAt: ts })
        .where(
          and(
            eq(promptVersions.id, versionId),
            eq(promptVersions.promptId, promptId),
            eq(promptVersions.projectId, projectId)
          )
        );
      if (result.length === 0) {
        throw notFound("Prompt version", versionId, "PROMPT_VERSION_NOT_FOUND");
      }
      await tx
        .update(prompts)
        .set({ publishedVersionId: versionId, updatedAt: ts })
        .where(and(eq(prompts.id, promptId), eq(prompts.projectId, projectId)));
    });

    return this.getPrompt(projectId, promptId) as Promise<ManagedPrompt>;
  }
}

// ─── Conversations ───────────────────────────────────────────

class PgConversationStore implements ConversationStore {
  private db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const ts = now();
    await this.db.insert(conversations).values({
      id,
      projectId: input.projectId,
      externalUserId: input.externalUserId ?? null,
      title: input.title ?? null,
      metadata,
      status: "active",
      createdAt: ts,
      updatedAt: ts,
    });
    return this.getConversation(input.projectId, id) as Promise<Conversation>;
  }

  async getConversation(projectId: string, conversationId: string): Promise<Conversation | null> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)))
      .limit(1);
    return rows.length ? rowToConversation(rows[0]!) : null;
  }

  async listConversations(
    projectId: string,
    options?: ConversationQuery
  ): Promise<Page<Conversation>> {
    const conditions: SQL[] = [eq(conversations.projectId, projectId)];
    if (options?.externalUserId) {
      conditions.push(eq(conversations.externalUserId, options.externalUserId));
    }
    if (options?.status) {
      conditions.push(eq(conversations.status, options.status));
    }
    if (options?.search) {
      const pattern = `%${options.search}%`;
      conditions.push(ilike(conversations.title, pattern) as SQL);
    }
    const filter = and(...conditions);
    const limit = Number(options?.limit ?? 50);
    const offset = Number(options?.offset ?? 0);

    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(filter);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(conversations)
      .where(filter)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToConversation), total: Number(total) };
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
    await this.db
      .update(conversations)
      .set({
        title: title ?? null,
        summary: summary ?? null,
        status,
        metadata,
        updatedAt: now(),
      })
      .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
    return this.getConversation(projectId, conversationId) as Promise<Conversation>;
  }

  async deleteConversation(projectId: string, conversationId: string): Promise<void> {
    const result = await this.db
      .delete(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)));
    if (result.length === 0) {
      throw notFound("Conversation", conversationId, "CONVERSATION_NOT_FOUND");
    }
  }

  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const ts = now();
    await this.db.insert(conversationMessages).values({
      id,
      projectId: input.projectId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      status: input.status ?? "complete",
      tokenCount: input.tokenCount ?? null,
      metadata,
      createdAt: ts,
    });
    return this.getMessage(input.projectId, id) as Promise<ConversationMessage>;
  }

  private async getMessage(
    projectId: string,
    messageId: string
  ): Promise<ConversationMessage | null> {
    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(
        and(eq(conversationMessages.id, messageId), eq(conversationMessages.projectId, projectId))
      )
      .limit(1);
    return rows.length ? rowToMessage(rows[0]!) : null;
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
    await this.db
      .update(conversationMessages)
      .set({
        content,
        status,
        tokenCount: tokenCount ?? null,
      })
      .where(
        and(eq(conversationMessages.id, messageId), eq(conversationMessages.projectId, projectId))
      );
    return this.getMessage(projectId, messageId) as Promise<ConversationMessage>;
  }

  async listMessages(
    projectId: string,
    conversationId: string,
    options?: MessageQuery
  ): Promise<Page<ConversationMessage>> {
    const limit = Number(options?.limit ?? 100);
    const offset = Number(options?.offset ?? 0);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.projectId, projectId),
          eq(conversationMessages.conversationId, conversationId)
        )
      );
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.projectId, projectId),
          eq(conversationMessages.conversationId, conversationId)
        )
      )
      .orderBy(conversationMessages.createdAt)
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToMessage), total: Number(total) };
  }
}

// ─── Runs ────────────────────────────────────────────────────

class PgRunStore implements RunStore {
  private db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
  }

  private async requireOwned(
    table: "conversations" | "conversation_messages" | "prompts" | "prompt_versions",
    projectId: string,
    id: string,
    resource: string,
    code: string
  ): Promise<void> {
    let found: boolean;
    switch (table) {
      case "conversations": {
        const r = await this.db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, id), eq(conversations.projectId, projectId)))
          .limit(1);
        found = r.length > 0;
        break;
      }
      case "conversation_messages": {
        const r = await this.db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(
            and(eq(conversationMessages.id, id), eq(conversationMessages.projectId, projectId))
          )
          .limit(1);
        found = r.length > 0;
        break;
      }
      case "prompts": {
        const r = await this.db
          .select({ id: prompts.id })
          .from(prompts)
          .where(and(eq(prompts.id, id), eq(prompts.projectId, projectId)))
          .limit(1);
        found = r.length > 0;
        break;
      }
      case "prompt_versions": {
        const r = await this.db
          .select({ id: promptVersions.id })
          .from(promptVersions)
          .where(and(eq(promptVersions.id, id), eq(promptVersions.projectId, projectId)))
          .limit(1);
        found = r.length > 0;
        break;
      }
    }
    if (!found) throw notFound(resource, id, code);
  }

  async create(input: CreateRunInput): Promise<Run> {
    if (input.conversationId) {
      await this.requireOwned(
        "conversations",
        input.projectId,
        input.conversationId,
        "Conversation",
        "CONVERSATION_NOT_FOUND"
      );
    }
    for (const messageId of [input.userMessageId, input.assistantMessageId]) {
      if (messageId) {
        await this.requireOwned(
          "conversation_messages",
          input.projectId,
          messageId,
          "Message",
          "MESSAGE_NOT_FOUND"
        );
      }
    }
    if (input.promptId) {
      await this.requireOwned(
        "prompts",
        input.projectId,
        input.promptId,
        "Prompt",
        "PROMPT_NOT_FOUND"
      );
    }
    if (input.promptVersionId) {
      await this.requireOwned(
        "prompt_versions",
        input.projectId,
        input.promptVersionId,
        "Prompt version",
        "PROMPT_VERSION_NOT_FOUND"
      );
      if (input.promptId) {
        const [version] = await this.db
          .select({ promptId: promptVersions.promptId })
          .from(promptVersions)
          .where(
            and(
              eq(promptVersions.id, input.promptVersionId),
              eq(promptVersions.projectId, input.projectId)
            )
          )
          .limit(1);
        if (version && version.promptId !== input.promptId) {
          throw new ControlConflictError(
            `Prompt version "${input.promptVersionId}" does not belong to prompt "${input.promptId}"`,
            "PROMPT_VERSION_MISMATCH"
          );
        }
      }
    }

    const id = randomUUID();
    const fallbackAttempts = JSON.stringify(input.fallbackAttempts ?? []);
    const documentIds = JSON.stringify(input.documentIds ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});
    const ts = now();
    await this.db.insert(runs).values({
      id,
      projectId: input.projectId,
      conversationId: input.conversationId ?? null,
      userMessageId: input.userMessageId ?? null,
      assistantMessageId: input.assistantMessageId ?? null,
      promptId: input.promptId ?? null,
      promptVersionId: input.promptVersionId ?? null,
      requestedModel: input.requestedModel,
      resolvedModel: input.resolvedModel ?? null,
      provider: input.provider ?? null,
      fallbackAttempts,
      documentIds,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      latencyMs: input.latencyMs ?? null,
      status: input.status ?? "pending",
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata,
      createdAt: ts,
    });
    return this.get(input.projectId, id) as Promise<Run>;
  }

  async update(projectId: string, runId: string, input: UpdateRunInput): Promise<Run> {
    const existing = await this.get(projectId, runId);
    if (!existing) {
      throw notFound("Run", runId, "RUN_NOT_FOUND");
    }
    if (input.assistantMessageId) {
      await this.requireOwned(
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
    const documentIds = input.documentIds
      ? JSON.stringify(input.documentIds)
      : JSON.stringify(existing.documentIds);
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

    await this.db
      .update(runs)
      .set({
        assistantMessageId: assistantMessageId ?? null,
        resolvedModel: resolvedModel ?? null,
        provider: provider ?? null,
        fallbackAttempts,
        documentIds,
        promptTokens: promptTokens ?? null,
        completionTokens: completionTokens ?? null,
        totalTokens: totalTokens ?? null,
        estimatedCostUsd: estimatedCostUsd ?? null,
        latencyMs: latencyMs ?? null,
        status,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        metadata,
        completedAt: completedAt ?? null,
      })
      .where(and(eq(runs.id, runId), eq(runs.projectId, projectId)));
    return this.get(projectId, runId) as Promise<Run>;
  }

  async get(projectId: string, runId: string): Promise<Run | null> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.projectId, projectId)))
      .limit(1);
    return rows.length ? rowToRun(rows[0]!) : null;
  }

  async list(projectId: string, query?: RunQuery): Promise<Page<Run>> {
    const conditions: SQL[] = [eq(runs.projectId, projectId)];
    if (query?.conversationId) {
      conditions.push(eq(runs.conversationId, query.conversationId));
    }
    if (query?.promptId) {
      conditions.push(eq(runs.promptId, query.promptId));
    }
    if (query?.status) {
      conditions.push(eq(runs.status, query.status));
    }
    if (query?.search) {
      const pattern = `%${query.search}%`;
      conditions.push(ilike(runs.requestedModel, pattern) as SQL);
    }
    const filter = and(...conditions);
    const limit = Number(query?.limit ?? 50);
    const offset = Number(query?.offset ?? 0);

    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(runs)
      .where(filter);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(runs)
      .where(filter)
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToRun), total: Number(total) };
  }

  async stats(projectId: string, query?: RunStatsQuery): Promise<RunStats> {
    const conditions: SQL[] = [eq(runs.projectId, projectId)];
    if (query?.from) {
      conditions.push(gte(runs.createdAt, query.from));
    }
    if (query?.to) {
      conditions.push(lte(runs.createdAt, query.to));
    }
    const filter = and(...conditions);

    const [row] = await this.db
      .select({
        total: sql<number>`count(*)`,
        success: sql<number>`sum(case when ${runs.status} = 'success' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${runs.status} = 'failed' then 1 else 0 end)`,
        interrupted: sql<number>`sum(case when ${runs.status} = 'interrupted' then 1 else 0 end)`,
        tokens: sql<number>`sum(${runs.totalTokens})`,
        cost: sql<number>`sum(${runs.estimatedCostUsd})`,
        avgLatency: sql<number>`avg(${runs.latencyMs})`,
      })
      .from(runs)
      .where(filter);
    return {
      totalRuns: Number(row?.total ?? 0),
      successCount: Number(row?.success ?? 0),
      failedCount: Number(row?.failed ?? 0),
      interruptedCount: Number(row?.interrupted ?? 0),
      totalTokens: Number(row?.tokens ?? 0),
      totalCostUsd: Number(row?.cost ?? 0),
      avgLatencyMs: Number(row?.avgLatency ?? 0),
    };
  }
}

// ─── Documents ───────────────────────────────────────────────

class PgDocumentStore implements DocumentStore {
  private db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
  }

  async create(input: CreateDocumentInput): Promise<ManagedDocument> {
    const id = randomUUID();
    const metadata = JSON.stringify(input.metadata ?? {});
    const ts = now();
    try {
      await this.db.insert(documents).values({
        id,
        projectId: input.projectId,
        name: input.name,
        sourceType: input.sourceType,
        sourceUri: input.sourceUri ?? null,
        contentHash: input.contentHash,
        status: "pending",
        chunkCount: input.chunkCount ?? 0,
        metadata,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (err: unknown) {
      if (isUniqViolation(err)) {
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
    const rows = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)))
      .limit(1);
    return rows.length ? rowToDocument(rows[0]!) : null;
  }

  async list(projectId: string, options?: DocumentQuery): Promise<Page<ManagedDocument>> {
    const conditions: SQL[] = [eq(documents.projectId, projectId)];
    if (options?.status) {
      conditions.push(eq(documents.status, options.status));
    }
    if (options?.sourceType) {
      conditions.push(eq(documents.sourceType, options.sourceType));
    }
    if (options?.search) {
      const pattern = `%${options.search}%`;
      conditions.push(ilike(documents.name, pattern) as SQL);
    }
    const filter = and(...conditions);
    const limit = Number(options?.limit ?? 50);
    const offset = Number(options?.offset ?? 0);

    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(filter);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(documents)
      .where(filter)
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToDocument), total: Number(total) };
  }

  async delete(projectId: string, documentId: string): Promise<void> {
    await this.db
      .delete(documents)
      .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)));
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
    await this.db
      .update(documents)
      .set({ status, updatedAt: now() })
      .where(and(eq(documents.id, documentId), eq(documents.projectId, projectId)));
    return this.get(projectId, documentId) as Promise<ManagedDocument>;
  }
}

// ─── API Keys ─────────────────────────────────────────────────

class PgApiKeyStore implements ApiKeyStore {
  private db: PostgresJsDatabase;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
  }

  async create(input: CreateApiKeyInput): Promise<CreatedProjectApiKey> {
    const id = randomUUID();
    const secret = `weysabi_${randomBytes(32).toString("base64url")}`;
    const fingerprint = await fingerprintApiKey(secret);
    const keyHash = await Bun.password.hash(secret, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 2,
    });
    const scopes = JSON.stringify(input.scopes ?? ["chat:write"]);
    const ts = now();
    await this.db.insert(projectApiKeys).values({
      id,
      projectId: input.projectId,
      name: input.name,
      fingerprint,
      keyHash,
      scopes,
      expiresAt: input.expiresAt ?? null,
      createdAt: ts,
    });
    const record = await this.get(input.projectId, id);
    if (!record) throw new Error("Failed to read newly created project API key");
    return { ...record, secret };
  }

  async get(projectId: string, keyId: string): Promise<ProjectApiKey | null> {
    const rows = await this.db
      .select()
      .from(projectApiKeys)
      .where(and(eq(projectApiKeys.id, keyId), eq(projectApiKeys.projectId, projectId)))
      .limit(1);
    return rows.length ? rowToApiKey(rows[0]!) : null;
  }

  async findBySecret(secret: string): Promise<ProjectApiKey | null> {
    const fingerprint = await fingerprintApiKey(secret);
    const rows = await this.db
      .select()
      .from(projectApiKeys)
      .where(
        and(
          eq(projectApiKeys.fingerprint, fingerprint),
          sql`${projectApiKeys.revokedAt} IS NULL`,
          sql`(${projectApiKeys.expiresAt} IS NULL OR ${projectApiKeys.expiresAt} > ${now()})`
        )
      )
      .limit(1);
    if (rows.length === 0 || !(await Bun.password.verify(secret, rows[0]!.keyHash))) {
      return null;
    }
    const row = rows[0]!;
    const lastUsedAt = now();
    await this.db.update(projectApiKeys).set({ lastUsedAt }).where(eq(projectApiKeys.id, row.id));
    return { ...rowToApiKey(row), lastUsedAt };
  }

  async list(projectId: string, options?: ApiKeyQuery): Promise<Page<ProjectApiKey>> {
    const conditions: SQL[] = [eq(projectApiKeys.projectId, projectId)];
    if (options?.search) {
      const pattern = `%${options.search}%`;
      conditions.push(ilike(projectApiKeys.name, pattern) as SQL);
    }
    const filter = and(...conditions);
    const limit = Number(options?.limit ?? 50);
    const offset = Number(options?.offset ?? 0);
    const countRows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(projectApiKeys)
      .where(filter);
    const total = countRows[0]?.count ?? 0;
    const rows = await this.db
      .select()
      .from(projectApiKeys)
      .where(filter)
      .orderBy(desc(projectApiKeys.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(rowToApiKey), total: Number(total) };
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
    await this.db
      .update(projectApiKeys)
      .set({
        name,
        scopes,
        revokedAt: revokedAt ?? null,
        lastUsedAt: lastUsedAt ?? null,
      })
      .where(and(eq(projectApiKeys.id, keyId), eq(projectApiKeys.projectId, projectId)));
    return this.get(projectId, keyId) as Promise<ProjectApiKey>;
  }

  async delete(projectId: string, keyId: string): Promise<void> {
    await this.db
      .delete(projectApiKeys)
      .where(and(eq(projectApiKeys.id, keyId), eq(projectApiKeys.projectId, projectId)));
  }
}

// ─── Row-to-model converters ─────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  metadata: string;
  settings: string;
  createdAt: number;
  updatedAt: number;
}

interface PromptRow {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  publishedVersionId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface PromptVersionRow {
  id: string;
  projectId: string;
  promptId: string;
  version: number;
  messages: string;
  inputSchema: string | null;
  outputSchema: string | null;
  model: string | null;
  fallbacks: string | null;
  temperature: number | null;
  maxTokens: number | null;
  status: string;
  createdAt: number;
  publishedAt: number | null;
}

interface ConversationRow {
  id: string;
  projectId: string;
  externalUserId: string | null;
  title: string | null;
  summary: string | null;
  status: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}

interface MessageRow {
  id: string;
  projectId: string;
  conversationId: string;
  role: string;
  content: string;
  status: string;
  tokenCount: number | null;
  metadata: string;
  createdAt: number;
}

interface RunRow {
  id: string;
  projectId: string;
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  promptId: string | null;
  promptVersionId: string | null;
  requestedModel: string;
  resolvedModel: string | null;
  provider: string | null;
  fallbackAttempts: string;
  documentIds: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: string;
  createdAt: number;
  completedAt: number | null;
}

interface DocumentRow {
  id: string;
  projectId: string;
  name: string;
  sourceType: string;
  sourceUri: string | null;
  contentHash: string;
  status: string;
  chunkCount: number;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}

interface ApiKeyRow {
  id: string;
  projectId: string;
  name: string;
  fingerprint: string;
  keyHash: string;
  scopes: string;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    metadata: JSON.parse(row.metadata),
    settings: JSON.parse(row.settings),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToPrompt(row: PromptRow): ManagedPrompt {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    publishedVersionId: row.publishedVersionId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToPromptVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    projectId: row.projectId,
    promptId: row.promptId,
    version: row.version,
    messages: JSON.parse(row.messages),
    inputSchema: row.inputSchema ? JSON.parse(row.inputSchema) : undefined,
    outputSchema: row.outputSchema ? JSON.parse(row.outputSchema) : undefined,
    model: row.model ?? undefined,
    fallbacks: row.fallbacks ? JSON.parse(row.fallbacks) : undefined,
    temperature: row.temperature ?? undefined,
    maxTokens: row.maxTokens ?? undefined,
    status: row.status as PromptVersion["status"],
    createdAt: row.createdAt,
    publishedAt: row.publishedAt ?? undefined,
  };
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.projectId,
    externalUserId: row.externalUserId ?? undefined,
    title: row.title ?? undefined,
    summary: row.summary ?? undefined,
    status: row.status as Conversation["status"],
    metadata: JSON.parse(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId,
    role: row.role as ConversationMessage["role"],
    content: row.content,
    status: row.status as ConversationMessage["status"],
    tokenCount: row.tokenCount ?? undefined,
    metadata: JSON.parse(row.metadata),
    createdAt: row.createdAt,
  };
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId ?? undefined,
    userMessageId: row.userMessageId ?? undefined,
    assistantMessageId: row.assistantMessageId ?? undefined,
    promptId: row.promptId ?? undefined,
    promptVersionId: row.promptVersionId ?? undefined,
    requestedModel: row.requestedModel,
    resolvedModel: row.resolvedModel ?? undefined,
    provider: row.provider ?? undefined,
    fallbackAttempts: JSON.parse(row.fallbackAttempts),
    documentIds: JSON.parse(row.documentIds),
    promptTokens: row.promptTokens ?? undefined,
    completionTokens: row.completionTokens ?? undefined,
    totalTokens: row.totalTokens ?? undefined,
    estimatedCostUsd: row.estimatedCostUsd ?? undefined,
    latencyMs: row.latencyMs ?? undefined,
    status: row.status as Run["status"],
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    metadata: JSON.parse(row.metadata),
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
  };
}

function rowToDocument(row: DocumentRow): ManagedDocument {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    sourceType: row.sourceType as ManagedDocument["sourceType"],
    sourceUri: row.sourceUri ?? undefined,
    contentHash: row.contentHash,
    status: row.status as ManagedDocument["status"],
    chunkCount: row.chunkCount,
    metadata: JSON.parse(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToApiKey(row: ApiKeyRow): ProjectApiKey {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    fingerprint: row.fingerprint,
    scopes: JSON.parse(row.scopes),
    expiresAt: row.expiresAt ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

// ─── Factory ────────────────────────────────────────────────

const thisDir = dirname(fileURLToPath(import.meta.url));
const defaultMigrationsFolder = resolve(thisDir, "../../../drizzle");

interface PgStoreOptions {
  connectionString?: string;
  sql?: postgres.Sql;
  /** Path to the drizzle migrations folder (default: resolved relative to package) */
  migrationsFolder?: string;
}

export function createPostgresControlPlaneStore(options: PgStoreOptions): ControlPlaneStore {
  const pgClient =
    options.sql ?? postgres(options.connectionString ?? "postgres://localhost:5432/weysabi");
  const db = drizzle(pgClient);
  let closed = false;

  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;
  const migrationPromise = existsSync(migrationsFolder)
    ? migrate(db, { migrationsFolder }).then(() => undefined)
    : Promise.resolve();

  async function ensureReady(): Promise<void> {
    await migrationPromise;
  }

  function wrapStore<T extends object>(store: T): T {
    return new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return new Proxy(value, {
            apply(fn, thisArg, args) {
              const result = (fn as (...args: unknown[]) => unknown).apply(thisArg, args);
              if (result instanceof Promise) {
                return ensureReady().then(() => result);
              }
              return result;
            },
          });
        }
        return value;
      },
    });
  }

  return {
    projects: wrapStore(new PgProjectStore(db)),
    prompts: wrapStore(new PgPromptStore(db)),
    conversations: wrapStore(new PgConversationStore(db)),
    runs: wrapStore(new PgRunStore(db)),
    documents: wrapStore(new PgDocumentStore(db)),
    apiKeys: wrapStore(new PgApiKeyStore(db)),
    async cleanup(options?: CleanupOptions): Promise<CleanupResult> {
      await ensureReady();

      const projectIds: string[] = [];
      if (options?.projectId) {
        projectIds.push(options.projectId);
      } else {
        const rows = await db.select({ id: projects.id }).from(projects);
        projectIds.push(...rows.map((r) => r.id));
      }

      let deletedConversations = 0;
      let deletedRuns = 0;

      for (const pid of projectIds) {
        const settingsRows = await db
          .select({ settings: projects.settings })
          .from(projects)
          .where(eq(projects.id, pid))
          .limit(1);
        if (settingsRows.length === 0) continue;

        const settings = JSON.parse(settingsRows[0]!.settings) as {
          retentionDays?: number;
        };
        const retentionDays = settings.retentionDays;
        if (!retentionDays) continue;

        const cutoff = now() - retentionDays * 86400000;

        const convFilter = and(
          eq(conversations.projectId, pid),
          or(
            inArray(conversations.status, ["archived", "deleted"]),
            lt(conversations.updatedAt, cutoff)
          )
        );
        const runFilter = and(eq(runs.projectId, pid), lt(runs.createdAt, cutoff));

        if (options?.dryRun) {
          const [convCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(conversations)
            .where(convFilter);
          const [runCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(runs)
            .where(runFilter);
          deletedConversations += Number(convCount?.count ?? 0);
          deletedRuns += Number(runCount?.count ?? 0);
        } else {
          const convResult = await db.delete(conversations).where(convFilter);
          const runResult = await db.delete(runs).where(runFilter);
          deletedConversations += convResult.length;
          deletedRuns += runResult.length;
        }
      }

      return { deletedConversations, deletedRuns };
    },
    async close() {
      if (closed) return;
      closed = true;
      await ensureReady();
      if (!options.sql) {
        await pgClient.end();
      }
    },
  };
}
