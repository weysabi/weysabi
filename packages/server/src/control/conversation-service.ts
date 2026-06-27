import { z } from "zod";
import type { CompleteRequest, StreamRequest, Weysabi } from "@weysabi/sabi";
import { assembleConversationContext } from "./context";
import { ControlError } from "./errors";
import type { ControlPlaneStore } from "./store";
import type {
  Conversation,
  ConversationMessage,
  ManagedPrompt,
  Project,
  PromptVersion,
  Run,
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
  return error instanceof Error ? error.message : String(error);
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

export function createConversationService(sabi: Weysabi, store: ControlPlaneStore) {
  return {
    async sendMessage(input: SendConversationMessageInput): Promise<SendConversationMessageResult> {
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

      const messages = await store.conversations.listMessages(
        parsed.projectId,
        parsed.conversationId,
        {
          limit: 100,
          offset: 0,
        }
      );
      const context = assembleConversationContext({
        project: project as Project,
        conversation,
        promptVersion: version,
        messages: messages.items,
        userMessage,
        promptInputs: parsed.promptInputs,
      });
      const request: CompleteRequest = {
        model,
        messages: context,
        fallbacks: parsed.fallbacks ?? version?.fallbacks,
        temperature: parsed.temperature ?? version?.temperature,
        maxTokens: parsed.maxTokens ?? version?.maxTokens,
      };

      const run = await store.runs.create({
        projectId: parsed.projectId,
        conversationId: parsed.conversationId,
        userMessageId: userMessage.id,
        promptId: prompt?.id,
        promptVersionId: version?.id,
        requestedModel: modelToString(model),
        status: "pending",
        metadata: parsed.metadata,
      });

      try {
        const response = await sabi.complete(request);
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
          fallbackAttempts: [
            {
              model: response.model,
              provider: response.provider,
              latencyMs: response.latencyMs,
            },
          ],
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
        await store.runs.update(parsed.projectId, run.id, {
          status: "failed",
          errorCode: "RUN_FAILED",
          errorMessage: publicErrorMessage(error),
          completedAt: Date.now(),
        });
        throw error;
      }
    },

    async *streamMessage(input: SendConversationMessageInput): AsyncIterable<ConversationEvent> {
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

      const messages = await store.conversations.listMessages(
        parsed.projectId,
        parsed.conversationId,
        {
          limit: 100,
          offset: 0,
        }
      );
      const context = assembleConversationContext({
        project: project as Project,
        conversation,
        promptVersion: version,
        messages: messages.items,
        userMessage,
        promptInputs: parsed.promptInputs,
      });
      const request: StreamRequest = {
        model,
        messages: context,
        fallbacks: parsed.fallbacks ?? version?.fallbacks,
        temperature: parsed.temperature ?? version?.temperature,
        maxTokens: parsed.maxTokens ?? version?.maxTokens,
      };

      const run = await store.runs.create({
        projectId: parsed.projectId,
        conversationId: parsed.conversationId,
        userMessageId: userMessage.id,
        promptId: prompt?.id,
        promptVersionId: version?.id,
        requestedModel: modelToString(model),
        status: "streaming",
        metadata: parsed.metadata,
      });
      yield { type: "message.created", message: userMessage, run };

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
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          latencyMs: Date.now() - startedAt,
          status: "success",
          completedAt: Date.now(),
        });
        yield { type: "message.completed", message: assistantMessage, run: completedRun };
      } catch (error) {
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
