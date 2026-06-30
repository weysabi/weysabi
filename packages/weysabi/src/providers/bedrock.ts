import type {
  ProviderHandler,
  ToolDefInfo,
  InterceptRequestParams,
  InterceptedRequest,
} from "./handler";
import type { ProviderCallResult, HandlerMessage, ToolCall } from "../types";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// SigV4 signer (Bun Web Crypto API – zero extra deps)
// ---------------------------------------------------------------------------

const { subtle } = globalThis.crypto;

export function toHex(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

export function sha256(data: string | Uint8Array): Promise<ArrayBuffer> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return subtle.digest("SHA-256", buf) as Promise<ArrayBuffer>;
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ] as Array<"sign">);
  return subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)) as Promise<ArrayBuffer>;
}

async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode("AWS4" + secretAccessKey);
  const kDate = await hmacRaw(kSecret, dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
}

// ---------------------------------------------------------------------------
// Mini INI parser for ~/.aws/credentials and ~/.aws/config
// ---------------------------------------------------------------------------

export function parseIniFile(filePath: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  if (!existsSync(filePath)) return result;

  const text = readFileSync(filePath, "utf-8");
  let currentSection = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      result[currentSection] = {};
      continue;
    }
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      const key = kvMatch[1]!.trim();
      const value = kvMatch[2]!.trim();
      result[currentSection]![key] = value;
    }
  }
  return result;
}

function readAwsCredentials(profile: string): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
} {
  const credsFile = resolve(homedir(), ".aws", "credentials");
  const parsed = parseIniFile(credsFile);
  const section = parsed[profile];
  if (!section) return { accessKeyId: "", secretAccessKey: "" };
  return {
    accessKeyId: section.aws_access_key_id ?? "",
    secretAccessKey: section.aws_secret_access_key ?? "",
    sessionToken: section.aws_session_token || undefined,
  };
}

function readAwsRegion(profile: string): string {
  // Check ~/.aws/config (uses [profile name] sections)
  const configFile = resolve(homedir(), ".aws", "config");
  const parsed = parseIniFile(configFile);
  const prefixed = `profile ${profile}`;
  const section = parsed[prefixed] ?? parsed[profile];
  return section?.region ?? "";
}

function resolveAwsProfile(): string {
  return process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || "default";
}

/**
 * Resolve AWS credentials using the standard credential chain:
 *  1. WEYSABI_AWS_* env vars (project-specific override)
 *  2. AWS_* env vars (standard AWS SDK variables)
 *  3. ~/.aws/credentials (INI file, respecting AWS_PROFILE)
 *
 * Region resolution:
 *  1. WEYSABI_BEDROCK_REGION
 *  2. AWS_REGION / AWS_DEFAULT_REGION
 *  3. ~/.aws/config (same profile)
 *  4. us-east-1 (fallback)
 */
function awsCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
} {
  // Env vars take precedence
  const envAccessKey = process.env.WEYSABI_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
  const envSecret =
    process.env.WEYSABI_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "";
  const envSession =
    process.env.WEYSABI_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || undefined;

  // If env vars are set, use them exclusively (no INI file fallback for keys)
  if (envAccessKey && envSecret) {
    const region =
      process.env.WEYSABI_BEDROCK_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1";
    return {
      accessKeyId: envAccessKey,
      secretAccessKey: envSecret,
      sessionToken: envSession,
      region,
    };
  }

  // Fall back to ~/.aws/credentials
  const profile = resolveAwsProfile();
  const fromFile = readAwsCredentials(profile);

  const accessKeyId = fromFile.accessKeyId || envAccessKey;
  const secretAccessKey = fromFile.secretAccessKey || envSecret;
  const sessionToken = fromFile.sessionToken || envSession;

  const region =
    process.env.WEYSABI_BEDROCK_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    readAwsRegion(profile) ||
    "us-east-1";

  return { accessKeyId, secretAccessKey, sessionToken, region };
}

