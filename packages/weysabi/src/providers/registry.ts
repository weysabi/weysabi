/**
 * Central provider registry — single source of truth for provider metadata.
 *
 * All config surfaces (SDK enum lists, server env vars, CLI help, etc.)
 * derive from this registry instead of maintaining 7 separate lists.
 */

export interface ExtraServerEnvVar {
  var: string;
  type: "string" | "integer";
  required: boolean;
  secret: boolean;
  description: string;
}

export interface ProviderInfo {
  label: string;
  handler: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Server-package env var for the API key (WEYSABI_ prefix). */
  serverEnvVar: string;
  /** Human-readable description shown in --help. */
  serverEnvHint: string;
  /** Whether to auto-discover this provider from env vars. False for local-only providers (ollama). */
  envAutoDiscover: boolean;
  /** Additional server env vars beyond the API key (e.g., region). */
  extraServerEnvVars?: ExtraServerEnvVar[];
}

export const providerRegistry: Record<string, ProviderInfo> = {
  openai: {
    label: "OpenAI",
    handler: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "openai/gpt-4o-mini",
    serverEnvVar: "WEYSABI_OPENAI_API_KEY",
    serverEnvHint: "OpenAI API key",
    envAutoDiscover: true,
  },
  groq: {
    label: "Groq",
    handler: "openai",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "groq/llama-4-scout",
    serverEnvVar: "WEYSABI_GROQ_API_KEY",
    serverEnvHint: "Groq API key",
    envAutoDiscover: true,
  },
  anthropic: {
    label: "Anthropic",
    handler: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "anthropic/claude-3-5-haiku-20241022",
    serverEnvVar: "WEYSABI_ANTHROPIC_API_KEY",
    serverEnvHint: "Anthropic API key",
    envAutoDiscover: true,
  },
  google: {
    label: "Google Gemini",
    handler: "google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "google/gemini-2.0-flash",
    serverEnvVar: "WEYSABI_GOOGLE_API_KEY",
    serverEnvHint: "Google AI API key",
    envAutoDiscover: true,
  },
  mistral: {
    label: "Mistral AI",
    handler: "mistral",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral/mistral-small-latest",
    serverEnvVar: "WEYSABI_MISTRAL_API_KEY",
    serverEnvHint: "Mistral AI API key",
    envAutoDiscover: true,
  },
  nvidia: {
    label: "NVIDIA",
    handler: "openai",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "nvidia/llama-3.1-8b-instruct",
    serverEnvVar: "WEYSABI_NVIDIA_API_KEY",
    serverEnvHint: "NVIDIA API key",
    envAutoDiscover: true,
  },
  deepseek: {
    label: "DeepSeek",
    handler: "openai",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek/deepseek-chat",
    serverEnvVar: "WEYSABI_DEEPSEEK_API_KEY",
    serverEnvHint: "DeepSeek API key",
    envAutoDiscover: true,
  },
  together: {
    label: "Together AI",
    handler: "openai",
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "together/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    serverEnvVar: "WEYSABI_TOGETHER_API_KEY",
    serverEnvHint: "Together AI API key",
    envAutoDiscover: true,
  },
  openrouter: {
    label: "OpenRouter",
    handler: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/meta-llama/llama-3.1-8b-instruct",
    serverEnvVar: "WEYSABI_OPENROUTER_API_KEY",
    serverEnvHint: "OpenRouter API key",
    envAutoDiscover: true,
  },
  perplexity: {
    label: "Perplexity",
    handler: "openai",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultModel: "perplexity/sonar-pro",
    serverEnvVar: "WEYSABI_PERPLEXITY_API_KEY",
    serverEnvHint: "Perplexity API key",
    envAutoDiscover: true,
  },
  xai: {
    label: "xAI",
    handler: "openai",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "xai/grok-2-latest",
    serverEnvVar: "WEYSABI_XAI_API_KEY",
    serverEnvHint: "xAI API key",
    envAutoDiscover: true,
  },
  azure: {
    label: "Azure OpenAI",
    handler: "azure",
    defaultBaseUrl: "https://<YOUR_RESOURCE>.openai.azure.com",
    defaultModel: "azure/gpt-4o",
    serverEnvVar: "WEYSABI_AZURE_API_KEY",
    serverEnvHint: "Azure OpenAI API key",
    envAutoDiscover: true,
  },
  cohere: {
    label: "Cohere",
    handler: "cohere",
    defaultBaseUrl: "https://api.cohere.com",
    defaultModel: "cohere/command-a-plus-05-2026",
    serverEnvVar: "WEYSABI_COHERE_API_KEY",
    serverEnvHint: "Cohere API key",
    envAutoDiscover: true,
  },
  bedrock: {
    label: "Bedrock",
    handler: "bedrock",
    defaultBaseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    defaultModel: "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
    serverEnvVar: "WEYSABI_BEDROCK_API_KEY",
    serverEnvHint: "Bedrock API key (or set AWS_ACCESS_KEY_ID)",
    envAutoDiscover: true,
    extraServerEnvVars: [
      {
        var: "WEYSABI_BEDROCK_REGION",
        type: "string",
        required: false,
        secret: false,
        description: "AWS region for Bedrock (default: us-east-1)",
      },
    ],
  },
  ollama: {
    label: "Ollama",
    handler: "ollama",
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "ollama/llama3.2",
    serverEnvVar: "WEYSABI_OLLAMA_API_KEY",
    serverEnvHint: "Ollama API key",
    envAutoDiscover: false,
  },
};

/** Provider IDs sorted alphabetically for deterministic iteration. */
export const providerIds = Object.keys(providerRegistry).sort();

/** Providers that can be auto-discovered from env vars (all except local-only providers like ollama). */
export const envDiscoverableProviders = providerIds.filter(
  (id) => providerRegistry[id]!.envAutoDiscover
);
