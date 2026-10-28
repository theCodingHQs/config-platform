/** "Mine" in the grid designer's starter layouts: copy the layout of another of the workspace's exports of the same entity */
import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getExportTemplate, listExportTemplates } from "../api/client";

const muted = { fontSize: "var(--font-size-xs)", color: "var(--text-muted)" } as const;

export function MyExportLayouts({ entityId, currentId, onUse }: { entityId: string; currentId?: string; onUse: (draft: unknown, name: string) => void }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["export-templates", "list", entityId], queryFn: () => listExportTemplates(entityId) });
  const others = data.filter((t) => t.id !== currentId);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const copy = useMutation({
    mutationFn: () => getExportTemplate(chosenId!),
    onSuccess: (t) => onUse(t.draft, t.name),
  });

  if (isLoading) return <p style={muted}>Loading…</p>;
  if (!others.length) return <p style={{ ...muted, margin: 0 }}>No other exports of this entity yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div role="radiogroup" aria-label="Your exports" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {others.map((t) => (
          <label key={t.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-control)", border: `var(--border-width-sm) solid ${t.id === chosenId ? "var(--accent)" : "var(--border)"}`, background: t.id === chosenId ? "var(--accent-subtle)" : "transparent", cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
            <input type="radio" name="my-export-layout" checked={t.id === chosenId} onChange={() => setChosenId(t.id)} />
            {t.name}
          </label>
        ))}
      </div>
      {copy.error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(copy.error as Error).message}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={!chosenId || copy.isPending} onClick={() => copy.mutate()}>
          {copy.isPending ? "Copying…" : "Copy its layout"}
        </button>
      </div>
    </div>
  );
}
