/**
 * Shared page or export templates to start from: pick one, choose stand-ins for its entities when
 * it came from another workspace, and use it. The publishing workspace and platform owners manage
 * sharing from here too.
 */
import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { SharedKind, TemplateContent, UsedTemplate } from "@config-platform/schema";
import { sharedApi, usable } from "./shared-api";
import { EverywhereButton, SharedBadges, StopSharingButton } from "./SharedControls";
import { EntityMapper, allChosen, defaultEntityMap, type LocalEntity } from "./EntityMapper";
import { useSharedChange, useSharedItems } from "./use-shared";

interface Props {
  kind: Extract<SharedKind, "page-template" | "export-template">;
  entities: readonly LocalEntity[];
  /** Stand-ins already decided, by the template's entity id (export templates: the entity being exported) */
  fixedFor?: (content: TemplateContent) => Record<string, string>;
  onUse: (used: UsedTemplate, name: string) => void;
  /** Shown when there's nothing shared yet */
  emptyHint: string;
}

const muted = { fontSize: "var(--font-size-xs)", color: "var(--text-muted)" } as const;

export function SharedTemplateChooser({ kind, entities, fixedFor, onUse, emptyHint }: Props) {
  const { data = [], everyWorkspace, isLoading } = useSharedItems(kind);
  const change = useSharedChange();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [entityMap, setEntityMap] = useState<Record<string, string>>({});
  const chosen = useQuery({ queryKey: ["shared", "item", chosenId], queryFn: () => sharedApi.get(chosenId!), enabled: Boolean(chosenId) });
  const content = chosen.data?.content as TemplateContent | undefined;
  const fixed = content && fixedFor ? fixedFor(content) : {};

  // Start each chosen template from the obvious stand-ins
  useEffect(() => {
    if (content) setEntityMap(defaultEntityMap(content.entities, entities, fixedFor?.(content)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another template is chosen
  }, [content]);

  const use = useMutation({
    mutationFn: () => sharedApi.use(chosenId!, { entityMap }),
    onSuccess: (used) => onUse(used, chosen.data?.name ?? "template"),
  });

  if (isLoading) return <p style={muted}>Loading…</p>;
  if (!data.length) return <p style={{ ...muted, margin: 0 }}>{emptyHint}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {change.problem && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{change.problem}</p>}
      <div role="radiogroup" aria-label="Shared templates" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {data.map((s) => {
          const selected = s.id === chosenId;
          return (
            <div key={s.id} style={{ padding: "var(--space-3)", borderRadius: "var(--radius-surface)", border: `var(--border-width-sm) solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "var(--accent-subtle)" : "transparent", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start", cursor: usable(s) ? "pointer" : "default" }}>
                <input type="radio" name={`shared-${kind}`} checked={selected} disabled={!usable(s)} onChange={() => setChosenId(s.id)} />
                <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
                  <strong style={{ fontSize: "var(--font-size-sm)" }}>{s.name}</strong>
                  <span style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                    <SharedBadges item={s} />
                  </span>
                  {s.description && <span style={muted}>{s.description}</span>}
                </span>
              </label>
              {(everyWorkspace || s.own) && (
                <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                  {everyWorkspace && <EverywhereButton item={s} change={change} small />}
                  {s.own && <StopSharingButton item={s} change={change} small onStopped={() => setChosenId(null)} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {content && <EntityMapper used={content.entities} local={entities} value={entityMap} onChange={setEntityMap} fixed={fixed} />}
      {use.error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(use.error as Error).message}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={!content || !allChosen(content.entities, entityMap) || use.isPending} onClick={() => use.mutate()}>
          {use.isPending ? "Applying…" : "Use this template"}
        </button>
      </div>
    </div>
  );
}
