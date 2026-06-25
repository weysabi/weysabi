import type { ServerError } from "./errors";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoApp = any;

export function ok<T>(c: HonoApp, data: T, status = 200) {
  return c.json(data, status);
}

export function fail(
  c: HonoApp,
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
  return c.json(body, status, headers ?? {});
}

export function fromServerError(c: HonoApp, err: ServerError) {
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
