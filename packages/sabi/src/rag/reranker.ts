import type { RagSearchResult } from "./types";

export type Reranker = (query: string, results: RagSearchResult[]) => Promise<RagSearchResult[]>;

export async function identityReranker(
  _query: string,
  results: RagSearchResult[]
): Promise<RagSearchResult[]> {
  return results;
}

export interface CohereRerankerOptions {
  apiKey: string;
  model?: string;
}

export function createCohereReranker(options: CohereRerankerOptions): Reranker {
  const model = options.model ?? "rerank-english-v3.0";

  return async function cohereReranker(query: string, results: RagSearchResult[]) {
    if (results.length === 0) return results;

    const documents = results.map((r) => r.content);

    const response = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, query, documents }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cohere rerank failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    if (!body.results || !Array.isArray(body.results)) {
      return results;
    }

    const sorted = body.results
      .filter((r) => r.index >= 0 && r.index < results.length)
      .map((r) => ({
        ...results[r.index]!,
        score: r.relevance_score,
      }));

    return sorted;
  };
}
