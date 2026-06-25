import type { PiiCategory, GuardrailAction, GuardrailMatch } from "./types";

export interface PiiPattern {
  category: PiiCategory;
  label: string;
  regex: RegExp;
  group?: number;
}

const patterns: PiiPattern[] = [
  {
    category: "email",
    label: "Email address",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    category: "phone",
    label: "Phone number",
    regex: /(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,
  },
  {
    category: "ssn",
    label: "Social Security Number",
    regex: /\b(?!000|666|9\d{2})\d{3}[-.\s]?(?!00)\d{2}[-.\s]?(?!0000)\d{4}\b/g,
  },
  {
    category: "credit_card",
    label: "Credit card number",
    regex: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
  },
  {
    category: "api_key",
    label: "API key",
    regex: /(?:sk-[a-zA-Z0-9]{20,}|sk-ant-[a-z0-9A-Z]{20,}|gsk_[a-zA-Z0-9]{20,})/g,
  },
  {
    category: "ip",
    label: "IP address",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  },
];

export interface PiiResult {
  matched: boolean;
  matches: GuardrailMatch[];
  redacted: string;
}

export function scanPii(
  text: string,
  rules: Partial<Record<PiiCategory, { action: GuardrailAction }>>,
  customPatterns?: PiiPattern[]
): PiiResult {
  const matches: GuardrailMatch[] = [];
  let redacted = text;

  const allPatterns = [...patterns, ...(customPatterns ?? [])];

  for (const pattern of allPatterns) {
    const rule = rules[pattern.category];
    if (!rule || rule.action === "passthrough") continue;

    const regex = new RegExp(pattern.regex.source, "g");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(redacted)) !== null) {
      const matchedText = match[0];
      matches.push({
        category: "pii",
        subcategory: pattern.category,
        action: rule.action,
        message: `${rule.action === "block" ? "Blocked" : "Detected"}: ${pattern.label}`,
        details: { matched: matchedText },
      });

      if (rule.action === "redact") {
        redacted = redacted.replace(matchedText, "[REDACTED]");
        regex.lastIndex = 0;
      }
    }
  }

  return { matched: matches.length > 0, matches, redacted };
}
