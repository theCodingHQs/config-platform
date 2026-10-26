/**
 * Live rules: three per machine, all on its status tag.
 *   status → register   the machine record's Status and Status Since follow the machine
 *   downtime starts     a Machine Downtime record when it alarms or stops
 *   downtime ends       that record gets its end time when it runs (or idles) again
 */
import type { DemoMachine } from '../catalog.js';
import type { EntityInfo } from './entities.js';

const DOWN = '(value == "alarm" || value == "stopped")';
const WAS_DOWN = '(previous == "alarm" || previous == "stopped")';

export function rulePlans(machines: readonly DemoMachine[], machine: EntityInfo, downtime: EntityInfo) {
  return machines.flatMap((m) => {
    const tag = `machines.${m.code}.status`;
    const code = JSON.stringify(m.code);
    return [
      {
        name: `${m.name}: status → machine register`,
        enabled: true,
        trigger: { tag, when: 'value != previous && value != null' },
        cooldownSec: 0,
        action: {
          type: 'updateLatest',
          entityId: machine.id,
          match: [{ field: 'code', op: 'equals', value: code }],
          fields: [
            { field: 'status', value: 'value' },
            { field: 'status_since', value: 'ts' },
          ],
        },
      },
      {
        name: `${m.name}: downtime starts`,
        enabled: true,
        trigger: { tag, when: `${DOWN} && !${WAS_DOWN}` },
        cooldownSec: 0,
        action: {
          type: 'createRecord',
          entityId: downtime.id,
          fields: [
            { field: 'machine_code', value: code },
            { field: 'reason', value: 'value' },
            { field: 'started_at', value: 'ts' },
          ],
        },
      },
      {
        name: `${m.name}: downtime ends`,
        enabled: true,
        trigger: { tag, when: `${WAS_DOWN} && !${DOWN}` },
        cooldownSec: 0,
        action: {
          type: 'updateLatest',
          entityId: downtime.id,
          match: [
            { field: 'machine_code', op: 'equals', value: code },
            { field: 'ended_at', op: 'isEmpty' },
          ],
          fields: [{ field: 'ended_at', value: 'ts' }],
        },
      },
    ];
  });
}
