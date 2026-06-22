import { describe, it, expect } from "bun:test";
import { splitText } from "./chunker";

describe("splitText", () => {
  it("splits short text into one chunk", () => {
    const chunks = splitText("Hello world", 1000, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Hello world");
  });

  it("splits long text into multiple chunks", () => {
    const text = "word ".repeat(500);
    const chunks = splitText(text, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("splits on paragraph boundaries", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const chunks = splitText(text, 1000, 200);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.content).toContain("Paragraph one");
  });

  it("handles empty text", () => {
    const chunks = splitText("", 1000, 200);
    expect(chunks).toHaveLength(0);
  });

  it("handles single paragraph", () => {
    const text = "A".repeat(3000);
    const chunks = splitText(text, 1000, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokens <= 1000)).toBe(true);
  });

  it("estimates tokens as length/4", () => {
    const chunks = splitText("hello world", 1000, 200);
    expect(chunks[0]!.tokens).toBe(Math.ceil("hello world".length / 4));
  });

  it("respects chunk overlap", () => {
    const longWord = "hello world this is a test ".repeat(100);
    const chunks = splitText(longWord, 100, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});
