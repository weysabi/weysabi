import type { GuardrailMatch } from "./types";

interface InjectionPattern {
  label: string;
  patterns: RegExp[];
  weight: number;
}

const patterns: InjectionPattern[] = [
  {
    label: "Ignore previous instructions",
    patterns: [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directions|prompts)/i,
      /disregard\s+(all\s+)?(previous|prior|above)/i,
      /forget\s+(all\s+)?(previous|prior|above)/i,
    ],
    weight: 0.9,
  },
  {
    label: "Role-playing jailbreak",
    patterns: [
      /you\s+are\s+(now|free|DAN|unconstrained|unbounded)/i,
      /act\s+as\s+if\s+you\s+(have\s+no\s+restrictions|are\s+not\s+an?\s+ai)/i,
      /pretend\s+(to\s+)?be\s+someone/i,
      /roleplay\s+as/i,
    ],
    weight: 0.8,
  },
  {
    label: "System prompt extraction",
    patterns: [
      /output\s+(your|the)\s+(initial\s+)?(system\s+)?prompt/i,
      /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
      /what\s+(were|are)\s+your\s+(system\s+)?(instructions|prompts)/i,
      /print\s+(your|the)\s+(system\s+)?prompt/i,
      /show\s+me\s+the\s+(system\s+)?prompt/i,
    ],
    weight: 0.85,
  },
  {
    label: "Delimiter confusion",
    patterns: [
      /---*\s*system\s*---*/i,
      /<system>/i,
      /<\/system>/i,
      /role:\s*system/i,
      /\[system\]/i,
    ],
    weight: 0.6,
  },
  {
    label: "Hypothetical manipulation",
    patterns: [
      /in\s+this\s+(hypothetical|fictional|imaginary)\s+(scenario|story)/i,
      /for\s+(educational|research|testing)\s+(purposes|reasons)/i,
      /i\s+need\s+you\s+to\s+(help\s+)?me\s+(understand|learn|test)/i,
    ],
    weight: 0.4,
  },
];

export interface InjectionResult {
  detected: boolean;
  score: number;
  matches: GuardrailMatch[];
}

export function scanInjection(text: string, threshold: number = 0.5): InjectionResult {
  const matches: GuardrailMatch[] = [];
  let maxScore = 0;

  for (const pattern of patterns) {
    for (const regex of pattern.patterns) {
      if (regex.test(text)) {
        matches.push({
          category: "injection",
          subcategory: pattern.label,
          action: "block",
          message: `Prompt injection detected: ${pattern.label}`,
        });
        maxScore = Math.max(maxScore, pattern.weight);
      }
    }
  }

  return {
    detected: maxScore >= threshold,
    score: maxScore,
    matches,
  };
}
