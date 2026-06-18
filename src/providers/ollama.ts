import type { ProviderHandler, ToolDefInfo } from "./handler";
import type { ProviderCallResult, HandlerMessage, ToolCall } from "../types";

function formatMessages(messages: HandlerMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      const tm = m as { tool_call_id: string; content: string };
      return {
        role: "tool",
        content: tm.content,
      };
    }
    const msg = m as { role: string; content: string | null; tool_calls?: ToolCall[] };
    const result: Record<string, unknown> = { role: msg.role, content: msg.content };
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      result.tool_calls = msg.tool_calls.map((tc) => ({
        type: "function",
        function: { name: tc.name, arguments: tryParse(tc.arguments) },
      }));
    }
    return result;
  });
}

function tryParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function formatTools(tools?: ToolDefInfo[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export const ollamaHandler: ProviderHandler = {
  buildUrl(baseUrl: string, _modelId: string) {
    return `${baseUrl}/api/chat`;
  },

  buildHeaders(_apiKey: string) {
    return { "Content-Type": "application/json" };
  },

  buildBody(modelId: string, messages, params) {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: formatMessages(messages),
      stream: params.stream,
    };

    const options: Record<string, unknown> = {};
    if (params.temperature !== undefined) options.temperature = params.temperature;
    if (params.maxTokens !== undefined) options.num_predict = params.maxTokens;
    if (params.topP !== undefined) options.top_p = params.topP;
    if (params.stop !== undefined) {
      options.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }
    if (Object.keys(options).length > 0) body.options = options;

    const tools = formatTools(params.tools);
    if (tools) body.tools = tools;

    return body;
  },

  parseResponse(data: unknown): ProviderCallResult {
    const d = data as Record<string, unknown>;
    const message = d.message as
      | {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{
            type?: string;
            function?: { name?: string; arguments?: Record<string, unknown> };
          }>;
        }
      | undefined;
    const content = message?.content ?? "";

    const toolCalls: ToolCall[] | undefined = message?.tool_calls
      ?.filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.function?.name ?? "",
        name: tc.function?.name ?? "",
        arguments: JSON.stringify(tc.function?.arguments ?? {}),
      }));

    const promptEvalCount = d.prompt_eval_count as number | undefined;
    const evalCount = d.eval_count as number | undefined;

    if (!content && (!toolCalls || toolCalls.length === 0)) {
      throw new Error("Empty response content");
    }

    return {
      content,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage:
        promptEvalCount != null || evalCount != null
          ? {
              promptTokens: promptEvalCount ?? 0,
              completionTokens: evalCount ?? 0,
              totalTokens: (promptEvalCount ?? 0) + (evalCount ?? 0),
            }
          : undefined,
    };
  },

  parseStreamChunk(data: unknown) {
    const d = data as Record<string, unknown>;
    const message = d.message as { role?: string; content?: string } | undefined;
    const done = (d.done as boolean) ?? false;
    return {
      content: message?.content ?? "",
      done,
    };
  },

  parseStreamUsage(data: unknown) {
    const d = data as Record<string, unknown>;
    if (!(d.done as boolean)) return null;
    const promptEvalCount = d.prompt_eval_count as number | undefined;
    const evalCount = d.eval_count as number | undefined;
    if (promptEvalCount == null && evalCount == null) return null;
    return {
      promptTokens: promptEvalCount ?? 0,
      completionTokens: evalCount ?? 0,
      totalTokens: (promptEvalCount ?? 0) + (evalCount ?? 0),
    };
  },
};
