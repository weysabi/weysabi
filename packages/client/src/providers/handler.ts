import type { ProviderCallResult, HandlerMessage } from "../types";

export interface ToolDefInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderHandler {
  buildUrl(baseUrl: string, modelId: string): string;
  buildHeaders(apiKey: string): Record<string, string>;
  buildBody(
    modelId: string,
    messages: HandlerMessage[],
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string | string[];
      stream: boolean;
      responseFormat?: Record<string, unknown>;
      tools?: ToolDefInfo[];
      toolChoice?: string;
    }
  ): Record<string, unknown>;
  parseResponse(data: unknown): ProviderCallResult;
  parseStreamChunk(data: unknown): { content: string; done: boolean } | null;
  parseStreamUsage(
    data: unknown
  ): { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}
