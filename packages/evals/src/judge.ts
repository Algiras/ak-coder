import type { LLMService } from '@ak-coder/core';

export interface JudgeCriterion {
  type: 'judge';
  description: string;
}

export function judge(description: string): JudgeCriterion {
  return { type: 'judge', description };
}

export class LLMJudge {
  constructor(private llm: LLMService) {}

  async evaluate(
    prompt: string,
    response: string,
    criterion: string
  ): Promise<{ pass: boolean; reasoning: string }> {
    const judgePrompt = `You are a strict quality-control judge evaluating an AI agent's response.

User Prompt: "${prompt}"
Agent Response: "${response}"
Success Criterion: "${criterion}"

Does the agent response meet the criterion? Respond ONLY with valid JSON — no markdown, no commentary:
{"pass": true | false, "reasoning": "concise explanation"}`;

    const result = await this.llm.chat([{ role: 'user', content: judgePrompt }]);
    const raw = result.text.trim();

    try {
      const parsed = JSON.parse(raw);
      return { pass: !!parsed.pass, reasoning: parsed.reasoning || '' };
    } catch {
      const match = raw.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          return { pass: !!parsed.pass, reasoning: parsed.reasoning || '' };
        } catch {}
      }
      return { pass: false, reasoning: `Failed to parse judge JSON: ${raw}` };
    }
  }
}
