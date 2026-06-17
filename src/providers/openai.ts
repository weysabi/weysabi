import type { ProviderHandler, ToolDefInfo } from "./handler";
import type { ProviderCallResult, HandlerMessage, ToolCall } from "../types";

function formatMessages(messages: HandlerMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: (m as { tool_call_id: string }).tool_call_id,
        content: m.content,
      };
    }
    const msg = m as { role: string; content: string | null; tool_calls?: ToolCall[] };
    const result: Record<string, unknown> = { role: msg.role, content: msg.content };
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      result.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    return result;
  });
}

function formatTools(tools?: ToolDefInfo[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export const openaiHandler: ProviderHandler = {
  buildUrl(baseUrl: string, _modelId: string) {
    return `${baseUrl}/chat/completions`;
  },

  buildHeaders(apiKey: string) {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  },

  buildBody(modelId: string, messages, params) {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: formatMessages(messages),
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stop !== undefined) body.stop = params.stop;
    if (params.stream) body.stream = true;
    if (params.responseFormat !== undefined) body.response_format = params.responseFormat;
    const tools = formatTools(params.tools);
    if (tools) body.tools = tools;
    if (params.toolChoice) body.tool_choice = params.toolChoice;
    return body;
  },

  parseResponse(data: unknown): ProviderCallResult {
    const d = data as Record<string, unknown>;
    const choices = d.choices as
      | Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>
      | undefined;
    const choice = choices?.[0]?.message;
    const content = choice?.content ?? "";

    const toolCalls: ToolCall[] | undefined = choice?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const usageRaw = d.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    return {
      content,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: usageRaw
        ? {
            promptTokens: usageRaw.prompt_tokens ?? 0,
            completionTokens: usageRaw.completion_tokens ?? 0,
            totalTokens: usageRaw.total_tokens ?? 0,
          }
        : undefined,
    };
  },

  parseStreamChunk(data: unknown) {
    const d = data as Record<string, unknown>;
    const choices = d.choices as
      | Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>
      | undefined;
    const choice = choices?.[0];
    if (!choice) return null;
    return {
      content: choice.delta?.content ?? "",
      done: choice.finish_reason != null,
    };
  },

  parseStreamUsage(data: unknown) {
    const d = data as Record<string, unknown>;
    const usage = d.usage as
      | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      | undefined;
    if (!usage) return null;
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    };
  },
};
