/** The status words built-in symbols understand, and the input that takes them */
import type { VisualInputDef } from '../visuals/index.js';

export const RUNNING = 'inputs.status == "running"';
export const PAUSED = 'inputs.status == "idle" || inputs.status == "stopped"';
export const ALARM = 'inputs.status == "alarm"';

export const STATUS_INPUT: VisualInputDef = { name: 'status', label: 'Status: running, idle, alarm or stopped', type: 'text', default: '' };

/** Running green, paused amber, alarm red (blinking when `blink`) for one attribute */
export const statusColours = (attr: string, blink = false) => [
  { when: RUNNING, set: { [attr]: 'var(--vis-on)' } },
  { when: PAUSED, set: { [attr]: 'var(--vis-idle)' } },
  { when: ALARM, set: { [attr]: 'var(--vis-alarm)' }, ...(blink ? { effect: 'blink' as const } : {}) },
];
