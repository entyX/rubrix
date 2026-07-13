/**
 * SERVER ONLY — touches the filesystem. Client components must import from ./types.
 *
 * The catalog is generated from the official guidelines PDFs by `npm run catalog`, which
 * reads each event's OWN stated "Event Category" line rather than guessing at FBLA's
 * taxonomy (CLAUDE.md: "Do not guess at FBLA rules").
 *
 * An event is only gradeable once a human has hand-structured its rubric. Until then it
 * shows as "not set up" — we never grade on a rubric nobody reviewed (plan.md F3).
 */
import 'server-only';
import { readFile } from 'node:fs/promises';
import { Catalog, type CatalogEvent } from './types';

export async function loadCatalog(): Promise<CatalogEvent[]> {
  try {
    const raw: unknown = JSON.parse(await readFile('rubrics/catalog.json', 'utf8'));
    const parsed = Catalog.safeParse(raw);
    if (!parsed.success) {
      console.warn('[catalog] rubrics/catalog.json is malformed — run `npm run catalog`.');
      return [];
    }
    return parsed.data.events;
  } catch {
    // No catalog yet. The sidebar says so rather than rendering an empty shell.
    return [];
  }
}

export { groupByOrg } from './types';
export type { CatalogEvent, OrgSection, Category } from './types';
