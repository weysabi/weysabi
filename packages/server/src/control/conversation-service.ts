import { z } from "zod";
import { AllModelsFailedError } from "@weysabi/sabi";
import type { CompleteRequest, Message, StreamRequest, Weysabi } from "@weysabi/sabi";
import { assembleConversationContext } from "./context";
import { ControlError, errorMessage } from "./errors";
import type { ControlPlaneStore } from "./store";
import type { QuotaReservation, TokenQuotaConfig, TokenQuotaStore } from "../quota";
import type { RagService } from "./rag-service";
import type {
  Conversation,
  ConversationMessage,
  ManagedPrompt,
  Project,
  PromptVersion,
  Run,
  RunAttempt,
} from "./types";

export const SendConversationMessageInputSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  externalUserId: z.string().optional(),
  content: z.string().min(1),
  prompt: z.string().optional(),
  promptVersion: z.string().optional(),
  promptVersionId: z.string().optional(),
  promptInputs: z.record(z.string(), z.unknown()).default({}),
  model: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  fallbacks: z.array(z.string().min(1)).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  documentIds: z.array(z.string()).default([]),
});

export type SendConversationMessageInput = z.input<typeof SendConversationMessageInputSchema>;

export interface SendConversationMessageResult {
  conversation: Conversation;
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  run: Run;
  content: string;
}

export interface ConversationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ConversationEvent =
  | { type: "message.created"; message: ConversationMessage; run: Run }
  | { type: "content.delta"; content: string }
  | { type: "usage"; usage: ConversationUsage }
  | { type: "message.completed"; message: ConversationMessage; run: Run }
  | { type: "message.interrupted"; message: ConversationMessage; run: Run }
  | { type: "error"; error: { code: string; message: string } };

function modelToString(model: string | string[]): string {
  return Array.isArray(model) ? model.join(",") : model;
}

function publicErrorMessage(error: unknown): string {
  return errorMessage(error);
}

function estimateContextTokens(context: Message[], maxTokens?: number): number {
  const charCount = context.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
    0
  );
  return Math.max(1, Math.ceil(charCount / 4)) + (maxTokens ?? 1024);
}

async function resolvePrompt(
  store: ControlPlaneStore,
  projectId: string,
  promptRef?: string,
  versionRef?: string
): Promise<{ prompt?: ManagedPrompt; version?: PromptVersion }> {
  if (!promptRef && !versionRef) return {};

  let prompt: ManagedPrompt | undefined;
  if (promptRef) {
    prompt =
      (await store.prompts.getPrompt(projectId, promptRef)) ??
      (await store.prompts.getPromptBySlug(projectId, promptRef)) ??
      undefined;
    if (!prompt) {
      throw new ControlError(`Prompt "${promptRef}" not found`, "PROMPT_NOT_FOUND", 404);
    }
  }

  const versionId = versionRef ?? prompt?.publishedVersionId;
  if (!versionId) {
    throw new ControlError(
      `Prompt "${promptRef}" has no published version`,
      "PROMPT_NOT_PUBLISHED",
      400
    );
  }

  const version = await store.prompts.getVersion(projectId, versionId);
  if (!version) {
    throw new ControlError(
      `Prompt version "${versionId}" not found`,
      "PROMPT_VERSION_NOT_FOUND",
      404
    );
  }
  if (prompt && version.promptId !== prompt.id) {
    throw new ControlError(
      `Prompt version "${versionId}" does not belong to prompt "${prompt.id}"`,
      "PROMPT_VERSION_NOT_FOUND",
      404
    );
  }

  if (!prompt) {
    prompt = (await store.prompts.getPrompt(projectId, version.promptId)) ?? undefined;
  }

  return { prompt, version };
}

interface ConversationPreparation {
  parsed: SendConversationMessageInput;
  project: Project;
  conversation: Conversation;
  prompt?: ManagedPrompt;
  version?: PromptVersion;
  model: string | string[];
  userMessage: ConversationMessage;
  context: Message[];
  run: Run;
}

