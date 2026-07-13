/**
 * Judge Q&A — plan.md §9.6. Chained after grading, temperature 0.7.
 *
 * Higher temperature than grading is deliberate: scores must be reproducible,
 * questions should feel like a real (slightly unpredictable) judge.
 */
import { generate, MAX_OUTPUT_TOKENS, THINKING_BUDGET } from './gemini';
import { QA_SYSTEM, PROMPT_VERSION_QA, validationRetryMessage, fill } from './prompts';
import { QAJSON, QA_RESPONSE_SCHEMA, type GradingResultJSON } from './schemas';
import { parseModelJson } from './json';
import { addUsage, ZERO_USAGE, type TokenUsage } from './models';

export interface QAResult {
  qa: QAJSON;
  usage: TokenUsage;
  costCents: number;
  promptVersion: string;
  /** §17 M9 acceptance: ">= half targeting sub-85% criteria". Measured, not assumed. */
  weakSpotCoverage: { weakCriteria: string[]; questionsTargetingWeak: number };
}

export async function generateQA(args: {
  grading: GradingResultJSON;
  qaFormatDescription: string;
  runId: string;
}): Promise<QAResult> {
  const { grading, qaFormatDescription, runId } = args;

  const system = fill(QA_SYSTEM, { QA_FORMAT_DESCRIPTION: qaFormatDescription });
  const user = `<grading>${JSON.stringify(grading)}</grading>`;

  let usage: TokenUsage = ZERO_USAGE;
  let cost = 0;
  let qa: QAJSON | null = null;
  let correction = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generate({
      system,
      user: correction === '' ? user : `${user}\n\n${correction}`,
      responseSchema: QA_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.qa,
      temperature: 0.7, // plan.md §9.6
      thinkingBudget: THINKING_BUDGET.light,
      promptVersion: PROMPT_VERSION_QA,
      runId,
      label: attempt === 0 ? 'qa' : 'qa:retry',
    });
    usage = addUsage(usage, res.usage);
    cost += res.costCents;

    const parsed = parseModelJson(res.text, QAJSON);
    if (parsed.ok) {
      qa = parsed.value;
      break;
    }
    if (attempt === 1) {
      throw new Error(`Q&A generation returned unusable JSON: ${parsed.issues}`);
    }
    correction = validationRetryMessage(parsed.issues);
  }

  if (!qa) throw new Error('Q&A generation failed.');

  // Measure whether the questions actually attack the weak spots (§17 M9).
  const weakCriteria = grading.criteria
    .filter((c) => c.max_points > 0 && c.score / c.max_points < 0.85)
    .map((c) => c.criterion_id);

  const haystack = qa.questions.map((q) => `${q.question} ${q.targets}`.toLowerCase());
  const questionsTargetingWeak = haystack.filter((h) =>
    weakCriteria.some((id) => h.includes(id.replace(/_/g, ' ')) || h.includes(id)),
  ).length;

  return {
    qa,
    usage,
    costCents: cost,
    promptVersion: PROMPT_VERSION_QA,
    weakSpotCoverage: { weakCriteria, questionsTargetingWeak },
  };
}
