import type { ProviderHandler, ToolDefInfo } from "./handler";
import type { ProviderCallResult, HandlerMessage, ToolCall } from "../types";

function formatMessages(messages: HandlerMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      result.push({ role: "system", content: m.content ?? "" });
    } else if (m.role === "user") {
      result.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "tool") {
      const tm = m as { tool_call_id: string; content: string };
      result.push({
        role: "tool",
        tool_call_id: tm.tool_call_id,
        content: [{ type: "text", text: tm.content }],
      });
    } else if (m.role === "assistant") {
      const msg = m as { content: string | null; tool_calls?: ToolCall[] };
      const entry: Record<string, unknown> = { role: "assistant" };

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Cohere wants empty content array when tool_calls are present
        entry.content = msg.content ? [{ type: "text", text: msg.content }] : [];
        entry.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        }));
      } else {
        entry.content = msg.content ? [{ type: "text", text: msg.content }] : [];
      }

      result.push(entry);
    }
  }
  return result;
}

function formatTools(tools?: ToolDefInfo[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

const TOOL_CHOICE_MAP: Record<string, string> = {
  required: "REQUIRED",
  none: "NONE",
};

export const cohereHandler: ProviderHandler = {
  buildUrl(baseUrl: string, _modelId: string, _stream: boolean): string {
    return `${baseUrl}/v2/chat`;
  },

  buildHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  },

  buildBody(
    modelId: string,
    messages: HandlerMessage[],
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string | string[];
      stream: boolean;
      includeUsage?: boolean;
      responseFormat?: Record<string, unknown>;
      tools?: ToolDefInfo[];
      toolChoice?: string;
    }
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: formatMessages(messages),
      stream: params.stream,
    };

    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
    if (params.topP !== undefined) body.p = params.topP;
    if (params.stop !== undefined) {
      body.stop_sequences = Array.isArray(params.stop) ? params.stop : [params.stop];
    }
    if (params.responseFormat !== undefined) body.response_format = params.responseFormat;

    const tools = formatTools(params.tools);
    if (tools) body.tools = tools;

    if (params.toolChoice) {
      const mapped = TOOL_CHOICE_MAP[params.toolChoice.toLowerCase()];
      if (mapped) body.tool_choice = mapped;
    }

    return body;
  },

  parseResponse(data: unknown): ProviderCallResult {
    const d = data as Record<string, unknown>;

    // Extract content from message.content[] array
    const message = d.message as Record<string, unknown> | undefined;
    let content = "";
    if (message) {
      const contentBlocks = message.content as
        | Array<{ type?: string; text?: string; thinking?: string }>
        | undefined;
      if (contentBlocks) {
        for (const block of contentBlocks) {
          if (block.type === "text" || !block.type) {
            content += block.text ?? "";
          } else if (block.type === "thinking") {
            content += block.thinking ?? "";
          }
        }
      }
    }

    // Extract tool calls
    const toolCallBlocks = message?.tool_calls as
      | Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>
      | undefined;
    const toolCalls: ToolCall[] | undefined = toolCallBlocks
      ?.filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id ?? "",
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? "{}",
      }));

    // Extract usage from tokens object
    const usage = d.usage as
      | { tokens?: { input_tokens?: number; output_tokens?: number } }
      | undefined;
    const tokenUsage = usage?.tokens;

    return {
      content,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: tokenUsage
        ? {
            promptTokens: tokenUsage.input_tokens ?? 0,
            completionTokens: tokenUsage.output_tokens ?? 0,
            totalTokens: (tokenUsage.input_tokens ?? 0) + (tokenUsage.output_tokens ?? 0),
          }
        : undefined,
    };
  },

  parseStreamChunk(data: unknown): { content: string; done: boolean } | null {
    const d = data as { type?: string; delta?: Record<string, unknown> };

    if (d.type === "content-delta") {
      const delta = d.delta as
        | { message?: { content?: { text?: string; thinking?: string } } }
        | undefined;
      const content = delta?.message?.content;
      const text = content?.text ?? content?.thinking ?? "";
      return { content: text, done: false };
    }

    if (d.type === "message-end") {
      return { content: "", done: true };
    }

    // Skip: message-start, content-start, content-end, tool-plan-delta,
    // tool-call-start, tool-call-delta, tool-call-end, citation-start, citation-end
    return null;
  },

  parseStreamUsage(
    data: unknown
  ): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    const d = data as {
      type?: string;
      delta?: {
        usage?: {
          tokens?: { input_tokens?: number; output_tokens?: number };
        };
      };
    };

    if (d.type !== "message-end") return null;
    const usage = d.delta?.usage?.tokens;
    if (!usage) return null;
    if (usage.input_tokens == null && usage.output_tokens == null) return null;

    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    return {
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
    };
  },
};
