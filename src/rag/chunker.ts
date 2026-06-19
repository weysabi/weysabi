const SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", ", ", " ", ""];

export interface ChunkResult {
  content: string;
  tokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function splitText(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): ChunkResult[] {
  if (!text || chunkSize <= 0) return [];

  const splits = splitWithSeparators(text, SEPARATORS);
  const chunks: ChunkResult[] = [];
  let current: string[] = [];
  let currentLen = 0;

  function flush(): void {
    if (current.length === 0) return;
    const content = current.join("");
    chunks.push({ content, tokens: estimateTokens(content) });
  }

  for (const split of splits) {
    const splitLen = estimateTokens(split);

    if (currentLen + splitLen > chunkSize && current.length > 0) {
      flush();

      const overlapText = collectOverlap(current, chunkOverlap);
      current = overlapText ? [overlapText] : [];
      currentLen = overlapText ? estimateTokens(overlapText) : 0;
    }

    if (splitLen > chunkSize) {
      if (current.length > 0) {
        current.push(split);
        currentLen += splitLen;
      } else {
        current = [split];
        currentLen = splitLen;
      }
    } else {
      current.push(split);
      currentLen += splitLen;
    }
  }

  if (current.length > 0) {
    flush();
  }

  if (chunks.length === 0) {
    const trimmed = text.trim();
    if (trimmed) {
      chunks.push({ content: trimmed, tokens: estimateTokens(trimmed) });
    }
  }

  return chunks;
}

function splitWithSeparators(text: string, separators: string[]): string[] {
  if (separators.length === 0) return [text];
  const sep = separators[0]!;

  if (sep === "") {
    return text.split("");
  }

  const parts = text.split(sep);
  if (parts.length === 1) {
    return splitWithSeparators(text, separators.slice(1));
  }

  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue;
    if (i < parts.length - 1) {
      const sub = splitWithSeparators(parts[i]!, separators.slice(1));
      result.push(...sub, sep);
    } else {
      const sub = splitWithSeparators(parts[i]!, separators.slice(1));
      result.push(...sub);
    }
  }
  return result;
}

function collectOverlap(chunks: string[], overlapTokens: number): string {
  const reversed = [...chunks].reverse();
  const collected: string[] = [];
  let len = 0;

  for (const chunk of reversed) {
    const chunkTokens = estimateTokens(chunk);
    if (len + chunkTokens > overlapTokens && collected.length > 0) break;
    collected.unshift(chunk);
    len += chunkTokens;
  }

  return collected.join("");
}
