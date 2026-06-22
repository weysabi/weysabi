import type { GuardrailMatch } from "./types";

const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";

const CATEGORY_MAP: Record<string, string> = {
  hate: "hate",
  "hate/threatening": "hate",
  harassment: "harassment",
  "harassment/threatening": "harassment",
  violence: "violence",
  "violence/graphic": "violence",
  sexual: "sexual",
  self_harm: "self_harm",
  "self_harm/intent": "self_harm",
  "self_harm/instructions": "self_harm",
};

export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  categoryScores: Record<string, number>;
}

export async function callModeration(
  text: string,
  apiKey: string
): Promise<ModerationResult | null> {
  try {
    const res = await fetch(OPENAI_MODERATION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: text }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const data = body as {
      results?: Array<{
        flagged: boolean;
        categories: Record<string, boolean>;
        category_scores: Record<string, number>;
      }>;
    };
    const result = data.results?.[0];
    if (!result) return null;
    return {
      flagged: result.flagged,
      categories: result.categories,
      categoryScores: result.category_scores,
    };
  } catch {
    return null;
  }
}

export function moderationToMatches(
  result: ModerationResult,
  rules: Record<string, { action?: string }>
): GuardrailMatch[] {
  const matches: GuardrailMatch[] = [];

  for (const [openaiCategory, flagged] of Object.entries(result.categories)) {
    if (!flagged) continue;
    const mappedCategory = CATEGORY_MAP[openaiCategory];
    if (!mappedCategory) continue;
    const rule = rules[mappedCategory];
    if (!rule) continue;
    const action = rule.action ?? "block";
    if (action === "passthrough") continue;

    matches.push({
      category: "content",
      subcategory: mappedCategory,
      action,
      message: `${action === "block" ? "Blocked" : "Flagged"}: ${mappedCategory} (moderation API)`,
      details: {
        openaiCategory,
        score: result.categoryScores[openaiCategory],
      },
    });
  }

  return matches;
}
