import type { ProviderHandler, ToolDefInfo } from "./handler";
import type { ProviderCallResult, HandlerMessage, ToolCall } from "../types";

function formatMessages(messages: HandlerMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "tool") {
      const tm = m as { tool_call_id: string; content: string };
      const last = result[result.length - 1];
      if (last && last.role === "user") {
        const content = last.content as Array<Record<string, unknown>>;
        content.push({ type: "tool_result", tool_use_id: tm.tool_call_id, content: tm.content });
      } else {
        result.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: tm.tool_call_id, content: tm.content }],
        });
      }
    } else {
      const msg = m as { role: string; content: string | null; tool_calls?: ToolCall[] };
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tryParse(tc.arguments),
          });
        }
      }
      const role = msg.role === "assistant" ? "assistant" : msg.role;
      result.push({ role, content });
    }
  }
  return result;
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
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export const anthropicHandler: ProviderHandler = {
  buildUrl(baseUrl: string, _modelId: string, _stream: boolean) {
    return `${baseUrl}/v1/messages`;
  },

  buildHeaders(apiKey: string) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  },

  buildBody(modelId: string, messages, params) {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content ?? "")
      .filter(Boolean)
      .join("\n\n");
    const body: Record<string, unknown> = {
      model: modelId,
      messages: formatMessages(messages),
      max_tokens: params.maxTokens ?? 1024,
    };
    if (system) body.system = system;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stop !== undefined) body.stop = params.stop;
    if (params.stream) body.stream = true;
    const tools = formatTools(params.tools);
    if (tools) body.tools = tools;
    return body;
  },

  parseResponse(data: unknown): ProviderCallResult {
    const d = data as Record<string, unknown>;
    const content = d.content as
      | Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>
      | undefined;
    const text = content?.find((c) => c.type === "text")?.text ?? "";
    const toolBlocks = content?.filter((c) => c.type === "tool_use");

    const toolCalls: ToolCall[] | undefined = toolBlocks?.map((tb) => ({
      id: tb.id ?? "",
      name: tb.name ?? "",
      arguments: JSON.stringify(tb.input ?? {}),
    }));

    if (!text && (!toolCalls || toolCalls.length === 0)) {
      throw new Error("Empty response content");
    }

    const usageRaw = d.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      content: text,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: usageRaw
        ? {
            promptTokens: usageRaw.input_tokens ?? 0,
            completionTokens: usageRaw.output_tokens ?? 0,
            totalTokens: (usageRaw.input_tokens ?? 0) + (usageRaw.output_tokens ?? 0),
          }
        : undefined,
    };
  },

  parseStreamChunk(data: unknown) {
    const d = data as Record<string, unknown>;
    const type = d.type as string;

    if (type === "content_block_delta") {
      const delta = d.delta as { type?: string; text?: string } | undefined;
      return { content: delta?.text ?? "", done: false };
    }

    if (type === "message_delta") {
      const delta = d.delta as { stop_reason?: string } | undefined;
      return { content: "", done: delta?.stop_reason != null };
    }

    if (type === "message_stop") {
      return { content: "", done: true };
    }

    return null;
  },

  parseStreamUsage(data: unknown) {
    const d = data as Record<string, unknown>;
    if (d.type !== "message_delta") return null;
    const usage = d.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (!usage) return null;
    return {
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    };
  },
};
