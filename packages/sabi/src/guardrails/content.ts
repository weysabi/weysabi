import type { ContentCategory, GuardrailAction, GuardrailMatch } from "./types";

interface ContentPattern {
  category: ContentCategory;
  label: string;
  patterns: RegExp[];
}

const patterns: ContentPattern[] = [
  {
    category: "hate",
    label: "Hate speech",
    patterns: [/\b(hate|racist|bigot)\b/i],
  },
  {
    category: "harassment",
    label: "Harassment",
    patterns: [/\b(harass|bully|threaten)\b/i],
  },
  {
    category: "violence",
    label: "Violence",
    patterns: [/\b(kill|murder|torture|bomb|shoot|attack)\b/i],
  },
  {
    category: "sexual",
    label: "Sexual content",
    patterns: [/\b(porn|explicit|sexually)\b/i],
  },
  {
    category: "self_harm",
    label: "Self-harm",
    patterns: [/\b(suicide|self-harm|self-harm|cutting)\b/i],
  },
];

export interface ContentResult {
  flagged: boolean;
  matches: GuardrailMatch[];
}

export function scanContent(
  text: string,
  rules: Partial<Record<ContentCategory, { action: GuardrailAction }>>
): ContentResult {
  const matches: GuardrailMatch[] = [];

  for (const cp of patterns) {
    const rule = rules[cp.category];
    if (!rule || rule.action === "passthrough") continue;

    for (const regex of cp.patterns) {
      if (regex.test(text)) {
        matches.push({
          category: "content",
          subcategory: cp.category,
          action: rule.action,
          message: `${rule.action === "block" ? "Blocked" : "Flagged"}: ${cp.label}`,
        });
        break;
      }
    }
  }

  return { flagged: matches.length > 0, matches };
}
