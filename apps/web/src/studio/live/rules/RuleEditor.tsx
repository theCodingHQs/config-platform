import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { ErdColumn, LiveRule } from "@config-platform/schema";
import { fetchSchemaEntities } from "../../../api/client";
import { liveApi, liveRulesApi } from "../../../live/live-api";
import { useStatusNotify } from "../../../context/app-bar-context";
import { Field, FieldRow } from "../Field";
import { Section } from "../Section";
import { FieldAssignmentsEditor } from "./FieldAssignmentsEditor";
import { MatchEditor } from "./MatchEditor";
import { RuleRuns } from "./RuleRuns";
import { RULE_PRESETS, ruleDraftFromRule, ruleDraftToInput, emptyRuleDraft, type RuleDraft } from "./rule-draft";

export const LIVE_RULES_KEY = ["live-rules"];
const SYSTEM_FIELDS = new Set(["id", "created_at", "updated_at"]);
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)" };

/** When a tag changes like this → create or update a record */
export function RuleEditor({ rule, canEdit, onSaved, onClose }: { rule?: LiveRule; canEdit: boolean; onSaved: (saved: LiveRule) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<RuleDraft>(rule ? ruleDraftFromRule(rule) : emptyRuleDraft());
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const { data: tags = [] } = useQuery({ queryKey: ["live-tags"], queryFn: liveApi.tags });
  const { data: entities = [] } = useQuery({ queryKey: ["schema-entities-for-rules"], queryFn: () => fetchSchemaEntities() });

  const entity = entities.find((e) => e.id === draft.entityId);
  const userFields = (entity?.columns ?? []).filter((c: ErdColumn) => !SYSTEM_FIELDS.has(c.name) && !c.isPrimary);
  const writable = userFields.filter((c) => !c.config?.formula);

  const save = useMutation({
    mutationFn: () => (draft.id ? liveRulesApi.update(draft.id, ruleDraftToInput(draft)) : liveRulesApi.create(ruleDraftToInput(draft))),
    onSuccess: (saved) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: LIVE_RULES_KEY });
      setDraft(ruleDraftFromRule(saved));
      notify("success", `${saved.name} saved.`);
      onSaved(saved);
    },
    onError: (err: Error) => setError(err.message),
  });
  const remove = useMutation({
    mutationFn: () => liveRulesApi.remove(draft.id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LIVE_RULES_KEY });
      notify("success", `${draft.name} deleted.`);
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 18rem" }}>
          <Field label="Rule name" htmlFor="lr-name">
            <input id="lr-name" className="form-input" value={draft.name} disabled={!canEdit} placeholder="Log Line 1 stops" onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
          <input type="checkbox" checked={draft.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} /> On
        </label>
      </div>

      {canEdit && !draft.id && (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {RULE_PRESETS.map((p) => (
            <button key={p.id} type="button" className="btn btn-secondary btn-sm" title={p.hint} onClick={() => setDraft(p.apply)}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <Section title="When" intro="The rule runs when the condition becomes true, once (not again while it stays true). Without a condition, it runs on every change.">
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <FieldRow>
            <Field label="Tag" htmlFor="lr-tag">
              <select id="lr-tag" className="form-select" value={draft.tag} onChange={(e) => set({ tag: e.target.value })}>
                <option value="">Choose a tag</option>
                {tags.map((t) => (
                  <option key={t.tag} value={t.tag}>
                    {t.tag}
                    {t.label ? ` (${t.label})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Wait at least (seconds) between runs" htmlFor="lr-cooldown" hint="So a flickering signal makes one record, not many">
              <input id="lr-cooldown" type="number" min={0} className="form-input" value={draft.cooldownSec} onChange={(e) => set({ cooldownSec: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          </FieldRow>
          <Field label="Condition (optional)" htmlFor="lr-when" hint={<>Use <code>value</code> and <code>previous</code>: value == "stopped" · value &gt; 80 · value == "running" &amp;&amp; previous == "stopped"</>}>
            <input id="lr-when" className="form-input" style={mono} value={draft.when} placeholder='value == "stopped"' onChange={(e) => set({ when: e.target.value })} />
          </Field>
        </fieldset>
      </Section>

      <Section title="Then" intro={<>Values can use <code>ts</code> (when it happened), <code>value</code>, <code>previous</code>, other tags as <code>live.line1.speed</code>, or fixed text in quotes.</>}>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <FieldRow>
            <Field label="Do this" htmlFor="lr-action">
              <select id="lr-action" className="form-select" value={draft.actionType} onChange={(e) => set({ actionType: e.target.value as RuleDraft["actionType"] })}>
                <option value="createRecord">Create a record</option>
                <option value="updateLatest">Update the latest matching record</option>
              </select>
            </Field>
            <Field label="In" htmlFor="lr-entity">
              <select id="lr-entity" className="form-select" value={draft.entityId} onChange={(e) => set({ entityId: e.target.value, fields: [], match: [] })}>
                <option value="">Choose data</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldRow>
          {entity && draft.actionType === "updateLatest" && (
            <Field label="The newest record where" hint="e.g. End Time is empty, and Machine equals &quot;Line 1&quot;">
              <MatchEditor fields={userFields} value={draft.match} onChange={(match) => set({ match })} />
            </Field>
          )}
          {entity && (
            <Field label={draft.actionType === "createRecord" ? "With" : "Set"}>
              <FieldAssignmentsEditor fields={writable} value={draft.fields} onChange={(fields) => set({ fields })} />
            </Field>
          )}
        </fieldset>
      </Section>

      {draft.id && (
        <Section title="Recent runs">
          <RuleRuns ruleId={draft.id} />
        </Section>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>
          {error}
        </p>
      )}
      {canEdit ? (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : draft.id ? "Save changes" : "Create rule"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {draft.id ? "Close" : "Cancel"}
          </button>
          {draft.id && (
            <button type="button" className="btn btn-ghost" style={{ color: "var(--danger)", marginLeft: "auto" }} disabled={remove.isPending} onClick={() => confirm(`Delete "${draft.name}"?`) && remove.mutate()}>
              <Trash2 size="1em" /> Delete
            </button>
          )}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>Only admins and owners can change rules.</p>
      )}
    </div>
  );
}
