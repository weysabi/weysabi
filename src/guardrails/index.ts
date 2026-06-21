import type { SabiPlugin, CompleteRequest, CompleteResponse, StreamRequest } from "../types";
import type { GuardrailsConfig, GuardrailMatch, TokenLimitAction } from "./types";
import { GuardrailsConfigSchema } from "./types";
import { GuardrailError } from "./errors";
import { scanPii } from "./pii";
import { scanInjection } from "./injection";
import { scanContent } from "./content";
import { callModeration, moderationToMatches } from "./moderation";

export type { GuardrailMatch, GuardrailOptions } from "./types";

type MessageLike = { content: string | null; role?: string };

function messagesText(messages: MessageLike[]): string {
  return messages.map((m) => m.content ?? "").join("\n");
}

function checkInjection(
  text: string,
  config: NonNullable<GuardrailsConfig["input"]>["injection"]
): void {
  if (!config?.block) return;
  const result = scanInjection(text, config.threshold ?? 0.5);
  if (result.detected && result.matches[0]) {
    throw new GuardrailError(result.matches[0]);
  }
}

function blockedMatch(matches: GuardrailMatch[]): GuardrailMatch | undefined {
  return matches.find((m) => m.action === "block");
}

async function augmentWithModeration(
  text: string,
  rules: Record<string, { action?: string }>,
  moderationApiKey: string | undefined
): Promise<GuardrailMatch[]> {
  if (!moderationApiKey || Object.keys(rules).length === 0) return [];
  const result = await callModeration(text, moderationApiKey);
  if (!result) return [];
  return moderationToMatches(result, rules);
}

async function checkContentInput(
  text: string,
  rules: NonNullable<NonNullable<GuardrailsConfig["input"]>["content"]>,
  moderationApiKey?: string
): Promise<void> {
  const regexResult = scanContent(text, rules);
  const firstBlocked = blockedMatch(regexResult.matches);
  if (firstBlocked) throw new GuardrailError(firstBlocked);

  const modMatches = await augmentWithModeration(text, rules, moderationApiKey);
  const firstModBlocked = blockedMatch(modMatches);
  if (firstModBlocked) throw new GuardrailError(firstModBlocked);
}

async function checkContentOutput(
  text: string,
  rules: NonNullable<NonNullable<GuardrailsConfig["output"]>["content"]>,
  moderationApiKey: string | undefined,
  matches: GuardrailMatch[]
): Promise<void> {
  const regexResult = scanContent(text, rules);
  const firstBlocked = blockedMatch(regexResult.matches);
  if (firstBlocked) throw new GuardrailError(firstBlocked);
  matches.push(...regexResult.matches.filter((m) => m.action === "warn"));

  const modMatches = await augmentWithModeration(text, rules, moderationApiKey);
  const firstModBlocked = blockedMatch(modMatches);
  if (firstModBlocked) throw new GuardrailError(firstModBlocked);
  matches.push(...modMatches.filter((m) => m.action === "warn"));
}

function redactPiiInMessages(
  messages: NonNullable<CompleteRequest["messages"]>,
  rules: NonNullable<NonNullable<GuardrailsConfig["input"]>["pii"]>
): NonNullable<CompleteRequest["messages"]> | undefined {
  let changed = false;
  const result = messages.map((m) => {
    if (!m.content) return m;
    const scanned = scanPii(m.content, rules);
    const blocked = scanned.matches.filter((mm) => mm.action === "block");
    if (blocked.length > 0 && blocked[0]) {
      throw new GuardrailError(blocked[0]);
    }
    if (scanned.matches.some((mm) => mm.action === "redact")) {
      changed = true;
      return { ...m, content: scanned.redacted };
    }
    return m;
  });
  return changed ? result : undefined;
}

function redactPiiInText(
  text: string,
  rules: NonNullable<NonNullable<GuardrailsConfig["output"]>["pii"]>,
  matches: GuardrailMatch[]
): string | undefined {
  const scanned = scanPii(text, rules);
  const blocked = scanned.matches.filter((m) => m.action === "block");
  if (blocked.length > 0 && blocked[0]) {
    throw new GuardrailError(blocked[0]);
  }
  matches.push(...scanned.matches.filter((m) => m.action === "warn"));
  if (scanned.matches.some((m) => m.action === "redact")) {
    return scanned.redacted;
  }
  return undefined;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenLimit(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function checkTokenLimit(
  response: CompleteResponse,
  tokenLimit: { maxTokens: number; action: "block" | "warn" | "truncate" },
  matches: GuardrailMatch[]
): string | undefined {
  const tokens = response.usage?.completionTokens ?? estimateTokens(response.content);
  if (tokens <= tokenLimit.maxTokens) return undefined;

  const match: GuardrailMatch = {
    category: "token_limit",
    subcategory: "output",
    action: tokenLimit.action as TokenLimitAction,
    message: `Output token limit exceeded: ${tokens} > ${tokenLimit.maxTokens}`,
    details: { total: tokens, maxTokens: tokenLimit.maxTokens },
  };

  if (tokenLimit.action === "block") {
    throw new GuardrailError(match);
  }

  matches.push(match);

  if (tokenLimit.action === "truncate") {
    return truncateToTokenLimit(response.content, tokenLimit.maxTokens);
  }

  return undefined;
}

export function createGuardrails(config: GuardrailsConfig): SabiPlugin {
  const parsed = GuardrailsConfigSchema.parse(config);
  const apiKey = parsed.moderationApiKey;

  return {
    name: parsed.name,

    async onCompleteRequest(request: CompleteRequest): Promise<CompleteRequest> {
      if (!parsed.input) return request;
      const messages = request.messages ?? [];
      const text = messagesText(messages);

      checkInjection(text, parsed.input.injection);
      await checkContentInput(text, parsed.input.content ?? {}, apiKey);

      if (parsed.input.pii) {
        const redacted = redactPiiInMessages(messages, parsed.input.pii);
        if (redacted) {
          return { ...request, messages: redacted };
        }
      }

      return request;
    },

    async onStreamRequest(request: StreamRequest): Promise<StreamRequest> {
      if (!parsed.input) return request;
      const messages = request.messages ?? [];
      const text = messagesText(messages);

      checkInjection(text, parsed.input.injection);
      await checkContentInput(text, parsed.input.content ?? {}, apiKey);

      if (parsed.input.pii) {
        redactPiiInMessages(messages, parsed.input.pii);
      }

      return request;
    },

    async onCompleteResponse(
      response: CompleteResponse,
      _request: CompleteRequest
    ): Promise<CompleteResponse> {
      if (!parsed.output) return response;

      const matches: GuardrailMatch[] = [];
      let content = response.content;

      if (parsed.output.pii) {
        const redacted = redactPiiInText(content, parsed.output.pii, matches);
        if (redacted !== undefined) content = redacted;
      }

      if (parsed.output.tokenLimit) {
        const truncated = checkTokenLimit(
          { ...response, content },
          parsed.output.tokenLimit,
          matches
        );
        if (truncated !== undefined) content = truncated;
      }

      if (parsed.output.content) {
        await checkContentOutput(content, parsed.output.content, apiKey, matches);
      }

      if (content !== response.content) {
        return { ...response, content };
      }

      return response;
    },
  };
}
