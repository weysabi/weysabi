export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const GLOBAL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
  "gpt-4": { inputPer1M: 30, outputPer1M: 60 },
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.8, outputPer1M: 4 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "claude-3-opus-20240229": { inputPer1M: 15, outputPer1M: 75 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.0-flash-lite": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-2.0-pro": { inputPer1M: 1.5, outputPer1M: 6 },
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },
  "llama-4-scout": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "llama-4-maverick": { inputPer1M: 0.2, outputPer1M: 0.8 },
  "llama-3.3-70b": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.2 },
  "llama-3.1-70b": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-405b": { inputPer1M: 2.5, outputPer1M: 2.5 },
  "deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.1 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "mistral-large": { inputPer1M: 2, outputPer1M: 6 },
  "mistral-small": { inputPer1M: 1, outputPer1M: 3 },
};

export function addPricing(entries: Record<string, ModelPricing>): void {
  for (const [model, price] of Object.entries(entries)) {
    GLOBAL_PRICING[model] = price;
  }
}

export function estimateCost(
  modelId: string,
  usage?: { promptTokens: number; completionTokens: number },
  overrides?: Record<string, ModelPricing>
): number | undefined {
  if (usage === undefined) return undefined;
  const price = overrides?.[modelId] ?? GLOBAL_PRICING[modelId];
  if (price === undefined) return undefined;
  const inputCost = (usage.promptTokens / 1_000_000) * price.inputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * price.outputPer1M;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
