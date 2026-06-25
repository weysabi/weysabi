import type { ChatAdapter, AdapterRequest, AdapterResponse } from "./adapter";

/**
 * OpenAI-compatible chat adapter example.
 *
 * Works with any OpenAI-compatible API (OpenAI, Groq, Together, OpenRouter, etc.)
 * by passing a custom `baseUrl`.
 *
 * ```ts
 * const chat = new ChatSDK("openai", {
 *   adapter: new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY! }),
 *   memory: new ConversationMemory(),
 * });
 * ```
 */
export class OpenAIAdapter implements ChatAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  }

  async complete(req: AdapterRequest): Promise<AdapterResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: "system", content: req.system });
    }
    messages.push(...req.messages);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string | null } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? "",
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
