import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWeysabi, MaxToolCallsExceededError, WeysabiError, zodToJsonSchema } from "./index";
import { z } from "zod";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
function setFetch(fn: FetchFn): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function toolCallResponse(
  toolCalls: Array<{ name: string; args: Record<string, unknown>; id?: string }>,
  content = ""
) {
  return {
    choices: [
      {
        message: {
          content,
          tool_calls: toolCalls.map((tc, i) => ({
            id: tc.id ?? `call_${i}`,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function textResponse(content: string) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

describe("tool calling", () => {
  describe("single tool call", () => {
    it("executes a tool and returns the final response", async () => {
      const bodies: unknown[] = [];
      let callCount = 0;
      setFetch(async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string));
        callCount++;
        if (callCount === 1) {
          return okResponse(toolCallResponse([{ name: "get_weather", args: { city: "Tokyo" } }]));
        }
        return okResponse(textResponse("The weather in Tokyo is 22°C"));
      });

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
            execute: (args: unknown) => {
              const { city } = args as Record<string, unknown>;
              return `${city}: 22°C`;
            },
          },
        ],
      });

      expect(result.content).toBe("The weather in Tokyo is 22°C");

      const firstBody = bodies[0] as Record<string, unknown>;
      expect((firstBody.messages as Array<Record<string, unknown>>).length).toBe(1);

      const secondBody = bodies[1] as Record<string, unknown>;
      const msgs = secondBody.messages as Array<Record<string, unknown>>;
      expect(msgs.length).toBe(3);
      expect(msgs[0]!.role).toBe("user");
      expect(msgs[1]!.role).toBe("assistant");
      expect((msgs[1] as Record<string, unknown>).tool_calls).toBeDefined();
      expect(msgs[2]!.role).toBe("tool");
      expect(msgs[2]!.content).toBe("Tokyo: 22°C");
    });
  });

  describe("multiple tool calls in one response", () => {
    it("executes multiple tools and returns final response", async () => {
      const bodies: unknown[] = [];
      let callCount = 0;
      setFetch(async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string));
        callCount++;
        if (callCount === 1) {
          return okResponse(
            toolCallResponse([
              { name: "get_weather", args: { city: "Tokyo" }, id: "call_1" },
              { name: "get_weather", args: { city: "London" }, id: "call_2" },
            ])
          );
        }
        return okResponse(textResponse("Tokyo: 22°C, London: 15°C"));
      });

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Weather in Tokyo and London?" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
            execute: (args: unknown) => {
              const { city } = args as Record<string, unknown>;
              return `${city}: 22°C`;
            },
          },
        ],
      });

      expect(result.content).toBe("Tokyo: 22°C, London: 15°C");

      const secondBody = bodies[1] as Record<string, unknown>;
      const msgs = secondBody.messages as Array<Record<string, unknown>>;
      expect(msgs.length).toBe(4);
      expect((msgs[1] as Record<string, unknown>).tool_calls).toBeDefined();
      expect(
        ((msgs[1] as Record<string, unknown>).tool_calls as Array<Record<string, unknown>>).length
      ).toBe(2);
      expect(msgs[2]!.role).toBe("tool");
      expect((msgs[2] as Record<string, unknown>).tool_call_id).toBe("call_1");
      expect(msgs[3]!.role).toBe("tool");
      expect((msgs[3] as Record<string, unknown>).tool_call_id).toBe("call_2");
    });
  });

  describe("multi-turn tool calls", () => {
    it("chains multiple tool call rounds", async () => {
      const bodies: unknown[] = [];
      let callCount = 0;
      setFetch(async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string));
        callCount++;
        if (callCount === 1) {
          return okResponse(
            toolCallResponse([{ name: "search", args: { q: "population of Tokyo" } }])
          );
        }
        if (callCount === 2) {
          return okResponse(toolCallResponse([{ name: "calculate", args: { a: 37, b: 2 } }]));
        }
        return okResponse(textResponse("50% of Tokyo's population is 18.5 million"));
      });

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "What is 50% of Tokyo's population?" }],
        maxToolCalls: 5,
        tools: [
          {
            name: "search",
            description: "Search for information",
            parameters: {
              type: "object",
              properties: { q: { type: "string" } },
              required: ["q"],
            },
            execute: (args: unknown) => {
              const { q } = args as Record<string, unknown>;
              return `${q}: 37 million`;
            },
          },
          {
            name: "calculate",
            description: "Divide two numbers",
            parameters: {
              type: "object",
              properties: { a: { type: "number" }, b: { type: "number" } },
              required: ["a", "b"],
            },
            execute: (args: unknown) => {
              const { a, b } = args as Record<string, number>;
              return ((a ?? 1) / (b ?? 1)).toString();
            },
          },
        ],
      });

      expect(result.content).toBe("50% of Tokyo's population is 18.5 million");
      expect(bodies.length).toBe(3);

      const thirdBody = bodies[2] as Record<string, unknown>;
      const msgs = thirdBody.messages as Array<Record<string, unknown>>;
      expect(msgs.length).toBe(5);
      expect(msgs[2]!.role).toBe("tool");
      expect((msgs[2] as Record<string, unknown>).content).toInclude("37 million");
      expect(msgs[4]!.role).toBe("tool");
      expect((msgs[4] as Record<string, unknown>).content).toBe("18.5");
    });
  });

  describe("tool execution error", () => {
    it("sends error back as tool result when tool throws", async () => {
      const bodies: unknown[] = [];
      let callCount = 0;
      setFetch(async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string));
        callCount++;
        if (callCount === 1) {
          return okResponse(toolCallResponse([{ name: "bad_tool", args: {} }]));
        }
        return okResponse(textResponse("The tool failed"));
      });

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Do something" }],
        tools: [
          {
            name: "bad_tool",
            description: "This tool always fails",
            parameters: { type: "object", properties: {} },
            execute: () => {
              throw new Error("Something went wrong");
            },
          },
        ],
      });

      expect(result.content).toBe("The tool failed");

      const secondBody = bodies[1] as Record<string, unknown>;
      const msgs = secondBody.messages as Array<Record<string, unknown>>;
      const toolResult = msgs[2] as Record<string, unknown>;
      expect(toolResult.role).toBe("tool");
      expect(toolResult.content).toInclude("Something went wrong");
    });
  });

  describe("max tool calls exceeded", () => {
    it("throws MaxToolCallsExceededError", async () => {
      setFetch(async () => okResponse(toolCallResponse([{ name: "echo", args: { msg: "loop" } }])));

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Loop" }],
        maxToolCalls: 3,
        tools: [
          {
            name: "echo",
            description: "Echoes back",
            parameters: {
              type: "object",
              properties: { msg: { type: "string" } },
              required: ["msg"],
            },
            execute: (args: unknown) => {
              const { msg } = args as Record<string, string>;
              return `Echo: ${msg}`;
            },
          },
        ],
      });

      expect(result).rejects.toThrow(MaxToolCallsExceededError);
    });
  });

  describe("tool with Zod schema", () => {
    it("converts Zod schema to JSON schema via zodToJsonSchema", () => {
      const schema = z.object({
        city: z.string().describe("The city name"),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      });

      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe("object");
      const props = jsonSchema.properties as Record<string, unknown>;
      expect(props.city).toEqual({ type: "string", description: "The city name" });
      expect(props.units).toEqual({ type: "string", enum: ["celsius", "fahrenheit"] });
      expect(jsonSchema.required).toEqual(["city"]);
    });

    it("works with tools that use Zod schemas for parameters", async () => {
      let callCount = 0;
      setFetch(async () => {
        callCount++;
        if (callCount === 1) {
          return okResponse(toolCallResponse([{ name: "zod_tool", args: { value: 42 } }]));
        }
        return okResponse(textResponse("Done"));
      });

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Test" }],
        tools: [
          {
            name: "zod_tool",
            description: "A tool with Zod schema",
            parameters: zodToJsonSchema(z.object({ value: z.number() })),
            execute: (args: unknown) => {
              const { value } = args as Record<string, unknown>;
              return `Got ${value}`;
            },
          },
        ],
      });

      expect(result.content).toBe("Done");
    });
  });

  describe("stream + tools rejection", () => {
    it("throws when tools are provided with stream()", async () => {
      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const stream = sabi.stream({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "test",
            description: "test",
            parameters: { type: "object", properties: {} },
            execute: () => "ok",
          },
        ],
      });

      const iterator = stream[Symbol.asyncIterator]();
      const result = iterator.next();
      expect(result).rejects.toThrow(WeysabiError);
    });
  });

  describe("tool calling with fallback", () => {
    it("fails over to fallback model when primary fails during tool loop", async () => {
      const bodies: unknown[] = [];
      let callCount = 0;
      setFetch(async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string));
        callCount++;
        if (callCount === 1) {
          return okResponse(toolCallResponse([{ name: "ping", args: {} }]));
        }
        if (callCount === 2) {
          return new Response("Server error", { status: 500 });
        }
        return okResponse(textResponse("Fallback worked"));
      });

      const sabi = createWeysabi({
        openai: { apiKey: "key" },
        nvidia: { apiKey: "key", baseUrl: "https://nvidia.example.com/v1" },
      });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        fallbacks: ["nvidia/llama-3.1-8b-instruct"],
        messages: [{ role: "user", content: "Test" }],
        tools: [
          {
            name: "ping",
            description: "Pings",
            parameters: { type: "object", properties: {} },
            execute: () => "pong",
          },
        ],
      });

      expect(result.content).toBe("Fallback worked");
    });
  });

  describe("no tools requested — model returns text directly", () => {
    it("returns response without tool loop when no tools defined", async () => {
      setFetch(async () => okResponse(textResponse("Hello world")));

      const sabi = createWeysabi({ openai: { apiKey: "key" } });
      const result = await sabi.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hi" }],
      });

      expect(result.content).toBe("Hello world");
    });
  });
});