async function prepareConversationMessage(
  store: ControlPlaneStore,
  input: SendConversationMessageInput,
  runStatus: "pending" | "streaming"
): Promise<ConversationPreparation> {
  const parsed = SendConversationMessageInputSchema.parse(input);
  const project = await store.projects.get(parsed.projectId);
  if (!project) {
    throw new ControlError(`Project "${parsed.projectId}" not found`, "PROJECT_NOT_FOUND", 404);
  }

  const conversation = await store.conversations.getConversation(
    parsed.projectId,
    parsed.conversationId
  );
  if (!conversation) {
    throw new ControlError(
      `Conversation "${parsed.conversationId}" not found`,
      "CONVERSATION_NOT_FOUND",
      404
    );
  }
  if (
    parsed.externalUserId &&
    conversation.externalUserId &&
    parsed.externalUserId !== conversation.externalUserId
  ) {
    throw new ControlError(
      `Conversation "${parsed.conversationId}" does not belong to external user "${parsed.externalUserId}"`,
      "CONVERSATION_CONFLICT",
      409
    );
  }

  const { prompt, version } = await resolvePrompt(
    store,
    parsed.projectId,
    parsed.prompt,
    parsed.promptVersion ?? parsed.promptVersionId
  );
  const model = parsed.model ?? version?.model ?? project.settings.defaultModel;
  if (!model) {
    throw new ControlError(
      "A model is required. Configure project settings, prompt version model, or provide model in the request.",
      "CONVERSATION_MODEL_REQUIRED",
      400
    );
  }

  const userMessage = await store.conversations.appendMessage({
    projectId: parsed.projectId,
    conversationId: parsed.conversationId,
    role: "user",
    content: parsed.content,
    status: "complete",
    metadata: parsed.metadata,
  });

  const messages = await store.conversations.listMessages(parsed.projectId, parsed.conversationId, {
    limit: 100,
    offset: 0,
  });
  const context = assembleConversationContext({
    project: project as Project,
    conversation,
    promptVersion: version,
    messages: messages.items,
    userMessage,
    promptInputs: parsed.promptInputs,
  });

  const run = await store.runs.create({
    projectId: parsed.projectId,
    conversationId: parsed.conversationId,
    userMessageId: userMessage.id,
    promptId: prompt?.id,
    promptVersionId: version?.id,
    requestedModel: modelToString(model),
    status: runStatus,
    documentIds: parsed.documentIds,
    metadata: parsed.metadata,
  });

  return { parsed, project, conversation, prompt, version, model, userMessage, context, run };
}

async function injectRagContext(
  ragService: RagService | undefined,
  projectId: string,
  context: Message[],
  documentIds: string[],
  userContent: string
): Promise<void> {
  if (!ragService || documentIds.length === 0) return;
  const engine = ragService.project(projectId);
  const results = await engine.query(userContent, 5);
  if (results.length === 0) return;
  const ragContent = results
    .map((r) => `[Source: ${r.filePath} (score: ${r.score.toFixed(3)})]\n${r.content}`)
    .join("\n\n");
  context.unshift({
    role: "system",
    content: `Relevant context from project documents:\n\n${ragContent}`,
  });
}

