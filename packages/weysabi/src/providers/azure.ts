import type { ProviderHandler } from "./handler";
import { openaiHandler } from "./openai";

/**
 * Azure OpenAI handler.
 *
 * Azure uses the OpenAI-compatible chat format but authenticates with
 * an `api-key` header (not Bearer) and addresses models by deployment
 * name through a resource-specific base URL.
 *
 * Usage in weysabi.json:
 *   providers: { azure: { apiKey: "…", baseUrl: "https://my-resource.openai.azure.com" } }
 *   model: "azure/gpt-4o"   (where "gpt-4o" is the deployment name)
 */
export const azureHandler: ProviderHandler = {
  buildUrl(baseUrl: string, modelId: string, _stream: boolean): string {
    // Accept api-version from base URL query string, fall back to latest stable
    const url = new URL(baseUrl);
    const version = url.searchParams.get("api-version") ?? "2024-08-01-preview";
    url.pathname = `/openai/deployments/${modelId}/chat/completions`;
    url.search = `api-version=${version}`;
    return url.toString();
  },

  buildHeaders(apiKey: string): Record<string, string> {
    return { "api-key": apiKey, "Content-Type": "application/json" };
  },

  buildBody: openaiHandler.buildBody,
  parseResponse: openaiHandler.parseResponse,
  parseStreamChunk: openaiHandler.parseStreamChunk,
  parseStreamUsage: openaiHandler.parseStreamUsage,
};
