import type { ProviderConfig } from "../types";

export interface EmbeddingResult {
  embedding: Float32Array;
  tokens: number;
  model: string;
}

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function embeddingBaseUrl(provider: string): string {
  const urls: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    groq: "https://api.groq.com/openai/v1",
  };
  return urls[provider] ?? `https://api.${provider}.com/v1`;
}

export async function embedText(
  text: string,
  providerConfig: ProviderConfig & { provider: string },
  model?: string
): Promise<EmbeddingResult> {
  const resolvedModel = model ?? DEFAULT_EMBEDDING_MODEL;
  const baseUrl = providerConfig.baseUrl ?? embeddingBaseUrl(providerConfig.provider);

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      input: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embedding failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    usage: { prompt_tokens: number; total_tokens: number };
    model: string;
  };

  const embedding = new Float32Array(json.data[0]!.embedding);
  return {
    embedding,
    tokens: json.usage.prompt_tokens,
    model: json.model,
  };
}

export async function embedBatch(
  texts: string[],
  providerConfig: ProviderConfig & { provider: string },
  model?: string
): Promise<EmbeddingResult[]> {
  const resolvedModel = model ?? DEFAULT_EMBEDDING_MODEL;
  const baseUrl = providerConfig.baseUrl ?? embeddingBaseUrl(providerConfig.provider);

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      input: texts,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Batch embedding failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { prompt_tokens: number; total_tokens: number };
    model: string;
  };

  json.data.sort((a, b) => a.index - b.index);

  return json.data.map((d) => ({
    embedding: new Float32Array(d.embedding),
    tokens: Math.ceil(json.usage.prompt_tokens / texts.length),
    model: json.model,
  }));
}
