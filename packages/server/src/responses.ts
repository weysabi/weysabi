import type { Context } from "hono";
import type { ServerError } from "./errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json<T>(c: Context, data: T, init?: number | ResponseInit) {
  return c.json(data, init as any);
}

export function ok<T>(c: Context, data: T, status: number = 200) {
  return json(c, data, status);
}

export function fail(
  c: Context,
  status: number,
  message: string,
  code?: string,
  details?: unknown,
  headers?: Record<string, string>
) {
  const body = {
    error: {
      code: code ?? inferCode(status),
      message,
      ...(details !== undefined && { details }),
    },
  };
  return json(c, body, { status, headers: headers ?? {} });
}

export function fromServerError(c: Context, err: ServerError) {
  return fail(c, err.statusCode, err.message, err.code, undefined, err.headers);
}

function inferCode(status: number): string {
  const map: Record<number, string> = {
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
  return map[status] ?? "UNKNOWN_ERROR";
}
