/**
 * Server component: loads the event catalog off disk, hands it to the client shell.
 * (CLAUDE.md: "server components by default; client only where interaction demands it".)
 */
import { loadCatalog, groupByOrg } from '@/lib/rubrics/catalog';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const events = await loadCatalog();
  return <Shell orgs={groupByOrg(events)} />;
}
