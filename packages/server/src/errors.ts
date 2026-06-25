export class ServerError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly headers?: Record<string, string>;

  constructor(statusCode: number, code: string, message: string, headers?: Record<string, string>) {
    super(message);
    this.name = "ServerError";
    this.statusCode = statusCode;
    this.code = code;
    this.headers = headers;
  }
}

export class AuthError extends ServerError {
  constructor(message = "Incorrect API key provided") {
    super(401, "INVALID_API_KEY", message, { "WWW-Authenticate": "Bearer" });
    this.name = "AuthError";
  }
}

export class InsufficientPermissionsError extends ServerError {
  constructor(scope: string) {
    super(403, "INSUFFICIENT_PERMISSIONS", `Insufficient permissions. Required scope: ${scope}`);
    this.name = "InsufficientPermissionsError";
  }
}

export class RateLimitError extends ServerError {
  public readonly retryAfter: number;

  constructor(retryAfter: number) {
    super(429, "RATE_LIMIT_EXCEEDED", `Rate limit exceeded. Try again in ${retryAfter}s.`, {
      "Retry-After": String(retryAfter),
      "X-RateLimit-Remaining": "0",
    });
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class ValidationError extends ServerError {
  constructor(message: string) {
    super(400, "VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ServerError {
  constructor(path: string) {
    super(404, "NOT_FOUND", `Route ${path} not found`);
    this.name = "NotFoundError";
  }
}

export class ProviderError extends ServerError {
  constructor(message: string) {
    super(502, "PROVIDER_ERROR", message);
    this.name = "ProviderError";
  }
}

const CODE_STATUS_MAP: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
  500: "SERVER_ERROR",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
};

export function inferCode(status: number): string {
  return CODE_STATUS_MAP[status] ?? "UNKNOWN_ERROR";
}
