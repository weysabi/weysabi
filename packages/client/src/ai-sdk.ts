import type { Weysabi, Message } from "./index";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3Text,
  LanguageModelV3Usage,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { ProviderV3 } from "@ai-sdk/provider";
import { WeysabiError } from "./errors";

export function createWeysabiProvider(sabi: Weysabi): ProviderV3 {
  return {
    specificationVersion: "v3",
    languageModel(modelId: string): LanguageModelV3 {
      return new WeysabiLanguageModel(sabi, modelId);
    },
    embeddingModel(_modelId: string): never {
      throw new WeysabiError(
        "Embedding models are not supported in the AI SDK adapter. Use sabi.complete() directly."
      );
    },
    imageModel(_modelId: string): never {
      throw new WeysabiError("Image models are not supported in the AI SDK adapter.");
    },
  };
}

export class WeysabiLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private sabi: Weysabi;

  constructor(sabi: Weysabi, fullModelId: string) {
    const slashIndex = fullModelId.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(
        `Invalid model format "${fullModelId}" — expected "provider/model" (e.g. "groq/llama-3.1-8b-instant")`
      );
    }
    this.provider = fullModelId.slice(0, slashIndex);
    this.modelId = fullModelId;
    this.sabi = sabi;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    if (options.tools && options.tools.length > 0) {
      throw new WeysabiError(
        "Tools are not supported in the AI SDK adapter. Use sabi.complete() directly for tool calling."
      );
    }

    const result = await this.sabi.complete({
      model: this.modelId,
      messages: convertV3Prompt(options.prompt),
      maxTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      stop: options.stopSequences,
    });

    const usage: LanguageModelV3Usage = {
      inputTokens: {
        total: result.usage?.promptTokens ?? 0,
        noCache: result.usage?.promptTokens ?? 0,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: result.usage?.completionTokens ?? 0,
        text: result.usage?.completionTokens ?? 0,
        reasoning: undefined,
      },
    };

    const content: LanguageModelV3Text[] = [
      {
        type: "text",
        text: result.content,
      },
    ];

    return {
      content,
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
      request: { body: undefined },
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    if (options.tools && options.tools.length > 0) {
      throw new WeysabiError(
        "Tools are not supported in the AI SDK adapter. Use sabi.complete() directly for tool calling."
      );
    }

    const streamIterable = await this.sabi.stream({
      model: this.modelId,
      messages: convertV3Prompt(options.prompt),
      maxTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.topP,
      stop: options.stopSequences,
    });

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        const textId = "0";
        let hasTextStarted = false;

        controller.enqueue({ type: "stream-start", warnings: [] });

        for await (const chunk of streamIterable) {
          if (chunk.done) {
            if (hasTextStarted) {
              controller.enqueue({ type: "text-end", id: textId });
            }
            controller.enqueue({
              type: "finish",
              usage: {
                inputTokens: {
                  total: chunk.usage?.promptTokens ?? 0,
                  noCache: chunk.usage?.promptTokens ?? 0,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: chunk.usage?.completionTokens ?? 0,
                  text: chunk.usage?.completionTokens ?? 0,
                  reasoning: undefined,
                },
              },
              finishReason: { unified: "stop", raw: "stop" },
            });
            break;
          }

          if (chunk.content) {
            if (!hasTextStarted) {
              controller.enqueue({ type: "text-start", id: textId });
              hasTextStarted = true;
            }
            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: chunk.content,
            });
          }
        }

        controller.close();
      },
    });

    return { stream };
  }
}

function convertV3Prompt(prompt: LanguageModelV3Prompt): Message[] {
  return prompt.map((msg) => {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content } as Message;

      case "user": {
        const text = msg.content
          .filter((p): p is LanguageModelV3TextPart => p.type === "text")
          .map((p) => p.text)
          .join("");
        return { role: "user", content: text } as Message;
      }

      case "assistant": {
        const text = msg.content
          .filter((p) => p.type === "text")
          .map((p) => (p as LanguageModelV3TextPart).text)
          .join("");

        const toolCalls = msg.content
          .filter((p): p is LanguageModelV3ToolCallPart => p.type === "tool-call")
          .map((p) => ({
            id: p.toolCallId,
            name: p.toolName,
            arguments: JSON.stringify(p.input),
          }));

        if (toolCalls.length > 0) {
          return {
            role: "assistant",
            content: text,
            tool_calls: toolCalls,
          } as Message;
        }

        return { role: "assistant", content: text } as Message;
      }

      case "tool": {
        const part = msg.content[0];
        if (part?.type === "tool-result") {
          const content =
            typeof part.output === "string" ? part.output : JSON.stringify(part.output);
          return {
            role: "tool",
            tool_call_id: part.toolCallId,
            content,
          } as Message;
        }
        return { role: "user", content: "" } as Message;
      }

      default:
        return { role: "user", content: "" } as Message;
    }
  });
}
