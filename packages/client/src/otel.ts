import type { Plugin, CompleteRequest, CompleteResponse, StreamRequest } from "./types";

export interface OtelSpan {
  setAttribute(key: string, value: unknown): void;
  end(): void;
  recordException(error: Error): void;
  setStatus(status: { code: number; message?: string }): void;
}

export interface OtelTracer {
  startSpan(name: string, options?: { attributes?: Record<string, unknown> }): OtelSpan;
}

export interface OtelPluginOptions {
  tracer: OtelTracer;
  serviceName?: string;
}

export function createOtelPlugin(options: OtelPluginOptions): Plugin {
  const { tracer, serviceName = "sabi" } = options;
  const pendingSpans = new WeakMap<object, OtelSpan>();

  return {
    name: "otel",

    onCompleteRequest(request: CompleteRequest): CompleteRequest {
      const span = tracer.startSpan(`${serviceName}.complete`, {
        attributes: {
          "sabi.model": request.model,
          "sabi.has_fallbacks": (request.fallbacks?.length ?? 0) > 0,
          "sabi.has_tools": (request.tools?.length ?? 0) > 0,
          "sabi.has_schema": request.schema !== undefined,
        },
      });

      pendingSpans.set(request, span);
      return request;
    },

    onCompleteResponse(response: CompleteResponse, request: CompleteRequest): CompleteResponse {
      const span = pendingSpans.get(request);
      if (span) {
        span.setAttribute("sabi.latency_ms", response.latencyMs);
        span.setAttribute("sabi.provider", response.provider);
        span.setAttribute("sabi.estimated_cost_usd", response.estimatedCostUsd);
        if (response.usage) {
          span.setAttribute("sabi.prompt_tokens", response.usage.promptTokens);
          span.setAttribute("sabi.completion_tokens", response.usage.completionTokens);
          span.setAttribute("sabi.total_tokens", response.usage.totalTokens);
        }
        span.end();
        pendingSpans.delete(request);
      }
      return response;
    },

    onStreamRequest(request: StreamRequest): StreamRequest {
      const span = tracer.startSpan(`${serviceName}.stream`, {
        attributes: {
          "sabi.model": request.model,
          "sabi.has_fallbacks": (request.fallbacks?.length ?? 0) > 0,
        },
      });

      pendingSpans.set(request, span);
      return request;
    },

    onError(error: Error, context: { request: CompleteRequest | StreamRequest }): void {
      const span = pendingSpans.get(context.request);
      if (span) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message });
        span.end();
        pendingSpans.delete(context.request);
      }
    },
  };
}
