import type { Message } from "@weysabi/sabi";
import type { Conversation, ConversationMessage, Project, PromptVersion } from "./types";

export interface ContextAssemblyInput {
  project: Project;
  conversation: Conversation;
  promptVersion?: PromptVersion;
  messages: ConversationMessage[];
  userMessage: ConversationMessage;
  promptInputs?: Record<string, unknown>;
  maxContextTokens?: number;
}

const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
const TEMPLATE_REGEX = /\{(\w+)\}/g;

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function renderTemplate(content: string, values: Record<string, unknown>): string {
  return content.replace(TEMPLATE_REGEX, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}

function toMessage(message: ConversationMessage): Message {
  return {
    role: message.role,
    content: message.content,
  };
}

export function assembleConversationContext(input: ContextAssemblyInput): Message[] {
  const maxContextTokens = input.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const promptInputs = {
    input: input.userMessage.content,
    message: input.userMessage.content,
    ...(input.promptInputs ?? {}),
  };
  const assembled: Message[] = [];
  let remainingTokens = maxContextTokens;

  for (const promptMessage of input.promptVersion?.messages ?? []) {
    const content = renderTemplate(promptMessage.content, promptInputs);
    assembled.push({ ...promptMessage, content });
    remainingTokens -= estimateTokens(content);
  }

  if (input.conversation.summary) {
    const content = `Conversation summary: ${input.conversation.summary}`;
    assembled.push({ role: "system", content });
    remainingTokens -= estimateTokens(content);
  }

  const history = input.messages
    .filter((message) => message.id !== input.userMessage.id)
    .filter((message) => message.status === "complete")
    .filter((message) => message.role !== "system")
    .sort((a, b) => a.createdAt - b.createdAt);

  const selectedHistory: ConversationMessage[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (!message) continue;
    const tokenCount = message.tokenCount ?? estimateTokens(message.content);
    if (remainingTokens - tokenCount <= 0) break;
    selectedHistory.unshift(message);
    remainingTokens -= tokenCount;
  }

  assembled.push(...selectedHistory.map(toMessage));
  assembled.push(toMessage(input.userMessage));

  return assembled;
}
