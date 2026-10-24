/** The rule form's values, conversion to what the server expects, and ready-made starting points. */
import type { FieldAssignment, LiveRule, RecordMatch } from "@config-platform/schema";

export interface RuleDraft {
  id?: string;
  name: string;
  enabled: boolean;
  tag: string;
  when: string;
  cooldownSec: number;
  actionType: "createRecord" | "updateLatest";
  entityId: string;
  fields: FieldAssignment[];
  match: RecordMatch[];
}

export function emptyRuleDraft(): RuleDraft {
  return { name: "", enabled: true, tag: "", when: "", cooldownSec: 0, actionType: "createRecord", entityId: "", fields: [], match: [] };
}

export function ruleDraftFromRule(rule: LiveRule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    tag: rule.trigger.tag,
    when: rule.trigger.when ?? "",
    cooldownSec: rule.cooldownSec,
    actionType: rule.action.type,
    entityId: rule.action.entityId,
    fields: rule.action.fields,
    match: rule.action.type === "updateLatest" ? rule.action.match : [],
  };
}

export function ruleDraftToInput(d: RuleDraft): Record<string, unknown> {
  const fields = d.fields.filter((f) => f.field);
  return {
    name: d.name.trim(),
    enabled: d.enabled,
    trigger: { tag: d.tag.trim(), ...(d.when.trim() ? { when: d.when.trim() } : {}) },
    cooldownSec: d.cooldownSec,
    action:
      d.actionType === "createRecord"
        ? { type: "createRecord", entityId: d.entityId, fields }
        : { type: "updateLatest", entityId: d.entityId, match: d.match.filter((m) => m.field), fields },
  };
}

/** Starting points: each sets the condition and what to write; the person picks tag and fields */
export interface RulePreset {
  id: string;
  label: string;
  hint: string;
  apply: (d: RuleDraft) => RuleDraft;
}

export const RULE_PRESETS: RulePreset[] = [
  {
    id: "stopped",
    label: "Log when a machine stops",
    hint: 'Creates a record when the status becomes "stopped"',
    apply: (d) => ({ ...d, when: 'value == "stopped"', cooldownSec: d.cooldownSec || 5, actionType: "createRecord" }),
  },
  {
    id: "restarted",
    label: "Close it when it runs again",
    hint: "Fills in the end time of the newest record that has none",
    apply: (d) => ({ ...d, when: 'value == "running" && previous == "stopped"', actionType: "updateLatest" }),
  },
  {
    id: "above",
    label: "Log when a value goes too high",
    hint: "Creates a record when the value rises above a limit",
    apply: (d) => ({ ...d, when: "value > 80", cooldownSec: d.cooldownSec || 60, actionType: "createRecord" }),
  },
  {
    id: "every",
    label: "Log every change",
    hint: "Creates a record each time the value changes",
    apply: (d) => ({ ...d, when: "", actionType: "createRecord" }),
  },
];

/** "When line1.status becomes stopped" for the rules list */
export function describeTrigger(rule: LiveRule): string {
  return rule.trigger.when?.trim() ? `${rule.trigger.tag}: ${rule.trigger.when}` : `${rule.trigger.tag} changes`;
}
