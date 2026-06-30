import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  toHex,
  sha256,
  parseIniFile,
  formatConverseMessages,
  formatTools,
  formatToolChoice,
  tryParseJson,
} from "./bedrock";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// toHex
// ---------------------------------------------------------------------------

describe("toHex", () => {
  it("encodes empty buffer", () => {
    expect(toHex(new ArrayBuffer(0))).toBe("");
  });

  it("encodes single byte", () => {
    const buf = new Uint8Array([0xab]).buffer;
    expect(toHex(buf)).toBe("ab");
  });

  it("encodes multiple bytes", () => {
    const buf = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
    expect(toHex(buf)).toBe("deadbeef");
  });

  it("zero-pads single-digit values", () => {
    const buf = new Uint8Array([0x0f]).buffer;
    expect(toHex(buf)).toBe("0f");
  });
});

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe("sha256", () => {
  it("hashes empty string", async () => {
    const hash = await sha256("");
    expect(toHex(hash)).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes known string", async () => {
    const hash = await sha256("hello");
    expect(toHex(hash)).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

// ---------------------------------------------------------------------------
// parseIniFile
// ---------------------------------------------------------------------------

describe("parseIniFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync("bedrock-test-");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty for missing file", () => {
    expect(parseIniFile("/nonexistent/file.ini")).toEqual({});
  });

  it("parses a simple INI file", () => {
    const fp = resolve(tmpDir, "credentials");
    writeFileSync(
      fp,
      `[default]
aws_access_key_id = AKIA123
aws_secret_access_key = secret123
`
    );
    const result = parseIniFile(fp);
    expect(result).toEqual({
      default: {
        aws_access_key_id: "AKIA123",
        aws_secret_access_key: "secret123",
      },
    });
  });

  it("handles comments and blank lines", () => {
    const fp = resolve(tmpDir, "credentials");
    writeFileSync(
      fp,
      `# This is a comment
; This is also a comment

[default]
aws_access_key_id = AKIA123
# another comment
aws_secret_access_key = secret123
`
    );
    const result = parseIniFile(fp);
    expect(result).toEqual({
      default: {
        aws_access_key_id: "AKIA123",
        aws_secret_access_key: "secret123",
      },
    });
  });

  it("handles multiple sections", () => {
    const fp = resolve(tmpDir, "credentials");
    writeFileSync(
      fp,
      `[default]
aws_access_key_id = AKIA_DEFAULT

[dev]
aws_access_key_id = AKIA_DEV
aws_secret_access_key = secret_dev
`
    );
    const result = parseIniFile(fp);
    expect(result).toEqual({
      default: { aws_access_key_id: "AKIA_DEFAULT" },
      dev: { aws_access_key_id: "AKIA_DEV", aws_secret_access_key: "secret_dev" },
    });
  });

  it("handles section names with spaces (AWS config format)", () => {
    const fp = resolve(tmpDir, "config");
    writeFileSync(
      fp,
      `[profile dev]
region = us-west-2
`
    );
    const result = parseIniFile(fp);
    expect(result).toEqual({
      "profile dev": { region: "us-west-2" },
    });
  });
});

// ---------------------------------------------------------------------------
// formatConverseMessages
// ---------------------------------------------------------------------------

describe("formatConverseMessages", () => {
  it("formats a simple user message", () => {
    const result = formatConverseMessages([{ role: "user", content: "Hello" }]);
    expect(result).toEqual([{ role: "user", content: [{ text: "Hello" }] }]);
  });

  it("filters out system messages (handled separately)", () => {
    const result = formatConverseMessages([
      { role: "system", content: "You are a bot" },
      { role: "user", content: "Hi" },
    ]);
    expect(result).toEqual([{ role: "user", content: [{ text: "Hi" }] }]);
  });

  it("formats assistant message with content", () => {
    const result = formatConverseMessages([{ role: "assistant", content: "Hello there" }]);
    expect(result).toEqual([{ role: "assistant", content: [{ text: "Hello there" }] }]);
  });

  it("formats assistant message with tool calls", () => {
    const result = formatConverseMessages([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", name: "get_weather", arguments: '{"loc":"NYC"}' }],
      },
    ]);
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: "call_1",
              name: "get_weather",
              input: { loc: "NYC" },
            },
          },
        ],
      },
    ]);
  });

  it("formats assistant message with content and tool calls", () => {
    const result = formatConverseMessages([
      {
        role: "assistant",
        content: "Let me check",
        tool_calls: [{ id: "call_1", name: "get_weather", arguments: '{"loc":"NYC"}' }],
      },
    ]);
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { text: "Let me check" },
          {
            toolUse: {
              toolUseId: "call_1",
              name: "get_weather",
              input: { loc: "NYC" },
            },
          },
        ],
      },
    ]);
  });

  it("formats tool result messages", () => {
    const result = formatConverseMessages([
      { role: "user", content: "What's the weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", name: "get_weather", arguments: '{"loc":"NYC"}' }],
      },
      { role: "tool", tool_call_id: "call_1", content: "Sunny" },
    ]);
    expect(result).toEqual([
      { role: "user", content: [{ text: "What's the weather?" }] },
      {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: "call_1",
              name: "get_weather",
              input: { loc: "NYC" },
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          { toolResult: { toolUseId: "call_1", content: [{ text: "Sunny" }], status: "success" } },
        ],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatTools
// ---------------------------------------------------------------------------

describe("formatTools", () => {
  it("returns undefined when no tools", () => {
    expect(formatTools(undefined)).toBeUndefined();
    expect(formatTools([])).toBeUndefined();
  });

  it("formats tools for Converse API", () => {
    const result = formatTools([
      {
        name: "get_weather",
        description: "Get weather",
        parameters: {
          type: "object",
          properties: { loc: { type: "string" } },
        },
      },
    ]);
    expect(result).toEqual([
      {
        toolSpec: {
          name: "get_weather",
          description: "Get weather",
          inputSchema: {
            json: {
              type: "object",
              properties: { loc: { type: "string" } },
            },
          },
        },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatToolChoice
// ---------------------------------------------------------------------------

describe("formatToolChoice", () => {
  it("returns undefined when no tool choice", () => {
    expect(formatToolChoice(undefined)).toBeUndefined();
  });

  it("maps 'required' to { any: {} }", () => {
    expect(formatToolChoice("required")).toEqual({ any: {} });
  });

  it("maps 'none' to undefined", () => {
    expect(formatToolChoice("none")).toBeUndefined();
  });

  it("maps unknown to { auto: {} }", () => {
    expect(formatToolChoice("auto")).toEqual({ auto: {} });
  });
});

// ---------------------------------------------------------------------------
// tryParseJson
// ---------------------------------------------------------------------------

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns empty object for invalid JSON", () => {
    expect(tryParseJson("not json")).toEqual({});
  });
});
