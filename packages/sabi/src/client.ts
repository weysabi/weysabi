export interface SabiClientOptions {
  baseUrl?: string;
  apiKey: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface SabiProjectClientOptions extends SabiClientOptions {
  projectId: string;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ProjectSettings {
  defaultModel?: string;
  fallbackModels?: string[];
  defaultPromptId?: string;
  retentionDays?: number;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  metadata?: Record<string, unknown>;
  settings?: ProjectSettings;
}

export interface UpdateProjectInput {
  name?: string;
  slug?: string;
  metadata?: Record<string, unknown>;
  settings?: Partial<ProjectSettings>;
}

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

export type PromptMessageRole = "system" | "user" | "assistant" | "tool";

export interface PromptMessage {
  role: PromptMessageRole;
  content: string;
}

export interface PromptVersion {
  id: string;
  projectId: string;
  promptId: string;
  version: number;
  messages: PromptMessage[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  model?: string;
  fallbacks?: string[];
  temperature?: number;
  maxTokens?: number;
  status: "draft" | "published" | "archived";
  createdAt: number;
  publishedAt?: number;
}

export interface CreatePromptInput {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdatePromptInput {
  name?: string;
  slug?: string;
  description?: string;
}

export interface CreatePromptVersionInput {
  messages: PromptMessage[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  model?: string;
  fallbacks?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface ExecutePromptInput {
  inputs?: Record<string, unknown>;
  model?: string | string[];
  fallbacks?: string[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

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
  role: PromptMessageRole;
  content: string;
  status: "pending" | "complete" | "interrupted" | "failed";
  tokenCount?: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateConversationInput {
  externalUserId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateConversationInput {
  title?: string;
  summary?: string;
  status?: ConversationStatus;
  metadata?: Record<string, unknown>;
}

export interface ConversationQuery extends PageOptions {
  externalUserId?: string;
  status?: ConversationStatus;
}

export interface AppendMessageInput {
  role: PromptMessageRole;
  content: string;
  status?: ConversationMessage["status"];
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateMessageInput {
  content?: string;
  status?: ConversationMessage["status"];
  tokenCount?: number;
}

export interface MessageQuery {
  limit?: number;
  offset?: number;
}

export interface SendConversationMessageInput {
  content: string;
  model?: string | string[];
  fallbacks?: string[];
  prompt?: string;
  promptVersion?: string;
  promptVersionId?: string;
  promptInputs?: Record<string, unknown>;
  externalUserId?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface RunAttempt {
  model: string;
  provider: string;
  latencyMs?: number;
  error?: string;
}

export type RunStatus = "pending" | "streaming" | "success" | "failed" | "interrupted";

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

export interface SendConversationMessageResult {
  conversation: Conversation;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  run: Run;
  content: string;
}

export type ConversationEvent =
  | { type: "message.created"; message: ConversationMessage; run: Run }
  | { type: "content.delta"; content: string }
  | { type: "usage"; usage: ConversationUsage }
  | { type: "message.completed"; message: ConversationMessage; run: Run }
  | {
      type: "message.interrupted";
      message: ConversationMessage;
      run: Run;
    }
  | { type: "error"; error: { code: string; message: string } };

export interface CreateRunInput {
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  promptId?: string;
  promptVersionId?: string;
  requestedModel: string;
  resolvedModel?: string;
  provider?: string;
  fallbackAttempts?: RunAttempt[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  status?: RunStatus;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateRunInput extends Partial<Omit<CreateRunInput, "requestedModel">> {
  completedAt?: number;
}

export interface RunQuery extends PageOptions {
  conversationId?: string;
  promptId?: string;
  status?: RunStatus;
}

export interface RunStats {
  totalRuns: number;
  successCount: number;
  failedCount: number;
  interruptedCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
}

export interface RunStatsQuery {
  from?: number;
  to?: number;
}

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

export interface CreateDocumentInput {
  name: string;
  sourceType: ManagedDocument["sourceType"];
  sourceUri?: string;
  contentHash: string;
  chunkCount?: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentQuery extends PageOptions {
  status?: ManagedDocument["status"];
  sourceType?: ManagedDocument["sourceType"];
}

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
  secret: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: ProjectScope[];
  expiresAt?: number;
}

export interface UpdateApiKeyInput {
  name?: string;
  scopes?: ProjectScope[];
  revokedAt?: number;
  lastUsedAt?: number;
}

export interface SabiRequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class SabiApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "SabiApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorResponse {
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function appendQuery(path: string, query?: object): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function projectPath(projectId: string, suffix = ""): string {
  return `/v1/projects/${encodeURIComponent(projectId)}${suffix}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    if (!response.ok) {
      throw new SabiApiError(response.status, text || response.statusText);
    }
    throw new SabiApiError(response.status, "Response body was not valid JSON");
  }
  if (!response.ok) {
    const error = data as ErrorResponse | undefined;
    throw new SabiApiError(
      response.status,
      error?.error?.message ?? response.statusText,
      error?.error?.code,
      error?.error?.details
    );
  }
  return data as T;
}

function normalizeSendInput(input: SendConversationMessageInput): SendConversationMessageInput {
  if (!input.promptVersionId) return input;
  const { promptVersionId, promptVersion, ...rest } = input;
  return {
    ...rest,
    promptVersion: promptVersion ?? promptVersionId,
  };
}

async function* parseSse<T>(body: ReadableStream<Uint8Array>): AsyncIterable<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        for (const line of event.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") return;
          yield JSON.parse(data) as T;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: SabiClientOptions) {
    this.baseUrl = stripTrailingSlash(options.baseUrl ?? "http://localhost:3000");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.headers = options.headers ?? {};
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: SabiRequestOptions = {}
  ): Promise<T> {
    const headers = new Headers(this.headers);
    headers.set("authorization", `Bearer ${this.apiKey}`);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
    return parseJsonResponse<T>(response);
  }

  async stream<T>(
    method: string,
    path: string,
    body?: unknown,
    options: Pick<SabiRequestOptions, "signal"> = {}
  ): Promise<AsyncIterable<T>> {
    const headers = new Headers(this.headers);
    headers.set("authorization", `Bearer ${this.apiKey}`);
    if (body !== undefined) headers.set("content-type", "application/json");

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      await parseJsonResponse(response);
    }
    if (!response.body) {
      throw new SabiApiError(response.status, "Response body is not readable");
    }
    return parseSse<T>(response.body);
  }
}

export interface SabiProjectClient {
  readonly projectId: string;
  get(): Promise<Project>;
  update(input: UpdateProjectInput): Promise<Project>;
  delete(): Promise<{ deleted: true }>;
  prompts: {
    create(input: CreatePromptInput): Promise<ManagedPrompt>;
    list(options?: PageOptions): Promise<Page<ManagedPrompt>>;
    get(promptId: string): Promise<ManagedPrompt>;
    update(promptId: string, input: UpdatePromptInput): Promise<ManagedPrompt>;
    delete(promptId: string): Promise<{ deleted: true }>;
    versions: {
      create(promptId: string, input: CreatePromptVersionInput): Promise<PromptVersion>;
      list(promptId: string, options?: PageOptions): Promise<Page<PromptVersion>>;
      get(promptId: string, versionId: string): Promise<PromptVersion>;
      publish(promptId: string, versionId: string): Promise<ManagedPrompt>;
    };
    execute<T = unknown>(promptId: string, input?: ExecutePromptInput): Promise<T>;
  };
  conversations: {
    create(input?: CreateConversationInput): Promise<Conversation>;
    list(query?: ConversationQuery): Promise<Page<Conversation>>;
    get(conversationId: string): Promise<Conversation>;
    update(conversationId: string, input: UpdateConversationInput): Promise<Conversation>;
    delete(conversationId: string): Promise<{ deleted: true }>;
    messages: {
      append(conversationId: string, input: AppendMessageInput): Promise<ConversationMessage>;
      list(conversationId: string, query?: MessageQuery): Promise<Page<ConversationMessage>>;
      update(messageId: string, input: UpdateMessageInput): Promise<ConversationMessage>;
      send(
        conversationId: string,
        input: SendConversationMessageInput,
        options?: SabiRequestOptions
      ): Promise<SendConversationMessageResult>;
      stream(
        conversationId: string,
        input: SendConversationMessageInput,
        options?: Pick<SabiRequestOptions, "signal">
      ): Promise<AsyncIterable<ConversationEvent>>;
    };
  };
  runs: {
    create(input: CreateRunInput): Promise<Run>;
    list(query?: RunQuery): Promise<Page<Run>>;
    get(runId: string): Promise<Run>;
    update(runId: string, input: UpdateRunInput): Promise<Run>;
    stats(query?: RunStatsQuery): Promise<RunStats>;
  };
  documents: {
    create(input: CreateDocumentInput): Promise<ManagedDocument>;
    list(query?: DocumentQuery): Promise<Page<ManagedDocument>>;
    get(documentId: string): Promise<ManagedDocument>;
    updateStatus(documentId: string, status: ManagedDocument["status"]): Promise<ManagedDocument>;
    delete(documentId: string): Promise<{ deleted: true }>;
  };
  apiKeys: {
    create(input: CreateApiKeyInput): Promise<CreatedProjectApiKey>;
    list(options?: PageOptions): Promise<Page<ProjectApiKey>>;
    get(keyId: string): Promise<ProjectApiKey>;
    update(keyId: string, input: UpdateApiKeyInput): Promise<ProjectApiKey>;
    delete(keyId: string): Promise<{ deleted: true }>;
  };
}

export interface SabiClient {
  projects: {
    create(input: CreateProjectInput): Promise<Project>;
    list(options?: PageOptions): Promise<Page<Project>>;
    get(projectId: string): Promise<Project>;
    update(projectId: string, input: UpdateProjectInput): Promise<Project>;
    delete(projectId: string): Promise<{ deleted: true }>;
  };
  project(projectId: string): SabiProjectClient;
}

function createProjectClient(http: HttpClient, projectId: string): SabiProjectClient {
  return {
    projectId,
    get: () => http.request("GET", projectPath(projectId)),
    update: (input) => http.request("PATCH", projectPath(projectId), input),
    delete: () => http.request("DELETE", projectPath(projectId)),
    prompts: {
      create: (input) => http.request("POST", projectPath(projectId, "/prompts"), input),
      list: (options) =>
        http.request("GET", appendQuery(projectPath(projectId, "/prompts"), options)),
      get: (promptId) =>
        http.request("GET", projectPath(projectId, `/prompts/${encodeURIComponent(promptId)}`)),
      update: (promptId, input) =>
        http.request(
          "PATCH",
          projectPath(projectId, `/prompts/${encodeURIComponent(promptId)}`),
          input
        ),
      delete: (promptId) =>
        http.request("DELETE", projectPath(projectId, `/prompts/${encodeURIComponent(promptId)}`)),
      versions: {
        create: (promptId, input) =>
          http.request(
            "POST",
            projectPath(projectId, `/prompts/${encodeURIComponent(promptId)}/versions`),
            input
          ),
        list: (promptId, options) =>
          http.request(
            "GET",
            appendQuery(
              projectPath(projectId, `/prompts/${encodeURIComponent(promptId)}/versions`),
              options
            )
          ),
        get: (promptId, versionId) =>
          http.request(
            "GET",
            projectPath(
              projectId,
              `/prompts/${encodeURIComponent(promptId)}/versions/${encodeURIComponent(versionId)}`
            )
          ),
        publish: (promptId, versionId) =>
          http.request(
            "POST",
            projectPath(
              projectId,
              `/prompts/${encodeURIComponent(promptId)}/versions/${encodeURIComponent(versionId)}/publish`
            )
          ),
      },
      execute: (promptId, input = {}) =>
        http.request(
          "POST",
          projectPath(projectId, `/prompts/${encodeURIComponent(promptId)}/execute`),
          input
        ),
    },
    conversations: {
      create: (input = {}) => http.request("POST", projectPath(projectId, "/conversations"), input),
      list: (query) =>
        http.request("GET", appendQuery(projectPath(projectId, "/conversations"), query)),
      get: (conversationId) =>
        http.request(
          "GET",
          projectPath(projectId, `/conversations/${encodeURIComponent(conversationId)}`)
        ),
      update: (conversationId, input) =>
        http.request(
          "PATCH",
          projectPath(projectId, `/conversations/${encodeURIComponent(conversationId)}`),
          input
        ),
      delete: (conversationId) =>
        http.request(
          "DELETE",
          projectPath(projectId, `/conversations/${encodeURIComponent(conversationId)}`)
        ),
      messages: {
        append: (conversationId, input) =>
          http.request(
            "POST",
            projectPath(projectId, `/conversations/${encodeURIComponent(conversationId)}/messages`),
            input
          ),
        list: (conversationId, query) =>
          http.request(
            "GET",
            appendQuery(
              projectPath(
                projectId,
                `/conversations/${encodeURIComponent(conversationId)}/messages`
              ),
              query
            )
          ),
        update: (messageId, input) =>
          http.request(
            "PATCH",
            projectPath(projectId, `/messages/${encodeURIComponent(messageId)}`),
            input
          ),
        send: (conversationId, input, options) =>
          http.request(
            "POST",
            projectPath(
              projectId,
              `/conversations/${encodeURIComponent(conversationId)}/messages/send`
            ),
            normalizeSendInput(input),
            options
          ),
        stream: (conversationId, input, options) =>
          http.stream(
            "POST",
            projectPath(
              projectId,
              `/conversations/${encodeURIComponent(conversationId)}/messages/stream`
            ),
            normalizeSendInput(input),
            options
          ),
      },
    },
    runs: {
      create: (input) => http.request("POST", projectPath(projectId, "/runs"), input),
      list: (query) => http.request("GET", appendQuery(projectPath(projectId, "/runs"), query)),
      get: (runId) =>
        http.request("GET", projectPath(projectId, `/runs/${encodeURIComponent(runId)}`)),
      update: (runId, input) =>
        http.request("PATCH", projectPath(projectId, `/runs/${encodeURIComponent(runId)}`), input),
      stats: (query) =>
        http.request("GET", appendQuery(projectPath(projectId, "/runs/stats"), query)),
    },
    documents: {
      create: (input) => http.request("POST", projectPath(projectId, "/documents"), input),
      list: (query) =>
        http.request("GET", appendQuery(projectPath(projectId, "/documents"), query)),
      get: (documentId) =>
        http.request("GET", projectPath(projectId, `/documents/${encodeURIComponent(documentId)}`)),
      updateStatus: (documentId, status) =>
        http.request(
          "PATCH",
          projectPath(projectId, `/documents/${encodeURIComponent(documentId)}/status`),
          {
            status,
          }
        ),
      delete: (documentId) =>
        http.request(
          "DELETE",
          projectPath(projectId, `/documents/${encodeURIComponent(documentId)}`)
        ),
    },
    apiKeys: {
      create: (input) => http.request("POST", projectPath(projectId, "/api-keys"), input),
      list: (options) =>
        http.request("GET", appendQuery(projectPath(projectId, "/api-keys"), options)),
      get: (keyId) =>
        http.request("GET", projectPath(projectId, `/api-keys/${encodeURIComponent(keyId)}`)),
      update: (keyId, input) =>
        http.request(
          "PATCH",
          projectPath(projectId, `/api-keys/${encodeURIComponent(keyId)}`),
          input
        ),
      delete: (keyId) =>
        http.request("DELETE", projectPath(projectId, `/api-keys/${encodeURIComponent(keyId)}`)),
    },
  };
}

export function createSabiClient(options: SabiClientOptions): SabiClient {
  const http = new HttpClient(options);
  return {
    projects: {
      create: (input) => http.request("POST", "/v1/projects", input),
      list: (options) => http.request("GET", appendQuery("/v1/projects", options)),
      get: (projectId) => http.request("GET", projectPath(projectId)),
      update: (projectId, input) => http.request("PATCH", projectPath(projectId), input),
      delete: (projectId) => http.request("DELETE", projectPath(projectId)),
    },
    project: (projectId) => createProjectClient(http, projectId),
  };
}

export function createSabiProjectClient(options: SabiProjectClientOptions): SabiProjectClient {
  const http = new HttpClient(options);
  return createProjectClient(http, options.projectId);
}
