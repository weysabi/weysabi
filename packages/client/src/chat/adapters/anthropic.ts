import type { ChatAdapter, AdapterRequest, AdapterResponse } from "./adapter";

/**
 * Anthropic Messages API adapter example.
 *
 * ```ts
 * const chat = new ChatSDK("anthropic", {
 *   adapter: new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }),
 *   memory: new ConversationMemory(),
 * });
 * ```
 */
export class AnthropicAdapter implements ChatAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
  }

  async complete(req: AdapterRequest): Promise<AdapterResponse> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        system: req.system,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    return {
      content: data.content.map((c) => c.text).join(""),
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
    };
  }
}
