import type { DemoMachine } from '../../catalog.js';
import type { EntityInfo } from '../entities.js';
import type { DemoVisualIds } from '../visuals/publish.js';

/** What the pages are built from */
export interface PageContext {
  machine: EntityInfo;
  downtime: EntityInfo;
  /** Customer Order, filled by the order desk's live rules */
  order: EntityInfo;
  machines: readonly DemoMachine[];
  /** machine code → id of the live connection feeding it */
  connectionIds: Record<string, string>;
  /** The drawings in Studio → Visuals */
  visuals: DemoVisualIds;
}

export interface PageSpec {
  name: string;
  route: string;
  icon: string;
  /** Menu folder; the Machine Monitoring folder when not given */
  folder?: { name: string; icon: string };
  draft: Record<string, unknown>;
}
