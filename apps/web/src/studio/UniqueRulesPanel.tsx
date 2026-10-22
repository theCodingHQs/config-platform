import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, X } from "lucide-react";
import type { ErdTable } from "@config-platform/schema";
import { setUniqueRules } from "../api/client";
import { useStatusNotify } from "../context/app-bar-context";

/**
 * "Prevent duplicates": combinations of fields no two records may share, e.g. Machine + Month
 * for one production sheet per machine per month.
 */
export function UniqueRulesPanel({ entity, tenantId }: { entity: ErdTable; tenantId: string }) {
  const queryClient = useQueryClient();
  const notify = useStatusNotify();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const rules = entity.uniqueRules ?? [];
  const fields = (entity.columns || []).filter((c) => !["id", "created_at", "updated_at"].includes(c.id));
  const labelOf = (id: string) => fields.find((f) => f.id === id)?.label ?? id;

  const save = useMutation({
    mutationFn: (next: Array<{ id?: string; fields: string[] }>) => setUniqueRules(entity.id, next, entity.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schema-entities", tenantId] });
      setAdding(false);
      setPicked([]);
      notify("success", "Duplicate prevention updated.");
    },
    // e.g. existing records already share the combination: the message names examples
    onError: (err: Error) => notify("error", err.message, { durationMs: 0 }),
  });

  return (
    <section
      aria-labelledby={`unique-rules-${entity.id}`}
      style={{
        marginTop: "var(--space-4)",
        padding: "var(--space-4)",
        border: "var(--border-width-sm) solid var(--border)",
        borderRadius: "var(--radius-surface)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <div>
          <h3 id={`unique-rules-${entity.id}`} style={{ margin: 0, fontSize: "var(--font-size-base)", fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <ShieldCheck size="1.1em" style={{ color: "var(--accent)" }} /> Prevent duplicates
          </h3>
          <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
            Combinations of fields no two {entity.label} records may share, e.g. Machine + Month for one sheet per machine per month.
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
            <Plus size="1em" /> Add rule
          </button>
        )}
      </div>

      {rules.length === 0 && !adding && (
        <p style={{ margin: 0, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>No rules: duplicates are allowed.</p>
      )}

      {rules.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {rules.map((rule) => (
            <li key={rule.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", fontSize: "var(--font-size-sm)" }}>
              <span>
                <strong>{rule.fields.map(labelOf).join(" + ")}</strong>
                <span style={{ color: "var(--text-muted)" }}> must be unique</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost-danger btn-sm btn-icon"
                aria-label={`Remove rule ${rule.fields.map(labelOf).join(" + ")}`}
                disabled={save.isPending}
                onClick={() => save.mutate(rules.filter((r) => r.id !== rule.id))}
              >
                <X size="1em" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="form-label" style={{ fontSize: "var(--font-size-xs)", margin: 0 }}>Fields that together must be unique</span>
          <div role="group" aria-label="Fields in the rule" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1) var(--space-4)", maxHeight: "9rem", overflowY: "auto" }}>
            {fields.map((f) => (
              <label key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", fontSize: "var(--font-size-sm)" }}>
                <input
                  type="checkbox"
                  checked={picked.includes(f.id)}
                  disabled={!picked.includes(f.id) && picked.length >= 5}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.id] : p.filter((id) => id !== f.id)))}
                />
                {f.label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={picked.length === 0 || save.isPending}
              onClick={() => save.mutate([...rules, { fields: picked }])}
            >
              {save.isPending ? "Saving…" : `Add rule${picked.length ? `: ${picked.map(labelOf).join(" + ")}` : ""}`}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setPicked([]); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
