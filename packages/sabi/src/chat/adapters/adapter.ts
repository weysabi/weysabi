export interface AdapterRequest {
  messages: Array<{ role: string; content: string }>;
  system?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AdapterResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ChatAdapter {
  complete(req: AdapterRequest): Promise<AdapterResponse>;
  stream?(req: AdapterRequest): AsyncIterable<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    done: boolean;
  }>;
}
