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

// ─── Project Store ─────────────────────────────────────────

export interface ProjectStore {
  create(input: CreateProjectInput): Promise<Project>;
  get(projectId: string): Promise<Project | null>;
  getBySlug(slug: string): Promise<Project | null>;
  list(options?: Partial<PageOptions>): Promise<Page<Project>>;
  update(projectId: string, input: UpdateProjectInput): Promise<Project>;
  delete(projectId: string): Promise<void>;
}

// ─── Prompt Store ──────────────────────────────────────────

export interface PromptStore {
  createPrompt(input: CreatePromptInput): Promise<ManagedPrompt>;
  getPrompt(projectId: string, promptId: string): Promise<ManagedPrompt | null>;
  getPromptBySlug(projectId: string, slug: string): Promise<ManagedPrompt | null>;
  listPrompts(projectId: string, options?: Partial<PageOptions>): Promise<Page<ManagedPrompt>>;
  updatePrompt(
    projectId: string,
    promptId: string,
    input: UpdatePromptInput
  ): Promise<ManagedPrompt>;
  deletePrompt(projectId: string, promptId: string): Promise<void>;

  createVersion(input: CreatePromptVersionInput): Promise<PromptVersion>;
  getVersion(projectId: string, versionId: string): Promise<PromptVersion | null>;
  listVersions(
    projectId: string,
    promptId: string,
    options?: Partial<PageOptions>
  ): Promise<Page<PromptVersion>>;
  publishVersion(projectId: string, promptId: string, versionId: string): Promise<ManagedPrompt>;
}

// ─── Conversation Store ─────────────────────────────────────

export interface ConversationStore {
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  getConversation(projectId: string, conversationId: string): Promise<Conversation | null>;
  listConversations(projectId: string, options?: ConversationQuery): Promise<Page<Conversation>>;
  updateConversation(
    projectId: string,
    conversationId: string,
    input: UpdateConversationInput
  ): Promise<Conversation>;
  deleteConversation(projectId: string, conversationId: string): Promise<void>;

  appendMessage(input: AppendMessageInput): Promise<ConversationMessage>;
  updateMessage(
    projectId: string,
    messageId: string,
    input: UpdateMessageInput
  ): Promise<ConversationMessage>;
  listMessages(
    projectId: string,
    conversationId: string,
    options?: MessageQuery
  ): Promise<Page<ConversationMessage>>;
}

// ─── Run Store ──────────────────────────────────────────────

export interface RunStore {
  create(input: CreateRunInput): Promise<Run>;
  update(projectId: string, runId: string, input: UpdateRunInput): Promise<Run>;
  get(projectId: string, runId: string): Promise<Run | null>;
  list(projectId: string, query?: RunQuery): Promise<Page<Run>>;
  stats(projectId: string, query?: RunStatsQuery): Promise<RunStats>;
}

// ─── Document Store ─────────────────────────────────────────

export interface DocumentStore {
  create(input: CreateDocumentInput): Promise<ManagedDocument>;
  get(projectId: string, documentId: string): Promise<ManagedDocument | null>;
  list(projectId: string, options?: DocumentQuery): Promise<Page<ManagedDocument>>;
  delete(projectId: string, documentId: string): Promise<void>;
  updateStatus(
    projectId: string,
    documentId: string,
    status: ManagedDocument["status"]
  ): Promise<ManagedDocument>;
}

// ─── API Key Store ──────────────────────────────────────────

export interface ApiKeyStore {
  create(input: CreateApiKeyInput): Promise<CreatedProjectApiKey>;
  get(projectId: string, keyId: string): Promise<ProjectApiKey | null>;
  findBySecret(secret: string): Promise<ProjectApiKey | null>;
  list(projectId: string, options?: ApiKeyQuery): Promise<Page<ProjectApiKey>>;
  update(projectId: string, keyId: string, input: UpdateApiKeyInput): Promise<ProjectApiKey>;
  delete(projectId: string, keyId: string): Promise<void>;
}

// ─── Composed Control-Plane Store ──────────────────────────

export interface ControlPlaneStore {
  projects: ProjectStore;
  prompts: PromptStore;
  conversations: ConversationStore;
  runs: RunStore;
  documents: DocumentStore;
  apiKeys: ApiKeyStore;
  close(): Promise<void>;
}
