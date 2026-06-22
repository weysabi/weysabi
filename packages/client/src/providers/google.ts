import type { ProviderHandler, ToolDefInfo } from "./handler";
import type { ProviderCallResult, HandlerMessage, ToolCall } from "../types";

function formatMessages(messages: HandlerMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      const tm = m as { tool_call_id: string; content: string };
      return {
        role: "function",
        parts: [
          { functionResponse: { name: tm.tool_call_id, response: { response: tm.content } } },
        ],
      };
    }
    const msg = m as { role: string; content: string | null; tool_calls?: ToolCall[] };
    const parts: Record<string, unknown>[] = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: { name: tc.name, args: tryParse(tc.arguments) },
        });
      }
    }
    return {
      role: msg.role === "assistant" ? "model" : msg.role,
      parts,
    };
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
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export const googleHandler: ProviderHandler = {
  buildUrl(baseUrl: string, modelId: string) {
    return `${baseUrl}/v1beta/models/${modelId}:generateContent`;
  },

  buildHeaders(_apiKey: string) {
    return { "Content-Type": "application/json" };
  },

  buildBody(_modelId: string, messages, params) {
    const contents = formatMessages(messages);

    const body: Record<string, unknown> = { contents };

    const config: Record<string, unknown> = {};
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.maxTokens !== undefined) config.maxOutputTokens = params.maxTokens;
    if (params.topP !== undefined) config.topP = params.topP;
    if (params.stop !== undefined)
      config.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
    if (Object.keys(config).length > 0) body.generationConfig = config;

    const tools = formatTools(params.tools);
    if (tools) body.tools = tools;

    if (params.stream) {
      body.stream = true;
    }

    return body;
  },

  parseResponse(data: unknown): ProviderCallResult {
    const d = data as Record<string, unknown>;
    const candidates = d.candidates as
      | Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: { name: string; args: Record<string, unknown> };
            }>;
          };
          finishReason?: string;
        }>
      | undefined;
    const parts = candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text ?? "").join("");

    const toolCalls: ToolCall[] | undefined = parts
      ?.filter((p) => p.functionCall)
      .map((p) => ({
        id: p.functionCall!.name,
        name: p.functionCall!.name,
        arguments: JSON.stringify(p.functionCall!.args ?? {}),
      }));

    if (!text && (!toolCalls || toolCalls.length === 0)) {
      throw new Error("Empty response content");
    }

    const usageRaw = d.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined;
    return {
      content: text ?? "",
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: usageRaw
        ? {
            promptTokens: usageRaw.promptTokenCount ?? 0,
            completionTokens: usageRaw.candidatesTokenCount ?? 0,
            totalTokens: usageRaw.totalTokenCount ?? 0,
          }
        : undefined,
    };
  },

  parseStreamChunk(data: unknown) {
    const d = data as Record<string, unknown>;
    const candidates = d.candidates as
      | Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>
      | undefined;
    const parts = candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text ?? "").join("");
    const done = candidates?.[0]?.finishReason != null;
    return { content: text ?? "", done };
  },

  parseStreamUsage(data: unknown) {
    const d = data as Record<string, unknown>;
    const usage = d.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined;
    if (!usage) return null;
    return {
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens: usage.candidatesTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? 0,
    };
  },
};
