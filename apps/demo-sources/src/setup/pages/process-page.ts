/** Process Overview: the process area drawing on a full-width page, nothing else in the way */
import { card, header, liveBadge, stack } from './blocks.js';
import type { PageContext, PageSpec } from './context.js';

export function processPage(ctx: PageContext): PageSpec {
  return {
    name: 'Process Overview',
    route: '/machine-monitoring/process',
    icon: 'Gauge',
    draft: {
      schemaVersion: 2,
      id: 'pg_process_overview',
      version: 1,
      route: '/machine-monitoring/process',
      width: 'full',
      state: {},
      dataSources: [],
      root: stack('root', { direction: 'vertical', gap: 16, padding: 24 }, [
        header('po', 'Process Overview', 'Tanks, pumps, conditioners and the line unit, every value live from the control system over MQTT.', [liveBadge('po_live')]),
        card('po_drawing', '', [{ id: 'po_visual', type: 'visual', props: { visualId: ctx.visuals.processOverview } }], { padding: 'none', variant: 'flat' }),
      ]),
    },
  };
}
