/** In the symbol editor: share the saved symbol with the workspace as a fixed release, or publish its next release */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { sharedRef } from "@config-platform/schema";
import { SHARED_KEY, sharedApi, sharedListKey } from "../../library/shared-api";
import { visualKey } from "../../visuals/visuals-api";

interface Props {
  symbolId: string;
  /** Unsaved changes: what's shared is the saved symbol, so save first */
  dirty: boolean;
  onMessage: (tone: "error" | "success", text: string) => void;
}

export function ShareSymbolButton({ symbolId, dirty, onMessage }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({ queryKey: sharedListKey("symbol"), queryFn: () => sharedApi.list("symbol") });
  const shared = data.find((s) => s.own && s.sourceId === symbolId);
  const [description, setDescription] = useState("");

  const publish = useMutation({
    mutationFn: () => sharedApi.publish({ kind: "symbol", sourceId: symbolId, description: description.trim() || shared?.description || "" }),
    onSuccess: (item) => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: SHARED_KEY });
      queryClient.removeQueries({ queryKey: visualKey(sharedRef(item.id)) });
      onMessage("success", item.version === 1 ? "Shared with the workspace" : `Shared release ${item.version}`);
    },
    onError: (err: Error) => onMessage("error", err.message),
  });

  const label = shared ? `Share changes (v${shared.version} now)` : "Share";
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={dirty || publish.isPending}
        title={dirty ? "Save first: what's shared is the saved symbol" : shared ? "Publish what you've saved as the next release" : "Share it with everyone in the workspace, as a fixed release"}
        onClick={() => {
          setDescription(shared?.description ?? "");
          setOpen((o) => !o);
        }}
      >
        <Share2 size="1em" /> {publish.isPending ? "Sharing…" : label}
      </button>
      {open && (
        <form
          className="card"
          aria-label="Share this symbol"
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
          style={{ position: "absolute", right: 0, top: "calc(100% + var(--space-1))", zIndex: 20, width: "20rem", padding: "var(--space-3)", background: "var(--surface)", border: "var(--border-width-sm) solid var(--border)", borderRadius: "var(--radius-surface)", display: "flex", flexDirection: "column", gap: "var(--space-2)", boxShadow: "var(--shadow-lg)" }}
        >
          <p style={{ margin: 0, fontSize: "var(--font-size-sm)" }}>
            {shared
              ? `Drawings using the shared symbol will show what you've saved now, as release ${shared.version + 1}.`
              : "Everyone in the workspace can then place it. Later changes are shared only when you share again."}
          </p>
          <label className="form-label" htmlFor="share-description" style={{ fontSize: "var(--font-size-xs)", margin: 0 }}>
            What it is (optional)
          </label>
          <input id="share-description" className="form-input" value={description} maxLength={300} placeholder="e.g. A lamp that lights while running" onChange={(e) => setDescription(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={publish.isPending}>
              {shared ? "Share changes" : "Share"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
