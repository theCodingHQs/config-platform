/**
 * Tags: named live values from machines and systems, such as line1.speed or press4.status.
 * Pages, visuals and rules refer to tags by name, so a source can be swapped (PLC gateway →
 * MQTT) without changing what uses it.
 */
import { z } from 'zod';

/** line1.speed, press_4.status: dot-separated words, each starting with a letter or _ */
export const TAG_NAME_PATTERN = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;

export const TagNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the tag a name')
  .max(120, 'Tag names can be at most 120 characters')
  .regex(TAG_NAME_PATTERN, 'Use words separated by dots, e.g. line1.speed (letters, numbers and _ only)');

export const TAG_VALUE_TYPES = ['number', 'text', 'boolean'] as const;
export type TagValueType = (typeof TAG_VALUE_TYPES)[number];

/**
 * good: just received · stale: not updated for longer than expected, or the connection is
 * down (the last value is kept) · bad: the message didn't give a usable value
 */
export type TagQuality = 'good' | 'stale' | 'bad';

export interface TagValue {
  value: number | string | boolean | null;
  /** When it was received (ISO) */
  ts: string;
  quality: TagQuality;
}

/** Turns a received value into the tag's type; null when it can't be (e.g. "abc" as a number). */
export function coerceTagValue(raw: unknown, type: TagValueType): number | string | boolean | null {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case 'number': {
      const n = typeof raw === 'boolean' ? (raw ? 1 : 0) : typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'running'].includes(s)) return true;
        if (['false', '0', 'no', 'off', 'stopped', ''].includes(s)) return false;
        return null;
      }
      return Boolean(raw);
    case 'text':
      return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
}

/**
 * Whether a tag is covered by a subscription: the tag itself, or anything under it
 * (subscribing to "line1" covers line1.speed and line1.motor.temp).
 */
export function tagMatchesRef(tag: string, ref: string): boolean {
  return tag === ref || tag.startsWith(`${ref}.`);
}

/**
 * Nests flat tag values for expressions: { "line1.speed": 42 } → { line1: { speed: 42 } }, so a
 * page can write {{ live.line1.speed }}. A tag that is also a group (line1 and line1.speed)
 * keeps the group; the group's own value is under `_value`.
 */
export function nestTagValues(values: Record<string, TagValue>): Record<string, any> {
  const root: Record<string, any> = {};
  for (const name of Object.keys(values).sort()) {
    const parts = name.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const existing = node[part];
      if (existing === undefined || existing === null || typeof existing !== 'object') {
        node[part] = existing === undefined ? {} : { _value: existing };
      }
      node = node[part];
    }
    const last = parts[parts.length - 1];
    const value = values[name].value;
    if (node[last] !== null && typeof node[last] === 'object') node[last]._value = value;
    else node[last] = value;
  }
  return root;
}

/** Tag names referred to as live.<name> in page text and expressions, e.g. {{ live.line1.speed }}. */
export function liveTagRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/\blive\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g)) refs.add(match[1]);
  return [...refs];
}
