export interface StoreInterface {
  createSession(id?: string, system?: string): Promise<SessionInfo>;
  getSession(sessionId: string): Promise<SessionInfo | null>;
  getOrCreateSession(sessionId: string, system?: string): Promise<SessionInfo>;
  updateSessionSystem(sessionId: string, system: string): Promise<void>;
  addMessage(
    sessionId: string,
    role: "system" | "user" | "assistant",
    content: string,
    tokens: number
  ): Promise<StoredMessage>;
  getHistory(sessionId: string): Promise<StoredMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(limit?: number, offset?: number): Promise<SessionInfo[]>;
  close(): Promise<void>;
}

export interface MemoryOptions {
  dbPath?: string;
  maxHistoryTokens?: number;
  store?: StoreInterface;
}

export interface PrepareOptions {
  message: string;
  system?: string;
  maxHistoryTokens?: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface PrepareResult {
  messages: Message[];
  system?: string;
  historyTruncated: boolean;
}

export interface RecordOptions {
  userMessage: { content: string };
  assistantMessage: { content: string };
  model?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface SessionInfo {
  id: string;
  system?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalTokens: number;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: "system" | "user" | "assistant";
  content: string;
  tokens: number;
  createdAt: string;
}

export const DEFAULT_MEMORY_OPTIONS = {
  dbPath: ".sabi/chat.db",
  maxHistoryTokens: 16384,
} as const;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
