/**
 * D-021 — the `prejudged` flag: read from each guidelines PDF's own wording by
 * build-catalog, never guessed. The schema must accept catalogs generated BEFORE the
 * field existed (null = unknown = the materials card stays hidden).
 */
import { describe, it, expect } from 'vitest';
import { CatalogEvent } from '@/lib/rubrics/types';

const BASE = {
  slug: 'sales-presentation',
  name: 'Sales Presentation',
  org: 'fbla',
  category: 'presentation',
  category_source: 'Presentation',
  source_pdf: 'Sales-Presentation.pdf',
  rubric: 'fbla/presentation/sales-presentation.rubric.json',
  rubric_status: 'confirmed',
  rubric_warnings: [],
  criteria_count: 11,
  total_points: 110,
  time_limit_s: 420,
};

describe('CatalogEvent.prejudged', () => {
  it('defaults to null for catalogs generated before the field existed', () => {
    const parsed = CatalogEvent.parse(BASE);
    expect(parsed.prejudged).toBeNull();
  });

  it('round-trips an explicit true/false from a regenerated catalog', () => {
    expect(CatalogEvent.parse({ ...BASE, prejudged: true }).prejudged).toBe(true);
    expect(CatalogEvent.parse({ ...BASE, prejudged: false }).prejudged).toBe(false);
  });
});
