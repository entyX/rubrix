/**
 * plan.md §20 — "Restructure criteria into original JSON; never republish rubric
 * PDFs/text wholesale."
 *
 * The machine parse copies the official sheet's wording verbatim. That text is the orgs'
 * IP and must not be redistributed. This rewrites the PROSE (descriptions and level
 * descriptors) into our own words.
 *
 * IT MUST NOT TOUCH A SINGLE NUMBER. Criterion ids, names, max_points and every level's
 * points/label are verified byte-identical afterwards; if any of them moved, the rewrite
 * is REJECTED and the original file is left alone. The points are what drive the score —
 * a paraphrase pass that silently shifted one would be far worse than the problem it solves.
 *
 * Run: npm run paraphrase-rubrics
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { generate, MAX_OUTPUT_TOKENS, THINKING_BUDGET } from '@/lib/ai/gemini';
import { PARAPHRASE_SYSTEM, PROMPT_VERSION_PARAPHRASE } from '@/lib/ai/prompts';
import { stripFences } from '@/lib/ai/json';
import { RubricJSON } from '@/lib/ai/schemas';

const SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string', description: 'REWRITTEN in original wording' },
          levels: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                points: { type: 'number' },
                descriptor: { type: 'string', description: 'REWRITTEN in original wording' },
              },
              required: ['label', 'points', 'descriptor'],
            },
          },
        },
        required: ['id', 'description'],
      },
    },
  },
  required: ['criteria'],
} as const;

interface Level {
  label: string;
  points: number;
  descriptor: string;
}
interface Criterion {
  id: string;
  name: string;
  description: string;
  max_points: number;
  levels?: Level[];
}

// readdir({recursive}) rather than fs.glob — glob works at runtime but isn't in @types/node.
const files = (await readdir('rubrics', { recursive: true }))
  .map((f) => `rubrics/${String(f).replace(/\\/g, '/')}`)
  .filter((f) => f.endsWith('.rubric.json') && !f.includes('/_'))
  .sort();

console.log(`paraphrasing ${files.length} rubric(s) · ${PROMPT_VERSION_PARAPHRASE}\n`);

let done = 0;
let skipped = 0;
let rejected = 0;
let cost = 0;

for (const file of files) {
  const j = JSON.parse(await readFile(file, 'utf8')) as {
    title: string;
    criteria: Criterion[];
    _review?: { paraphrased?: boolean };
  };

  if (j._review?.paraphrased) {
    skipped++;
    continue;
  }

  const runId = randomUUID().slice(0, 8);
  try {
    const res = await generate({
      system: PARAPHRASE_SYSTEM,
      user: JSON.stringify({ criteria: j.criteria }),
      responseSchema: SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.rubricParse,
      temperature: 0.4, // some lexical variety is the whole point here
      thinkingBudget: THINKING_BUDGET.light,
      promptVersion: PROMPT_VERSION_PARAPHRASE,
      runId,
      label: `paraphrase:${file.split('/').pop()}`,
    });
    cost += res.costCents;

    const out = JSON.parse(stripFences(res.text)) as { criteria: Criterion[] };
    const byId = new Map(out.criteria.map((c) => [c.id, c]));

    // ── the guard rail. Numbers are facts; prose is ours.
    const problems: string[] = [];
    const rebuilt: Criterion[] = j.criteria.map((orig) => {
      const rw = byId.get(orig.id);
      if (!rw) {
        problems.push(`missing criterion ${orig.id}`);
        return orig;
      }
      const levels = orig.levels?.map((lv, i) => {
        const nl = rw.levels?.[i];
        if (!nl) {
          problems.push(`${orig.id}: level ${i} missing`);
          return lv;
        }
        if (nl.points !== lv.points || nl.label !== lv.label) {
          problems.push(`${orig.id}: level ${i} changed points/label`);
          return lv;
        }
        return { ...lv, descriptor: nl.descriptor || lv.descriptor };
      });

      return {
        ...orig, // id, name, max_points come from the ORIGINAL, always
        description: rw.description || orig.description,
        ...(levels ? { levels } : {}),
      };
    });

    if (problems.length) {
      console.log(`❌ ${file.split('/').pop()} — rejected: ${problems[0]}`);
      rejected++;
      continue;
    }

    const next = { ...j, criteria: rebuilt };
    const check = RubricJSON.safeParse(next);
    if (!check.success) {
      console.log(`❌ ${file.split('/').pop()} — rejected: no longer valid RubricJSON`);
      rejected++;
      continue;
    }

    // Final belt-and-braces: the point total must be unchanged.
    const before = j.criteria.reduce((a, c) => a + c.max_points, 0);
    const after = rebuilt.reduce((a, c) => a + c.max_points, 0);
    if (before !== after) {
      console.log(`❌ ${file.split('/').pop()} — rejected: total moved ${before} -> ${after}`);
      rejected++;
      continue;
    }

    await writeFile(
      file,
      JSON.stringify(
        {
          ...next,
          _review: {
            ...(j._review ?? {}),
            paraphrased: true,
            paraphrase_prompt_version: PROMPT_VERSION_PARAPHRASE,
            paraphrase_note:
              'Descriptions and level descriptors are restated in our own words (plan.md §20). Criterion names and every point value are exactly as published on the official rating sheet.',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    console.log(`✅ ${file.split('/').pop()} — ${rebuilt.length} criteria, ${after} pts (unchanged)`);
    done++;
  } catch (err) {
    console.log(`❌ ${file.split('/').pop()} — ${(err as Error).message.split('\n')[0].slice(0, 70)}`);
    rejected++;
  }
}

console.log(
  `\nrewritten ${done} · skipped ${skipped} · rejected ${rejected} · cost ${(cost / 100).toFixed(2)} USD`,
);
