/**
 * The Shared tab of the template gallery: solutions workspaces have shared (entities with their
 * pages and Excel templates), installing one, and sharing one of this workspace's own.
 */
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InstallResult, SharedItemSummary } from "@config-platform/schema";
import { useOptionalMetadata } from "../context/metadata-context";
import { SHARED_KEY, sharedApi, usable } from "./shared-api";
import { EverywhereButton, SharedBadges, StopSharingButton } from "./SharedControls";
import { SolutionInstall } from "./SolutionInstall";
import { useSharedChange, useSharedItems } from "./use-shared";

const muted = { fontSize: "var(--font-size-sm)", color: "var(--text-muted)" } as const;

/** A key for "the same solution, shared again" */
const keyFor = (name: string) => `solution-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}`;

function ShareSolutionForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const entities = useOptionalMetadata()?.entities ?? [];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const share = useMutation({
    mutationFn: () => sharedApi.publish({ kind: "solution", sourceId: keyFor(name), name: name.trim(), description, entityIds: picked }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHARED_KEY });
      onDone();
    },
  });
  return (
    <form
      aria-label="Share a solution"
      onSubmit={(e) => {
        e.preventDefault();
        share.mutate();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-3)", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)" }}
    >
      <p style={{ ...muted, margin: 0 }}>
        Tick the entities it's about. Entities they link to come too, with the pages and Excel templates built on them. Sharing again under the same name publishes the next release.
      </p>
      <label className="form-label" htmlFor="solution-name" style={{ margin: 0 }}>
        Name
      </label>
      <input id="solution-name" className="form-input" value={name} maxLength={120} placeholder="e.g. Job tracking" onChange={(e) => setName(e.target.value)} />
      <label className="form-label" htmlFor="solution-description" style={{ margin: 0 }}>
        What it's for (optional)
      </label>
      <input id="solution-description" className="form-input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))", gap: "var(--space-1)" }}>
        <legend className="form-label">Entities</legend>
        {entities.map((e) => (
          <label key={e.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--font-size-sm)" }}>
            <input type="checkbox" checked={picked.includes(e.id)} onChange={() => setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id]))} />
            {e.label}
          </label>
        ))}
      </fieldset>
      {share.error && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{(share.error as Error).message}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || !picked.length || share.isPending}>
          {share.isPending ? "Sharing…" : "Share"}
        </button>
      </div>
    </form>
  );
}

export function SharedSolutions({ onInstalled }: { onInstalled: (result: InstallResult, name: string) => void }) {
  const { data = [], everyWorkspace, isLoading } = useSharedItems("solution");
  const change = useSharedChange();
  const [sharing, setSharing] = useState(false);
  const [installing, setInstalling] = useState<SharedItemSummary | null>(null);

  if (installing) {
    return <SolutionInstall solutionId={installing.id} name={installing.name} onCancel={() => setInstalling(null)} onInstalled={(r) => onInstalled(r, installing.name)} />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <p style={{ ...muted, margin: 0, flex: 1 }}>Solutions a workspace shared: its entities, with their pages and Excel templates. Installing adds a copy you can change; the shared one doesn't change.</p>
        {!sharing && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSharing(true)}>
            Share a solution…
          </button>
        )}
      </div>
      {sharing && <ShareSolutionForm onDone={() => setSharing(false)} />}
      {change.problem && <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>{change.problem}</p>}
      {isLoading ? (
        <p style={muted}>Loading…</p>
      ) : data.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>None shared yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))", gap: "var(--space-3)" }}>
          {data.map((s) => (
            <div key={s.id} style={{ padding: "var(--space-3)", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <strong>{s.name}</strong>
              <span style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                <SharedBadges item={s} />
              </span>
              {s.description && <span style={muted}>{s.description}</span>}
              <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap", marginTop: "auto" }}>
                {usable(s) && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setInstalling(s)}>
                    Install…
                  </button>
                )}
                {everyWorkspace && <EverywhereButton item={s} change={change} small />}
                {s.own && <StopSharingButton item={s} change={change} small />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
