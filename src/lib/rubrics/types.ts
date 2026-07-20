/**
 * Client-safe half of the catalog. NO node:fs in here.
 *
 * The sidebar is a client component and imports CATEGORY_LABEL/ORGS from this file.
 * If these lived alongside loadCatalog(), importing them would drag `node:fs` into the
 * browser bundle and the build would (rightly) fail.
 */
import { z } from 'zod';

export const CATEGORIES = ['presentation', 'roleplay', 'chapter'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  presentation: 'Presentation',
  roleplay: 'Role play',
  chapter: 'Chapter',
};

/** plan.md §14 orgs. §11.9's accent colours survive the redesign. */
export const ORGS = [
  { id: 'fbla', name: 'FBLA', color: 'var(--fbla)' },
  { id: 'deca', name: 'DECA', color: 'var(--deca)' },
  { id: 'tsa', name: 'TSA', color: 'var(--tsa)' },
  { id: 'hosa', name: 'HOSA', color: 'var(--hosa)' },
  { id: 'fpspi', name: 'FPSPI', color: 'var(--fpspi)' },
] as const;

export const CatalogEvent = z.object({
  slug: z.string(),
  name: z.string(),
  org: z.string(),
  category: z.enum([...CATEGORIES, 'unclassified']),
  category_source: z.string(),
  source_pdf: z.string(),
  /** Path to the rubric file. null = not parsed yet. */
  rubric: z.string().nullable(),
  /** Only 'confirmed' rubrics may grade anyone (plan.md F3). */
  rubric_status: z.enum(['confirmed', 'unreviewed']).nullable(),
  rubric_warnings: z.array(z.string()).default([]),
  criteria_count: z.number().nullable(),
  total_points: z.number().nullable(),
  time_limit_s: z.number().nullable(),
  /**
   * Whether this event has pre-submission (prejudged) materials — read from the
   * guidelines PDF's own wording by build-catalog, never guessed (D-021).
   * null = catalog predates the field; treated as "no" in the UI until regenerated.
   */
  prejudged: z.boolean().nullable().default(null),
});
export type CatalogEvent = z.infer<typeof CatalogEvent>;

export const Catalog = z.object({
  generated_at: z.string(),
  events: z.array(CatalogEvent),
});

export interface OrgSection {
  id: string;
  name: string;
  color: string;
  groups: Array<{ category: Category; events: CatalogEvent[] }>;
  total: number;
  ready: number;
}

export function groupByOrg(events: CatalogEvent[]): OrgSection[] {
  return ORGS.map((org) => {
    const mine = events.filter((e) => e.org === org.id);
    const groups = CATEGORIES.map((category) => ({
      category,
      events: mine.filter((e) => e.category === category),
    })).filter((g) => g.events.length > 0);

    return {
      id: org.id,
      name: org.name,
      color: org.color,
      groups,
      total: mine.length,
      // "Ready" means a human confirmed it — not merely that a machine parsed it.
      ready: mine.filter((e) => e.rubric_status === 'confirmed').length,
    };
  });
}
