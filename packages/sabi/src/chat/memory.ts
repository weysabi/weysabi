import { SqliteSessionStore } from "./store";
import type {
  MemoryOptions,
  PrepareOptions,
  PrepareResult,
  RecordOptions,
  SessionInfo,
  StoreInterface,
} from "./types";
import { DEFAULT_MEMORY_OPTIONS, estimateTokens } from "./types";

export class ConversationMemory {
  private store: StoreInterface;
  private options: { maxHistoryTokens: number };

  constructor(options: MemoryOptions = {}) {
    this.options = {
      maxHistoryTokens: options.maxHistoryTokens ?? DEFAULT_MEMORY_OPTIONS.maxHistoryTokens,
    };
    this.store =
      options.store ?? new SqliteSessionStore(options.dbPath ?? DEFAULT_MEMORY_OPTIONS.dbPath);
  }

  async prepare(sessionId: string, opts: PrepareOptions): Promise<PrepareResult> {
    if (!opts.message) throw new Error("ConversationMemory: message is required");
    if (!sessionId) throw new Error("ConversationMemory: sessionId is required");

    const maxTokens = opts.maxHistoryTokens ?? this.options.maxHistoryTokens;
    const session = await this.store.getOrCreateSession(sessionId, opts.system);

    const messages: Array<{ role: string; content: string }> = [];
    const history = await this.store.getHistory(session.id);
    const historyTruncated = this.buildHistory(history, messages, maxTokens);
    messages.push({ role: "user", content: opts.message });

    return {
      messages: messages as PrepareResult["messages"],
      system: opts.system ?? session.system,
      historyTruncated,
    };
  }

  async record(sessionId: string, opts: RecordOptions): Promise<void> {
    const userTokens = estimateTokens(opts.userMessage.content);
    const assistantTokens = estimateTokens(opts.assistantMessage.content);

    await this.store.addMessage(sessionId, "user", opts.userMessage.content, userTokens);
    await this.store.addMessage(
      sessionId,
      "assistant",
      opts.assistantMessage.content,
      assistantTokens
    );
  }

  private buildHistory(
    history: Array<{ role: string; content: string; tokens: number }>,
    target: Array<{ role: string; content: string }>,
    maxTokens: number
  ): boolean {
    let total = 0;
    let truncated = false;

    const selected: Array<{ role: string; content: string }> = [];

    for (let index = history.length - 1; index >= 0; index--) {
      const msg = history[index]!;
      if (total + msg.tokens > maxTokens) {
        truncated = true;
        break;
      }
      selected.push({ role: msg.role, content: msg.content });
      total += msg.tokens;
    }

    selected.reverse();
    target.push(...selected);
    return truncated;
  }

  async getSession(sessionId: string): Promise<SessionInfo | null> {
    return this.store.getSession(sessionId);
  }

  async getHistory(sessionId: string): Promise<Array<{ role: string; content: string }>> {
    const history = await this.store.getHistory(sessionId);
    return history.map((m) => ({ role: m.role, content: m.content }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.store.deleteSession(sessionId);
  }

  async listSessions(limit?: number, offset?: number): Promise<SessionInfo[]> {
    return this.store.listSessions(limit, offset);
  }

  async close(): Promise<void> {
    return this.store.close();
  }
}
