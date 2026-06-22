import { z } from "zod";

export class WeysabiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WeysabiError";
  }
}

export class AllModelsFailedError extends WeysabiError {
  public readonly errors: { model: string; error: string }[];
  public readonly model: string;
  public readonly fallbacks: string[];

  constructor(model: string, fallbacks: string[], errors: { model: string; error: string }[]) {
    const summary =
      errors.length > 0
        ? errors.map((e) => `  » ${e.model}: ${e.error}`).join("\n")
        : "  (no providers attempted)";
    super(`All models failed:\n${summary}`);
    this.name = "AllModelsFailedError";
    this.model = model;
    this.fallbacks = fallbacks;
    this.errors = errors;
  }
}

export class ProviderNotConfiguredError extends WeysabiError {
  constructor(provider: string) {
    super(`Provider "${provider}" is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class CircuitBreakerOpenError extends WeysabiError {
  constructor(
    public readonly provider: string,
    cooldownRemainingMs: number
  ) {
    super(`Circuit breaker open for "${provider}", retry in ${Math.ceil(cooldownRemainingMs)}ms`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class PromptNotFoundError extends WeysabiError {
  constructor(name: string) {
    super(`Prompt template "${name}" not found`);
    this.name = "PromptNotFoundError";
  }
}

export class MissingPromptInputError extends WeysabiError {
  constructor(key: string, name: string) {
    super(`Missing input "${key}" for prompt template "${name}"`);
    this.name = "MissingPromptInputError";
  }
}

export class ProviderRequestError extends WeysabiError {
  constructor(
    public readonly provider: string,
    public readonly model: string,
    public readonly statusCode: number | undefined,
    message: string
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderRequestError";
  }
}

export class MaxToolCallsExceededError extends WeysabiError {
  public readonly maxToolCalls: number;

  constructor(maxToolCalls: number) {
    super(`Max tool call iterations (${maxToolCalls}) exceeded`);
    this.name = "MaxToolCallsExceededError";
    this.maxToolCalls = maxToolCalls;
  }
}

export { GuardrailError } from "./guardrails/errors";

export class SchemaValidationError extends WeysabiError {
  public readonly raw: string;
  public readonly issues: Array<{ path: string; message: string }>;

  constructor(raw: string, cause: unknown) {
    const issues =
      cause instanceof z.ZodError
        ? cause.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          }))
        : [{ path: "", message: cause instanceof Error ? cause.message : String(cause) }];

    const summary = issues.map((i) => `  » ${i.path || "(root)"}: ${i.message}`).join("\n");
    super(`Schema validation failed:\n${summary}`);
    this.name = "SchemaValidationError";
    this.raw = raw;
    this.issues = issues;
  }
}
