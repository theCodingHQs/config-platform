import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LiveServerMessage } from '@config-platform/schema';
import { RecordWatch } from '../src/live/record-watch.js';
import type { RecordChange } from '../src/live/record-events.js';

afterEach(() => vi.useRealTimers());

const setup = (readable: (entityId: string) => boolean = () => true) => {
  vi.useFakeTimers();
  let listener: ((c: RecordChange) => void) | null = null;
  const sent: LiveServerMessage[] = [];
  const canRead = vi.fn(async (id: string) => readable(id));
  const watch = new RecordWatch('t1', { subscribe: (l) => ((listener = l), () => (listener = null)), canRead }, (m) => sent.push(m));
  const change = (entityId: string, entityName = entityId, tenantId = 't1') => listener?.({ tenantId, entityId, entityName });
  return { watch, sent, change, canRead, unsubscribed: () => listener === null };
};

describe('record changes for open pages', () => {
  it('tells a page once about a burst of changes to an entity it shows', async () => {
    const { watch, sent, change } = setup();
    watch.watch(['e_jobs']);
    change('e_jobs', 'maintenance_job');
    change('e_jobs', 'maintenance_job');
    change('e_jobs', 'maintenance_job');
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toEqual([{ type: 'records', entities: [{ entityId: 'e_jobs', entityName: 'maintenance_job' }] }]);
  });

  it('matches pages that refer to an entity by name, and ignores others and other workspaces', async () => {
    const { watch, sent, change } = setup();
    watch.watch(['maintenance_job']);
    change('e_jobs', 'maintenance_job');
    change('e_other', 'quality_inspection');
    change('e_jobs', 'maintenance_job', 't2');
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toHaveLength(1);
    expect((sent[0] as any).entities.map((e: any) => e.entityId)).toEqual(['e_jobs']);
  });

  it("doesn't tell a viewer about entities their role can't read (asked once per entity)", async () => {
    const { watch, sent, change, canRead } = setup((id) => id !== 'e_salaries');
    watch.watch(['e_salaries', 'e_jobs']);
    change('e_salaries');
    change('e_salaries');
    change('e_jobs');
    await vi.advanceTimersByTimeAsync(400);
    expect((sent[0] as any).entities.map((e: any) => e.entityId)).toEqual(['e_jobs']);
    expect(canRead).toHaveBeenCalledTimes(2);
  });

  it('stops listening when the page closes', () => {
    const { watch, unsubscribed } = setup();
    watch.close();
    expect(unsubscribed()).toBe(true);
  });
});