export function createConversationService(
  sabi: Weysabi,
  store: ControlPlaneStore,
  quota?: { store: TokenQuotaStore; config?: TokenQuotaConfig },
  ragService?: RagService
) {
  return {
    async sendMessage(input: SendConversationMessageInput): Promise<SendConversationMessageResult> {
      const { parsed, version, conversation, userMessage, model, context, run } =
        await prepareConversationMessage(store, input, "pending");
      await injectRagContext(
        ragService,
        parsed.projectId,
        context,
        parsed.documentIds ?? [],
        parsed.content
      );
      const fallbackAttempts: RunAttempt[] = [];
      const request: CompleteRequest = {
        model,
        messages: context,
        fallbacks: parsed.fallbacks ?? version?.fallbacks,
        temperature: parsed.temperature ?? version?.temperature,
        maxTokens: parsed.maxTokens ?? version?.maxTokens,
        telemetry: {
          onFallback(metadata) {
            fallbackAttempts.push({
              model: metadata.from,
              provider: metadata.from.split("/")[0] ?? "unknown",
              error: metadata.error,
              latencyMs: metadata.latencyMs,
            });
          },
        },
      };

      let quotaReservation: QuotaReservation | undefined;
      const qt = quota;
      if (qt) {
        const estimatedTokens = estimateContextTokens(context, request.maxTokens);
        const result = await qt.store.reserve(parsed.projectId, estimatedTokens, qt.config ?? {});
        if (!result.allowed) {
          throw new ControlError(`Quota exceeded: ${result.reason}`, "QUOTA_EXCEEDED", 429);
        }
        quotaReservation = result.reservation;
      }

      try {
        const response = await sabi.complete(request);
        if (quotaReservation && qt) {
          await qt.store.commit(
            quotaReservation.id,
            response.usage?.totalTokens ?? quotaReservation.reservedTokens
          );
        }
        fallbackAttempts.push({
          model: response.model,
          provider: response.provider,
          latencyMs: response.latencyMs,
        });
        const assistantMessage = await store.conversations.appendMessage({
          projectId: parsed.projectId,
          conversationId: parsed.conversationId,
          role: "assistant",
          content: response.content,
          status: "complete",
          tokenCount: response.usage?.completionTokens,
          metadata: {
            runId: run.id,
            model: response.model,
            provider: response.provider,
          },
        });
        const completedRun = await store.runs.update(parsed.projectId, run.id, {
          assistantMessageId: assistantMessage.id,
          resolvedModel: response.model,
          provider: response.provider,
          fallbackAttempts,
          promptTokens: response.usage?.promptTokens,
          completionTokens: response.usage?.completionTokens,
          totalTokens: response.usage?.totalTokens,
          estimatedCostUsd: response.estimatedCostUsd,
          latencyMs: response.latencyMs,
          status: "success",
          completedAt: Date.now(),
        });

        return {
          conversation,
          userMessage,
          assistantMessage,
          run: completedRun,
          content: response.content,
        };
      } catch (error) {
        if (quotaReservation && qt) {
          await qt.store.release(quotaReservation.id);
        }
        if (error instanceof AllModelsFailedError) {
          const recorded = new Set(fallbackAttempts.map((a) => a.model));
          for (const e of error.errors) {
            if (!recorded.has(e.model)) {
              fallbackAttempts.push({
                model: e.model,
                provider: e.model.split("/")[0] ?? "unknown",
                error: e.error,
              });
              recorded.add(e.model);
            }
          }
        }
        await store.runs.update(parsed.projectId, run.id, {
          fallbackAttempts,
          status: "failed",
          errorCode: "RUN_FAILED",
          errorMessage: publicErrorMessage(error),
          completedAt: Date.now(),
        });
        throw error;
      }
    },

    async *streamMessage(input: SendConversationMessageInput): AsyncIterable<ConversationEvent> {
      const { parsed, version, userMessage, model, context, run } =
        await prepareConversationMessage(store, input, "streaming");
      await injectRagContext(
        ragService,
        parsed.projectId,
        context,
        parsed.documentIds ?? [],
        parsed.content
      );
      yield { type: "message.created", message: userMessage, run };
      const fallbackAttempts: RunAttempt[] = [];
      const request: StreamRequest = {
        model,
        messages: context,
        fallbacks: parsed.fallbacks ?? version?.fallbacks,
        temperature: parsed.temperature ?? version?.temperature,
        maxTokens: parsed.maxTokens ?? version?.maxTokens,
        telemetry: {
          onFallback(metadata) {
            fallbackAttempts.push({
              model: metadata.from,
              provider: metadata.from.split("/")[0] ?? "unknown",
              error: metadata.error,
              latencyMs: metadata.latencyMs,
            });
          },
        },
      };

      let quotaReservation: QuotaReservation | undefined;
      const qt = quota;
      if (qt) {
        const estimatedTokens = estimateContextTokens(context, request.maxTokens);
        const result = await qt.store.reserve(parsed.projectId, estimatedTokens, qt.config ?? {});
        if (!result.allowed) {
          yield {
            type: "error",
            error: { code: "QUOTA_EXCEEDED", message: result.reason },
          };
          return;
        }
        quotaReservation = result.reservation;
      }

      const modelsChain: string[] = Array.isArray(model)
        ? model
        : [model, ...(parsed.fallbacks ?? version?.fallbacks ?? [])];
      let content = "";
      let usage: ConversationUsage | undefined;
      const startedAt = Date.now();
      try {
        for await (const chunk of sabi.stream(request)) {
          if (chunk.content) {
            content += chunk.content;
            yield { type: "content.delta", content: chunk.content };
          }
          if (chunk.usage) {
            usage = chunk.usage;
            yield { type: "usage", usage };
          }
        }

        if (quotaReservation && qt) {
          await qt.store.commit(
            quotaReservation.id,
            usage?.totalTokens ?? quotaReservation.reservedTokens
          );
        }
        const failedModels = new Set(fallbackAttempts.map((a) => a.model));
        const resolvedModel =
          modelsChain.find((m) => !failedModels.has(m)) ?? modelsChain[modelsChain.length - 1]!;
        fallbackAttempts.push({
          model: resolvedModel,
          provider: resolvedModel.split("/")[0] ?? "unknown",
          latencyMs: Date.now() - startedAt,
        });
        const assistantMessage = await store.conversations.appendMessage({
          projectId: parsed.projectId,
          conversationId: parsed.conversationId,
          role: "assistant",
          content,
          status: "complete",
          tokenCount: usage?.completionTokens,
          metadata: { runId: run.id },
        });
        const completedRun = await store.runs.update(parsed.projectId, run.id, {
          assistantMessageId: assistantMessage.id,
          fallbackAttempts,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          latencyMs: Date.now() - startedAt,
          status: "success",
          completedAt: Date.now(),
        });
        yield { type: "message.completed", message: assistantMessage, run: completedRun };
      } catch (error) {
        if (quotaReservation && qt) {
          await qt.store.release(quotaReservation.id);
        }
        if (error instanceof AllModelsFailedError) {
          const recorded = new Set(fallbackAttempts.map((a) => a.model));
          for (const e of error.errors) {
            if (!recorded.has(e.model)) {
              fallbackAttempts.push({
                model: e.model,
                provider: e.model.split("/")[0] ?? "unknown",
                error: e.error,
              });
              recorded.add(e.model);
            }
          }
        }
        const message = publicErrorMessage(error);
        if (content) {
          const assistantMessage = await store.conversations.appendMessage({
            projectId: parsed.projectId,
            conversationId: parsed.conversationId,
            role: "assistant",
            content,
            status: "interrupted",
            tokenCount: usage?.completionTokens,
            metadata: { runId: run.id },
          });
          const interruptedRun = await store.runs.update(parsed.projectId, run.id, {
            assistantMessageId: assistantMessage.id,
            fallbackAttempts,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
            latencyMs: Date.now() - startedAt,
            status: "interrupted",
            errorCode: "RUN_INTERRUPTED",
            errorMessage: message,
            completedAt: Date.now(),
          });
          yield { type: "message.interrupted", message: assistantMessage, run: interruptedRun };
        } else {
          await store.runs.update(parsed.projectId, run.id, {
            fallbackAttempts,
            latencyMs: Date.now() - startedAt,
            status: "failed",
            errorCode: "RUN_FAILED",
            errorMessage: message,
            completedAt: Date.now(),
          });
        }
        yield {
          type: "error",
          error: { code: content ? "RUN_INTERRUPTED" : "RUN_FAILED", message },
        };
      }
    },
  };
}
