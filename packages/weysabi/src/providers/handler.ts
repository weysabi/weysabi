import type { ProviderCallResult, HandlerMessage } from "../types";

export interface ToolDefInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderHandler {
  buildUrl(baseUrl: string, modelId: string, stream: boolean): string;
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
      includeUsage?: boolean;
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

  /**
   * Optional async request interceptor for providers requiring request-level
   * transformations (e.g. AWS SigV4 signing, body encryption).
   * Called after buildBody + JSON serialization so the interceptor can hash
   * or transform the payload. Return the full augmented request.
   */
  interceptRequest?: (params: InterceptRequestParams) => Promise<InterceptedRequest>;
}

export interface InterceptRequestParams {
  url: string;
  headers: Record<string, string>;
  body: string;
  modelId: string;
}

export interface InterceptedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}
