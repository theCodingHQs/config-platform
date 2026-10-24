/**
 * Applies a connection's tag rules to a decoded message: which tags it updates, and their values.
 * Rules are expressions over `message` and `topic`, so any message shape works:
 *   tag line1.speed   value message.speed
 *   tag press4.status value message.state   when message.machine == "P-04"
 *   tag hall.temp     value message         topic factory/hall/temperature   (MQTT, plain numbers)
 */
import { coerceTagValue, evaluateRawExpression, type TagRule, type TagValue } from '@config-platform/schema';
import { topicMatches } from './message-decoder.js';

export interface MappedTags {
  values: Record<string, TagValue>;
  /** Rules whose expression failed on this message (shown on the Live screen to help fix rules) */
  errors: Array<{ tag: string; error: string }>;
}

export function mapMessageToTags(rules: TagRule[], message: unknown, topic: string | undefined, now = new Date()): MappedTags {
  const ts = now.toISOString();
  const scope = { message, topic: topic ?? '' };
  const result: MappedTags = { values: {}, errors: [] };
  for (const rule of rules) {
    if (rule.topic && !(topic && topicMatches(rule.topic, topic))) continue;
    if (rule.when) {
      const when = evaluateRawExpression(rule.when, scope);
      if (when.error) {
        result.errors.push({ tag: rule.tag, error: `"when": ${when.error}` });
        continue;
      }
      if (!when.value) continue;
    }
    const raw = evaluateRawExpression(rule.value, scope);
    if (raw.error) {
      result.errors.push({ tag: rule.tag, error: raw.error });
      continue;
    }
    // A rule that doesn't apply to this message (message.speed missing) leaves the tag alone
    if (raw.value === undefined) continue;
    const value = coerceTagValue(raw.value, rule.type);
    result.values[rule.tag] = { value, ts, quality: value === null && raw.value !== null ? 'bad' : 'good' };
  }
  return result;
}

/** Checks the rules' expressions can be read, before a connection is saved. Returns problems. */
export function checkTagRules(rules: TagRule[]): string[] {
  const problems: string[] = [];
  for (const rule of rules) {
    for (const [part, expression] of [['value', rule.value], ['when', rule.when]] as const) {
      if (!expression) continue;
      // With no real message the expression can still be read: only syntax and unknown functions fail
      const { error } = evaluateRawExpression(expression, { message: {}, topic: '' });
      if (error) problems.push(`Tag "${rule.tag}", ${part}: ${error}`);
    }
  }
  return problems;
}