async function interceptBedrockRequest(
  params: InterceptRequestParams
): Promise<InterceptedRequest> {
  const { url, headers, body } = params;
  const { accessKeyId, secretAccessKey, sessionToken, region } = awsCredentials();

  const parsedUrl = new URL(url);
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  // Build canonical request
  const canonicalUri = parsedUrl.pathname;
  const canonicalQuery = parsedUrl.search.replace(/^\?/, "");
  const payloadHash = toHex(await sha256(body));

  const signedHeadersList = ["content-type", "host", "x-amz-date"];
  if (sessionToken) signedHeadersList.push("x-amz-security-token");
  const signedHeadersStr = signedHeadersList.join(";");

  const canonicalHeadersEntries: string[] = [
    `content-type:${headers["content-type"] || "application/json"}\n`,
    `host:${parsedUrl.host}\n`,
    `x-amz-date:${amzDate}\n`,
  ];
  if (sessionToken) canonicalHeadersEntries.push(`x-amz-security-token:${sessionToken}\n`);

  // Sort by header name for canonical form
  canonicalHeadersEntries.sort((a, b) => a.split(":")[0]!.localeCompare(b.split(":")[0]!));

  const canonicalRequest = [
    "POST",
    canonicalUri,
    canonicalQuery,
    ...canonicalHeadersEntries,
    signedHeadersStr,
    payloadHash,
  ].join("\n");

  // String to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    toHex(await sha256(canonicalRequest)),
  ].join("\n");

  // Signature
  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, "bedrock");
  const signature = toHex(await hmacRaw(signingKey, stringToSign));

  // Build returned request
  const signedHeaders: Record<string, string> = {
    ...headers,
    "x-amz-date": amzDate,
    host: parsedUrl.host,
    authorization: `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`,
  };
  if (sessionToken) signedHeaders["x-amz-security-token"] = sessionToken;

  return { url, headers: signedHeaders, body };
}

// ---------------------------------------------------------------------------
// Helpers: Converse message format
// ---------------------------------------------------------------------------

export function formatConverseMessages(
  messages: HandlerMessage[]
): { role: string; content: Record<string, unknown>[] }[] {
  const result: { role: string; content: Record<string, unknown>[] }[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      // System messages are handled separately via the `system` request field
      continue;
    }

    if (m.role === "user") {
      result.push({
        role: "user",
        content: [{ text: m.content ?? "" }],
      });
    } else if (m.role === "assistant") {
      const msg = m as { content: string | null; tool_calls?: ToolCall[] };
      const content: Record<string, unknown>[] = [];
      if (msg.content) content.push({ text: msg.content });
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          content.push({
            toolUse: {
              toolUseId: tc.id,
              name: tc.name,
              input: tryParseJson(tc.arguments),
            },
          });
        }
      }
      if (content.length === 0) content.push({ text: "" });
      result.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      const tm = m as { tool_call_id: string; content: string };
      const prev = result[result.length - 1];
      const toolResultEntry = {
        toolResult: {
          toolUseId: tm.tool_call_id,
          content: [{ text: tm.content }],
          status: "success" as const,
        },
      };
      if (prev && prev.role === "user") {
        // Append to the previous user message if there's a tool result chain
        prev.content.push(toolResultEntry);
      } else {
        result.push({ role: "user", content: [toolResultEntry] });
      }
    }
  }

  return result;
}

export function tryParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function formatSystemMessages(messages: HandlerMessage[]): { text: string }[] | undefined {
  const systemTexts = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content ?? "")
    .filter(Boolean);
  return systemTexts.length > 0 ? systemTexts.map((text) => ({ text })) : undefined;
}

export function formatTools(tools?: ToolDefInfo[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.parameters },
    },
  }));
}

export function formatToolChoice(toolChoice?: string): Record<string, unknown> | undefined {
  if (!toolChoice) return undefined;
  const lower = toolChoice.toLowerCase();
  if (lower === "required") return { any: {} };
  if (lower === "none") return undefined; // omit – model decides
  // For specific tool names, user would pass the tool name
  return { auto: {} };
}

// ---------------------------------------------------------------------------
// Bedrock handler
// ---------------------------------------------------------------------------

