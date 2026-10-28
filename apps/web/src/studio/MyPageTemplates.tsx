/** "Mine" in the page template picker: start from a copy of one of the workspace's own pages */
import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PageDefinition } from "@config-platform/schema";
import { fetchPage, fetchPages } from "../api/client";

const muted = { fontSize: "var(--font-size-xs)", color: "var(--text-muted)" } as const;

export function MyPageTemplates({ currentPageId, onUse }: { currentPageId?: string; onUse: (draft: PageDefinition, name: string) => void }) {
  const { data: pages = [], isLoading } = useQuery({ queryKey: ["pages", "list"], queryFn: () => fetchPages() });
  const others = pages.filter((p) => p.id !== currentPageId);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const copy = useMutation({
    mutationFn: () => fetchPage("", chosenId!),
    onSuccess: (page) => onUse(page.draft, page.name),
  });

  if (isLoading) return <p style={muted}>Loading…</p>;
  if (!others.length) return <p style={{ ...muted, margin: 0 }}>No other pages yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <p style={{ ...muted, margin: 0 }}>Copies the page's layout, components and data sources into this page. The page you copy from doesn't change.</p>
      <div role="radiogroup" aria-label="Your pages" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxHeight: "18rem", overflowY: "auto" }}>
        {others.map((p) => (
          <label key={p.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-control)", border: `var(--border-width-sm) solid ${p.id === chosenId ? "var(--accent)" : "var(--border)"}`, background: p.id === chosenId ? "var(--accent-subtle)" : "transparent", cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
            <input type="radio" name="my-page-template" checked={p.id === chosenId} onChange={() => setChosenId(p.id)} />
            <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
            <span style={muted}>{p.route}</span>
          </label>
        ))}
      </div>
      {copy.error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(copy.error as Error).message}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={!chosenId || copy.isPending} onClick={() => copy.mutate()}>
          {copy.isPending ? "Copying…" : "Copy into this page"}
        </button>
      </div>
    </div>
  );
}
