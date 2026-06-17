import { z } from "zod";

export const MessageRoleSchema = z.enum(["system", "user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

const RetryOptionsSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).optional(),
  statusCodes: z.array(z.number().int()).optional(),
  backoffMs: z.number().int().min(100).optional(),
});

const CircuitBreakerOptionsSchema = z.object({
  threshold: z.number().int().min(1).optional(),
  cooldownMs: z.number().int().min(1_000).optional(),
  windowMs: z.number().int().min(1_000).optional(),
});

export const SabiOptionsSchema = z.object({
  prompts: z.record(z.string(), z.string()).optional(),
  timeout: z.number().int().optional(),
  retry: RetryOptionsSchema.optional(),
  circuitBreaker: CircuitBreakerOptionsSchema.optional(),
  telemetry: z.any().optional(),
});
export type SabiOptions = z.input<typeof SabiOptionsSchema>;

export interface ResolvedSabiOptions {
  timeout: number;
  retry: {
    maxRetries: number;
    statusCodes: number[];
    backoffMs: number;
  };
  circuitBreaker: {
    threshold: number;
    cooldownMs: number;
    windowMs: number;
  };
  telemetry?: TelemetryHooks;
}

export function resolveSabiOptions(raw: SabiOptions): ResolvedSabiOptions {
  return {
    timeout: raw.timeout ?? 30_000,
    retry: {
      maxRetries: raw.retry?.maxRetries ?? 2,
      statusCodes: raw.retry?.statusCodes ?? [429, 500, 502, 503, 504],
      backoffMs: raw.retry?.backoffMs ?? 1000,
    },
    circuitBreaker: {
      threshold: raw.circuitBreaker?.threshold ?? 5,
      cooldownMs: raw.circuitBreaker?.cooldownMs ?? 30_000,
      windowMs: raw.circuitBreaker?.windowMs ?? 60_000,
    },
    telemetry: raw.telemetry as TelemetryHooks | undefined,
  };
}

export const CompleteRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(MessageSchema).min(1).optional(),
  prompt: z.string().optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  fallbacks: z.array(z.string()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  schema: z.any().optional(),
  schemaMaxRetries: z.number().int().min(0).max(10).optional(),
});
export type CompleteRequest = z.input<typeof CompleteRequestSchema>;

export interface CompleteResponse<T = unknown> {
  content: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  estimatedCostUsd?: number;
  parsed?: T;
}

export interface ProviderCallResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export const StreamRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(MessageSchema).min(1).optional(),
  prompt: z.string().optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  fallbacks: z.array(z.string()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
});
export type StreamRequest = z.input<typeof StreamRequestSchema>;

export interface StreamChunk {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  done: boolean;
}

export interface CircuitBreakerState {
  failures: number[];
  tripped: boolean;
  trippedAt: number;
}

export interface ResolvedModel {
  provider: string;
  modelId: string;
}

export interface AttemptMetadata {
  model: string;
  provider: string;
  attempt: number;
  timestamp: number;
}

export interface SuccessMetadata {
  model: string;
  provider: string;
  latencyMs: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  estimatedCostUsd?: number;
  attempt: number;
}

export interface FailureMetadata {
  model: string;
  provider: string;
  error: string;
  attempt: number;
  timestamp: number;
  willRetry: boolean;
}

export interface FallbackMetadata {
  from: string;
  to: string;
  error: string;
  remainingFallbacks: number;
}

export interface TelemetryHooks {
  onAttempt?: (metadata: AttemptMetadata) => void;
  onSuccess?: (metadata: SuccessMetadata) => void;
  onFailure?: (metadata: FailureMetadata) => void;
  onFallback?: (metadata: FallbackMetadata) => void;
}
