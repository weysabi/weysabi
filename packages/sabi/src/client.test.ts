import { describe, expect, it } from "bun:test";
import {
  createSabiClient,
  createSabiProjectClient,
  type SendConversationMessageResult,
  type SabiApiError,
} from "./client";

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function createMockFetch(
  response: Response | ((request: Request) => Response | Promise<Response>)
) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init: init ?? {} });
    if (typeof response === "function") {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return response(request);
    }
    return response;
  }) as typeof fetch;

  return { fetchImpl, requests };
}

describe("Sabi HTTP client", () => {
  it("creates project-scoped managed messages with idempotency", async () => {
    const result: SendConversationMessageResult = {
      conversation: {
        id: "conversation-1",
        projectId: "project-1",
        status: "active",
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      },
      userMessage: {
        id: "message-user",
        projectId: "project-1",
        conversationId: "conversation-1",
        role: "user",
        content: "Hello",
        status: "complete",
        metadata: {},
        createdAt: 1,
      },
      assistantMessage: {
        id: "message-assistant",
        projectId: "project-1",
        conversationId: "conversation-1",
        role: "assistant",
        content: "ok",
        status: "complete",
        metadata: {},
        createdAt: 1,
      },
      run: {
        id: "run-1",
        projectId: "project-1",
        requestedModel: "openai/gpt-4o-mini",
        fallbackAttempts: [],
        status: "success",
        metadata: {},
        createdAt: 1,
      },
      content: "ok",
    };
    const { fetchImpl, requests } = createMockFetch(jsonResponse(result, { status: 201 }));
    const project = createSabiProjectClient({
      baseUrl: "http://localhost:3000/",
      apiKey: "sabi_project_key",
      projectId: "project-1",
      fetch: fetchImpl,
    });

    const response = await project.conversations.messages.send(
      "conversation-1",
      { content: "Hello", model: "openai/gpt-4o-mini" },
      { idempotencyKey: "retry-1" }
    );

    expect(response).toEqual(result);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://localhost:3000/v1/projects/project-1/conversations/conversation-1/messages/send"
    );
    expect(requests[0]?.init.method).toBe("POST");
    expect(new Headers(requests[0]?.init.headers).get("authorization")).toBe(
      "Bearer sabi_project_key"
    );
    expect(new Headers(requests[0]?.init.headers).get("idempotency-key")).toBe("retry-1");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      content: "Hello",
      model: "openai/gpt-4o-mini",
    });
  });

  it("maps promptVersionId to the server promptVersion field", async () => {
    const { fetchImpl, requests } = createMockFetch(jsonResponse({ ok: true }));
    const project = createSabiProjectClient({
      baseUrl: "https://sabi.example",
      apiKey: "sabi_project_key",
      projectId: "project-1",
      fetch: fetchImpl,
    });

    await project.conversations.messages.send("conversation-1", {
      content: "Hello",
      promptVersionId: "version-1",
    });

    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      content: "Hello",
      promptVersion: "version-1",
    });
  });

  it("streams managed conversation events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"content.delta","content":"he"}',
              "",
              'data: {"type":"content.delta","content":"llo"}',
              "",
              "data: [DONE]",
              "",
            ].join("\n")
          )
        );
        controller.close();
      },
    });
    const { fetchImpl, requests } = createMockFetch(
      new Response(stream, { headers: { "content-type": "text/event-stream" } })
    );
    const project = createSabiProjectClient({
      baseUrl: "https://sabi.example",
      apiKey: "sabi_project_key",
      projectId: "project-1",
      fetch: fetchImpl,
    });

    const events = [];
    for await (const event of await project.conversations.messages.stream("conversation-1", {
      content: "Hello",
      model: "openai/gpt-4o-mini",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content.delta", content: "he" },
      { type: "content.delta", content: "llo" },
    ]);
    expect(requests[0]?.url).toBe(
      "https://sabi.example/v1/projects/project-1/conversations/conversation-1/messages/stream"
    );
  });

  it("uses admin project routes and query parameters", async () => {
    const { fetchImpl, requests } = createMockFetch(jsonResponse({ items: [], total: 0 }));
    const client = createSabiClient({
      baseUrl: "https://sabi.example",
      apiKey: "sk-admin",
      fetch: fetchImpl,
    });

    await client.project("project 1").runs.list({
      conversationId: "conversation-1",
      status: "success",
      limit: 10,
    });

    expect(requests[0]?.url).toBe(
      "https://sabi.example/v1/projects/project%201/runs?conversationId=conversation-1&status=success&limit=10"
    );
    expect(requests[0]?.init.method).toBe("GET");
  });

  it("throws a typed API error for non-2xx JSON errors", async () => {
    const { fetchImpl } = createMockFetch(
      jsonResponse(
        {
          error: {
            message: "Insufficient permissions. Required scope: prompts:write",
            code: "INSUFFICIENT_PERMISSIONS",
            details: [{ path: "scopes" }],
          },
        },
        { status: 403 }
      )
    );
    const project = createSabiProjectClient({
      baseUrl: "https://sabi.example",
      apiKey: "sabi_project_key",
      projectId: "project-1",
      fetch: fetchImpl,
    });

    await expect(
      project.prompts.create({ name: "Support", slug: "support" })
    ).rejects.toMatchObject({
      name: "SabiApiError",
      status: 403,
      code: "INSUFFICIENT_PERMISSIONS",
      message: "Insufficient permissions. Required scope: prompts:write",
    } satisfies Partial<SabiApiError>);
  });

  it("throws a typed API error for non-JSON error responses", async () => {
    const { fetchImpl } = createMockFetch(new Response("bad gateway", { status: 502 }));
    const project = createSabiProjectClient({
      baseUrl: "https://sabi.example",
      apiKey: "sabi_project_key",
      projectId: "project-1",
      fetch: fetchImpl,
    });

    await expect(project.prompts.list()).rejects.toMatchObject({
      name: "SabiApiError",
      status: 502,
      message: "bad gateway",
    } satisfies Partial<SabiApiError>);
  });
});
