/** Using a template built on another workspace's entities: which of this workspace's entities stands in for each */
import React from "react";
import type { TemplateEntity } from "@config-platform/schema";

export interface LocalEntity {
  id: string;
  name: string;
  label: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The stand-ins to start from: the entity itself when it's this workspace's, else one with the same name or label */
export function defaultEntityMap(used: readonly TemplateEntity[], local: readonly LocalEntity[], fixed: Record<string, string> = {}): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of used) {
    const match = fixed[e.id] ?? local.find((l) => l.id === e.id)?.id ?? local.find((l) => same(l.name, e.name))?.id ?? local.find((l) => same(l.label, e.label))?.id;
    if (match) map[e.id] = match;
  }
  return map;
}

interface Props {
  used: readonly TemplateEntity[];
  local: readonly LocalEntity[];
  value: Record<string, string>;
  onChange: (map: Record<string, string>) => void;
  /** Stand-ins that are already decided (an export template on the entity being exported) */
  fixed?: Record<string, string>;
}

export function EntityMapper({ used, local, value, onChange, fixed = {} }: Props) {
  // The template's own entities, when this is the workspace it came from, need no choosing
  const toChoose = used.filter((e) => !fixed[e.id] && !local.some((l) => l.id === e.id));
  if (!toChoose.length) return null;
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <legend className="form-label" style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>
        Use your own entities
      </legend>
      <p style={{ margin: 0, fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        The template was built on entities from another workspace. Choose which of yours takes each one's place; fields are matched by name.
      </p>
      {toChoose.map((e) => (
        <label key={e.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
          <span>
            {e.label} <span style={{ color: "var(--text-muted)" }}>({e.fields.length} {e.fields.length === 1 ? "field" : "fields"})</span>
          </span>
          <select className="form-select" value={value[e.id] ?? ""} onChange={(ev) => onChange({ ...value, [e.id]: ev.target.value })}>
            <option value="">Choose an entity…</option>
            {local.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} ({l.name})
              </option>
            ))}
          </select>
        </label>
      ))}
    </fieldset>
  );
}

/** Every entity the template uses has a stand-in */
export const allChosen = (used: readonly TemplateEntity[], map: Record<string, string>) => used.every((e) => Boolean(map[e.id]));
