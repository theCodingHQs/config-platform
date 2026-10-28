/**
 * Installing a shared solution: what it adds, and for each of its entities the workspace already
 * has (by name), the person's choice: use theirs, adding the missing fields they tick, or create a
 * new one under another name.
 */
import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { EntityChoice, InstallPlan, InstallResult } from "@config-platform/schema";
import { sharedApi } from "./shared-api";

const muted = { fontSize: "var(--font-size-xs)", color: "var(--text-muted)" } as const;

/** Start every clash from "use mine, adding everything it lacks" */
function startingChoices(plan: InstallPlan): Record<string, EntityChoice> {
  const choices: Record<string, EntityChoice> = {};
  for (const e of plan.entities) if (e.existing) choices[e.id] = { action: "reuse", entityId: e.existing.id, addFields: e.existing.missingFields.map((f) => f.id) };
  return choices;
}

function ClashChoice({ entity, choice, onChange }: { entity: InstallPlan["entities"][number]; choice: EntityChoice; onChange: (c: EntityChoice) => void }) {
  const existing = entity.existing!;
  const reuse = choice.action === "reuse";
  const ticked = new Set(choice.action === "reuse" ? choice.addFields ?? [] : []);
  const toggle = (id: string) => onChange({ action: "reuse", entityId: existing.id, addFields: ticked.has(id) ? [...ticked].filter((f) => f !== id) : [...ticked, id] });
  return (
    <fieldset style={{ margin: 0, padding: "var(--space-3)", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <legend style={{ fontWeight: 600, fontSize: "var(--font-size-sm)", padding: "0 var(--space-1)" }}>{entity.label}: your workspace already has one</legend>
      <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
        <input type="radio" name={`choice-${entity.id}`} checked={reuse} onChange={() => onChange({ action: "reuse", entityId: existing.id, addFields: existing.missingFields.map((f) => f.id) })} />
        Use my {existing.label}
      </label>
      {reuse &&
        (existing.missingFields.length ? (
          <div style={{ paddingLeft: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={muted}>Fields the solution uses that yours doesn't have. Tick the ones to add; what uses the others will show them as missing.</span>
            {existing.missingFields.map((f) => (
              <label key={f.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
                <input type="checkbox" checked={ticked.has(f.id)} onChange={() => toggle(f.id)} /> {f.label}
              </label>
            ))}
          </div>
        ) : (
          <span style={{ ...muted, paddingLeft: "var(--space-5)" }}>Yours has every field the solution uses.</span>
        ))}
      <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
        <input type="radio" name={`choice-${entity.id}`} checked={!reuse} onChange={() => onChange({ action: "create", label: `${entity.label} 2` })} />
        Create a new entity named
        <input
          className="form-input"
          aria-label={`Name for the new ${entity.label}`}
          style={{ flex: 1, maxWidth: "16rem" }}
          disabled={reuse}
          value={choice.action === "create" ? choice.label : `${entity.label} 2`}
          onChange={(e) => onChange({ action: "create", label: e.target.value })}
        />
      </label>
    </fieldset>
  );
}

export function SolutionInstall({ solutionId, name, onInstalled, onCancel }: { solutionId: string; name: string; onInstalled: (result: InstallResult) => void; onCancel: () => void }) {
  const plan = useQuery({ queryKey: ["shared", "install-plan", solutionId], queryFn: () => sharedApi.installPlan(solutionId), gcTime: 0 });
  const [choices, setChoices] = useState<Record<string, EntityChoice>>({});
  useEffect(() => {
    if (plan.data) setChoices(startingChoices(plan.data));
  }, [plan.data]);
  const install = useMutation({ mutationFn: () => sharedApi.install(solutionId, { choices }), onSuccess: onInstalled });

  if (plan.isLoading) return <p style={muted}>Checking your workspace…</p>;
  if (plan.error || !plan.data) return <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{(plan.error as Error)?.message ?? "It couldn't be checked"}</p>;
  const fresh = plan.data.entities.filter((e) => !e.existing);
  const clashes = plan.data.entities.filter((e) => e.existing);
  const emptyName = clashes.some((e) => choices[e.id]?.action === "create" && !(choices[e.id] as { label: string }).label.trim());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: "var(--font-size-sm)" }}>
      <p style={{ margin: 0 }}>
        Installing <strong>{name}</strong> adds:
      </p>
      <ul style={{ margin: 0, paddingLeft: "var(--space-5)", color: "var(--text-muted)" }}>
        {fresh.length > 0 && <li>Data: {fresh.map((e) => e.label).join(", ")}</li>}
        {plan.data.pages.length > 0 && <li>Pages: {plan.data.pages.join(", ")}</li>}
        {plan.data.exportTemplates.length > 0 && <li>Excel templates: {plan.data.exportTemplates.join(", ")}</li>}
      </ul>
      {clashes.map((e) => (
        <ClashChoice key={e.id} entity={e} choice={choices[e.id] ?? { action: "reuse", entityId: e.existing!.id }} onChange={(c) => setChoices((prev) => ({ ...prev, [e.id]: c }))} />
      ))}
      {install.error && <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{(install.error as Error).message}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={install.isPending}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={() => install.mutate()} disabled={install.isPending || emptyName}>
          {install.isPending ? "Installing…" : `Install ${name}`}
        </button>
      </div>
    </div>
  );
}