export const bedrockHandler: ProviderHandler = {
  buildUrl(baseUrl: string, modelId: string, stream: boolean): string {
    const endpoint = stream ? "converse-stream" : "converse";
    return `${baseUrl}/model/${modelId}/${endpoint}`;
  },

  buildHeaders(_apiKey: string): Record<string, string> {
    // Minimal headers; SigV4 auth is applied via interceptRequest()
    return { "content-type": "application/json" };
  },

  buildBody(
    modelId: string,
    messages: HandlerMessage[],
    params: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      stop?: string | string[];
      stream: boolean;
      includeUsage?: boolean;
      responseFormat?: Record<string, unknown>;
      tools?: ToolDefInfo[];
      toolChoice?: string;
    }
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      messages: formatConverseMessages(messages),
    };

    const system = formatSystemMessages(messages);
    if (system) body.system = system;

    if (
      params.temperature !== undefined ||
      params.maxTokens !== undefined ||
      params.topP !== undefined
    ) {
      const inferenceConfig: Record<string, unknown> = {};
      if (params.temperature !== undefined) inferenceConfig.temperature = params.temperature;
      if (params.maxTokens !== undefined) inferenceConfig.maxTokens = params.maxTokens;
      if (params.topP !== undefined) inferenceConfig.topP = params.topP;
      if (params.stop !== undefined) {
        inferenceConfig.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
      }
      body.inferenceConfig = inferenceConfig;
    }

    const tools = formatTools(params.tools);
    if (tools) {
      body.toolConfig = { tools };
      const tc = formatToolChoice(params.toolChoice);
      if (tc) (body.toolConfig as Record<string, unknown>).toolChoice = tc;
    }

    return body;
  },

  parseResponse(data: unknown): ProviderCallResult {
    const d = data as Record<string, unknown>;
    const output = d.output as
      | { message?: { role?: string; content?: Record<string, unknown>[] } }
      | undefined;
    const message = output?.message;

    let content = "";
    const toolCalls: ToolCall[] = [];

    if (message?.content) {
      for (const block of message.content) {
        if (block.text) {
          content += block.text;
        }
        const toolUse = block.toolUse as
          | { toolUseId?: string; name?: string; input?: Record<string, unknown> }
          | undefined;
        if (toolUse && toolUse.name) {
          toolCalls.push({
            id: toolUse.toolUseId ?? "",
            name: toolUse.name,
            arguments: JSON.stringify(toolUse.input ?? {}),
          });
        }
      }
    }

    const usage = d.usage as
      | { inputTokens?: number; outputTokens?: number; totalTokens?: number }
      | undefined;

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: usage
        ? {
            promptTokens: usage.inputTokens ?? 0,
            completionTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          }
        : undefined,
    };
  },

  parseStreamChunk(data: unknown): { content: string; done: boolean } | null {
    const d = data as Record<string, unknown>;

    // ConverseStream events are wrapped in a single-key envelope
    // e.g. { "contentBlockDelta": { ... } }
    //      { "messageStop": { "stopReason": "end_turn" } }
    //      { "metadata": { "usage": { ... } } }
    const keys = Object.keys(d);
    if (keys.length !== 1) return null;
    const eventType = keys[0]!;

    if (eventType === "contentBlockDelta") {
      const payload = d.contentBlockDelta as
        | {
            delta?: { text?: string };
          }
        | undefined;
      return { content: payload?.delta?.text ?? "", done: false };
    }

    if (eventType === "messageStop") {
      return { content: "", done: true };
    }

    // Skip: contentBlockStart, contentBlockStop, other internal events
    return null;
  },

  parseStreamUsage(
    data: unknown
  ): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    const d = data as Record<string, unknown>;
    const keys = Object.keys(d);
    if (keys.length !== 1) return null;
    const eventType = keys[0]!;

    if (eventType !== "metadata") return null;

    const usage = d.metadata as
      | { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }
      | undefined;
    const u = usage?.usage;
    if (!u) return null;

    return {
      promptTokens: u.inputTokens ?? 0,
      completionTokens: u.outputTokens ?? 0,
      totalTokens: u.totalTokens ?? 0,
    };
  },

  interceptRequest: interceptBedrockRequest,
};
